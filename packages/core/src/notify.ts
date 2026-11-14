import { schema } from "@northeside/db";
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { sendNotification, setVapidDetails, type PushSubscription } from "web-push";
import type { CoreContext } from "./context";

type Env = Record<string, string | undefined>;
type Kind = "lock_24h" | "lock_2h" | "results";

export interface Message {
  title: string;
  body: string;
  url: string;
}

export async function sendTelegram(env: Env, chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return res.ok;
}

export async function sendEmail(env: Env, to: string, m: Message) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject: m.title, text: `${m.body}\n\n${m.url}` }),
  });
  return res.ok;
}

export async function sendWebPush(env: Env, subscription: unknown, m: Message) {
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  // VAPID subject: a mailto: we own, else the site URL (web-push accepts https: subjects).
  const email = env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? env.NEXT_PUBLIC_CONTACT_EMAIL;
  const subject = email ? `mailto:${email}` : (env.NEXT_PUBLIC_SITE_URL ?? "https://northeside.netlify.app");
  setVapidDetails(subject, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  await sendNotification(subscription as PushSubscription, JSON.stringify(m));
  return true;
}

function message(kind: Kind, mwId: number, siteUrl: string): Message {
  if (kind === "results") {
    return { title: `Matchweek ${mwId} results are in`, body: "See your points and where you rank.", url: `${siteUrl}/play?mw=${mwId}` };
  }
  const when = kind === "lock_24h" ? "24 hours" : "2 hours";
  return { title: `Matchweek ${mwId} locks in ${when}`, body: "Seal your predictions before the first kickoff.", url: `${siteUrl}/play` };
}

type Prefs = typeof schema.notificationPrefs.$inferSelect;

async function deliver(ctx: CoreContext, env: Env, prefs: Prefs, kind: Kind, mwId: number, m: Message = message(kind, mwId, ctx.siteUrl)) {
  const userId = prefs.userId;
  // Claim the slot first so concurrent runs never double-send.
  const claimed = await ctx.db
    .insert(schema.notificationsSent)
    .values({ userId, kind, matchweekId: mwId, channel: "pending" })
    .onConflictDoNothing()
    .returning();
  if (claimed.length === 0) return null;

  let channel: string | null = null;
  try {
    if (prefs.telegramChatId && (await sendTelegram(env, prefs.telegramChatId, `${m.title}. ${m.body}\n${m.url}`))) channel = "telegram";
    else if (prefs.webPush && (await sendWebPush(env, prefs.webPush, m))) channel = "web_push";
    else if (prefs.emailOptIn) {
      const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
      if (u?.emailEnc && (await sendEmail(env, ctx.crypto.decrypt(u.emailEnc, `email:${userId}`), m))) channel = "email";
    }
  } catch (e) {
    ctx.log.warn("notification failed", { userId, kind, error: String(e) });
  }
  if (!channel) {
    await ctx.db
      .delete(schema.notificationsSent)
      .where(and(eq(schema.notificationsSent.userId, userId), eq(schema.notificationsSent.kind, kind), eq(schema.notificationsSent.matchweekId, mwId)));
    return null;
  }
  await ctx.db
    .update(schema.notificationsSent)
    .set({ channel })
    .where(and(eq(schema.notificationsSent.userId, userId), eq(schema.notificationsSent.kind, kind), eq(schema.notificationsSent.matchweekId, mwId)));
  return channel;
}

/**
 * Users who can actually be reached for `kind` on this matchweek: at least one channel, the reminder
 * switched on, not deleted, and not already sent. One query, so the job scales with recipients, not
 * with every user (audit P3).
 */
async function reachable(ctx: CoreContext, kind: Kind, mwId: number, extra?: ReturnType<typeof and>) {
  const flag = kind === "results" ? schema.notificationPrefs.remindResults : schema.notificationPrefs.remindLock;
  const rows = await ctx.db
    .select({ prefs: schema.notificationPrefs })
    .from(schema.notificationPrefs)
    .innerJoin(schema.users, eq(schema.users.id, schema.notificationPrefs.userId))
    .leftJoin(
      schema.notificationsSent,
      and(
        eq(schema.notificationsSent.userId, schema.notificationPrefs.userId),
        eq(schema.notificationsSent.kind, kind),
        eq(schema.notificationsSent.matchweekId, mwId),
      ),
    )
    .where(
      and(
        eq(flag, true),
        isNull(schema.users.deletedAt),
        isNull(schema.notificationsSent.userId),
        or(isNotNull(schema.notificationPrefs.telegramChatId), isNotNull(schema.notificationPrefs.webPush), eq(schema.notificationPrefs.emailOptIn, true)),
        extra,
      ),
    );
  return rows.map((r) => r.prefs);
}

/** FR-29: lock reminders at 24h and 2h for players who have not sealed; results with rank change after finalize. */
export async function notifyJob(ctx: CoreContext, env: Env = process.env) {
  const now = ctx.now();
  const sent: Record<Kind, number> = { lock_24h: 0, lock_2h: 0, results: 0 };

  const open = await ctx.db
    .select()
    .from(schema.matchweeks)
    .where(and(eq(schema.matchweeks.status, "open"), gt(schema.matchweeks.lockTime, now), lte(schema.matchweeks.lockTime, new Date(now.getTime() + 24 * 3600_000))));

  for (const mw of open) {
    const kind: Kind = mw.lockTime.getTime() - now.getTime() <= 2 * 3600_000 ? "lock_2h" : "lock_24h";
    const notSealed = sql`not exists (select 1 from ${schema.predictions} p where p.user_id = ${schema.notificationPrefs.userId} and p.matchweek_id = ${mw.id} and p.tx_status in ('sent', 'confirmed'))`;
    for (const prefs of await reachable(ctx, kind, mw.id, and(notSealed))) if (await deliver(ctx, env, prefs, kind, mw.id)) sent[kind]++;
  }

  const finalized = await ctx.db
    .select()
    .from(schema.matchweeks)
    .where(and(eq(schema.matchweeks.status, "finalized"), gt(schema.matchweeks.finalizedAt, new Date(now.getTime() - 24 * 3600_000))));
  for (const mw of finalized) {
    const played = sql`exists (select 1 from ${schema.predictions} p where p.user_id = ${schema.notificationPrefs.userId} and p.matchweek_id = ${mw.id} and p.reveal_valid)`;
    for (const prefs of await reachable(ctx, "results", mw.id, and(played))) {
      const m = await resultsMessage(ctx, prefs.userId, mw.id);
      if (await deliver(ctx, env, prefs, "results", mw.id, m)) sent.results++;
    }
  }
  return sent;
}

/** Results notice with the player's rank and how it moved since their previous matchweek (FR-29). */
async function resultsMessage(ctx: CoreContext, userId: string, mwId: number): Promise<Message> {
  const base = message("results", mwId, ctx.siteUrl);
  const rows = await ctx.db
    .select({ matchweekId: schema.predictions.matchweekId, rank: schema.predictions.rank, points: schema.predictions.points })
    .from(schema.predictions)
    .where(and(eq(schema.predictions.userId, userId), lte(schema.predictions.matchweekId, mwId), isNotNull(schema.predictions.rank)))
    .orderBy(sql`${schema.predictions.matchweekId} desc`)
    .limit(2);
  const now = rows.find((r) => r.matchweekId === mwId);
  if (!now?.rank) return base;
  const prev = rows.find((r) => r.matchweekId !== mwId);
  const move = prev?.rank ? prev.rank - now.rank : 0;
  const change = !prev?.rank ? "" : move > 0 ? `, up ${move} place${move === 1 ? "" : "s"}` : move < 0 ? `, down ${-move}` : ", same place as last time";
  return { ...base, body: `${now.points ?? 0} points, ranked #${now.rank}${change}.` };
}
