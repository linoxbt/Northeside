import { schema } from "@northeside/db";
import { and, eq, gt, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
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
  const contact = env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? "ops@northeside.app";
  setVapidDetails(`mailto:${contact}`, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
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

async function deliver(ctx: CoreContext, env: Env, userId: string, kind: Kind, mwId: number) {
  const [prefs] = await ctx.db.select().from(schema.notificationPrefs).where(eq(schema.notificationPrefs.userId, userId));
  if (!prefs) return null;
  if (kind !== "results" && !prefs.remindLock) return null;
  if (kind === "results" && !prefs.remindResults) return null;
  const m = message(kind, mwId, ctx.siteUrl);
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

/** FR-29: lock reminders at 24h and 2h for players who have not sealed; results-ready after finalize. */
export async function notifyJob(ctx: CoreContext, env: Env = process.env) {
  const now = ctx.now();
  const sent: Record<Kind, number> = { lock_24h: 0, lock_2h: 0, results: 0 };

  const open = await ctx.db
    .select()
    .from(schema.matchweeks)
    .where(and(eq(schema.matchweeks.status, "open"), gt(schema.matchweeks.lockTime, now), lte(schema.matchweeks.lockTime, new Date(now.getTime() + 24 * 3600_000))));

  for (const mw of open) {
    const kind: Kind = mw.lockTime.getTime() - now.getTime() <= 2 * 3600_000 ? "lock_2h" : "lock_24h";
    const sealedUsers = (
      await ctx.db
        .select({ userId: schema.predictions.userId })
        .from(schema.predictions)
        .where(and(eq(schema.predictions.matchweekId, mw.id), inArray(schema.predictions.txStatus, ["sent", "confirmed"])))
    ).map((r) => r.userId);
    const targets = await ctx.db
      .select({ userId: schema.notificationPrefs.userId })
      .from(schema.notificationPrefs)
      .innerJoin(schema.users, eq(schema.users.id, schema.notificationPrefs.userId))
      .where(and(isNull(schema.users.deletedAt), sealedUsers.length ? notInArray(schema.notificationPrefs.userId, sealedUsers) : undefined));
    for (const t of targets) if (await deliver(ctx, env, t.userId, kind, mw.id)) sent[kind]++;
  }

  const finalized = await ctx.db
    .select()
    .from(schema.matchweeks)
    .where(and(eq(schema.matchweeks.status, "finalized"), gt(schema.matchweeks.finalizedAt, new Date(now.getTime() - 24 * 3600_000))));
  for (const mw of finalized) {
    const players = await ctx.db
      .selectDistinct({ userId: schema.predictions.userId })
      .from(schema.predictions)
      .where(and(eq(schema.predictions.matchweekId, mw.id), or(eq(schema.predictions.revealValid, true))));
    for (const p of players) if (await deliver(ctx, env, p.userId, "results", mw.id)) sent.results++;
  }
  return sent;
}
