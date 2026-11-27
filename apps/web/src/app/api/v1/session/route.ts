import { creditInvite, refreshQieId } from "@northeside/core";
import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import { HttpError, json, limitWrites, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { verifyPrivyToken } from "@/lib/server/privy";
import { passProvider } from "@/lib/server/services/identity";
import { joinLeague, userById, walletsOf, isVerifiedUser } from "@/lib/server/services/accounts";
import { checkNonce, clearSessionCookie, getSession, setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/session: current user, wallets, verified status. */
export const GET = route(async () => {
  const s = await getSession();
  if (!s) return json({ user: null });
  const user = await userById(s.userId);
  if (!user) return json({ user: null });
  const provider = passProvider();
  return json({
    user: {
      id: user.id,
      displayName: user.displayName,
      qieId: user.qieId,
      qieIdResolved: user.qieIdResolved,
      adultConfirmed: user.adultConfirmedAt !== null,
      emailVerified: user.emailVerified,
      attributedLeagueId: user.attributedLeagueId,
    },
    wallet: s.wallet,
    wallets: (await walletsOf(user.id)).map((w) => ({ address: w.address, kind: w.kind })),
    verified: await isVerifiedUser(user.id),
    // False until a verification provider is configured: the UI must not offer verification (spec 9.4).
    verificationAvailable: provider !== null,
    verificationMethod: provider?.name ?? null,
  });
});

const body = z.object({
  message: z.string().max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  walletKind: z.enum(["embedded", "external"]),
  privyToken: z.string().max(4000).optional(),
  ref: z.string().regex(/^[a-z0-9-]{2,32}$/i).optional(),
  source: z.enum(["whatsapp", "x", "telegram", "direct"]).optional(),
  /** FR-38: a player's personal invite code (credited only when this sign-in creates the account). */
  invite: z.string().regex(/^[a-z0-9]{4,16}$/i).optional(),
});

/** POST /api/v1/session: sign in with a wallet signature (EIP-4361), optionally with a Privy email. */
export const POST = route(async (req) => {
  await limitWrites(null, "session", 0, 20);
  const input = body.parse(await req.json());
  const ctx = getCtx();
  const parsed = parseSiweMessage(input.message);
  // The domain comes from configuration, never from the request's Host header, so a signature phished
  // on another domain (or a deploy-preview URL) cannot be replayed here (audit S10).
  const host = siweHost(req);
  const uriHost = (() => {
    try {
      return parsed.uri ? new URL(parsed.uri).host : null;
    } catch {
      return "invalid";
    }
  })();
  if (!host || !parsed.address || !parsed.nonce || parsed.domain !== host || (uriHost !== null && uriHost !== host)) {
    throw new HttpError(400, "bad_message", "Sign-in message is not for this site");
  }
  if (parsed.chainId !== ctx.deployment.chainId) throw new HttpError(400, "wrong_chain", "Switch to QIE mainnet");
  if (!checkNonce(parsed.nonce)) throw new HttpError(400, "bad_nonce", "Sign-in expired, try again");
  const ok = await ctx.publicClient.verifySiweMessage({
    message: input.message,
    signature: input.signature as `0x${string}`,
    domain: host,
    nonce: parsed.nonce,
  });
  if (!ok) throw new HttpError(401, "bad_signature", "Signature check failed");
  const used = await ctx.db
    .insert(schema.idempotencyKeys)
    .values({ key: `siwe:${parsed.nonce}`, route: "siwe" })
    .onConflictDoNothing()
    .returning();
  if (used.length === 0) throw new HttpError(400, "nonce_used", "Sign-in expired, try again");

  const wallet = getAddress(parsed.address).toLowerCase();
  const privy = input.privyToken ? await verifyPrivyToken(input.privyToken) : null;
  if (input.privyToken && !privy) throw new HttpError(401, "bad_privy_token", "Email sign-in expired, try again");

  const [walletRow] = await ctx.db.select().from(schema.wallets).where(eq(schema.wallets.address, wallet));
  let userId = walletRow?.userId ?? null;
  // Signed in already and signing with a new wallet: link it to this account (max 3 for QIE Pass).
  const current = await getSession();
  if (!userId && current) {
    if ((await walletsOf(current.userId)).length >= 3) throw new HttpError(400, "too_many_wallets", "An account can link up to 3 wallets");
    userId = current.userId;
  }
  if (!userId && privy) {
    const [byDid] = await ctx.db.select().from(schema.users).where(eq(schema.users.privyDid, privy.did));
    userId = byDid && !byDid.deletedAt ? byDid.id : null;
    // The same 3-wallet limit applies when a wallet is linked through the email account (audit S6).
    if (userId && (await walletsOf(userId)).length >= 3) throw new HttpError(400, "too_many_wallets", "An account can link up to 3 wallets");
  }
  if (!userId) {
    const [created] = await ctx.db.insert(schema.users).values({}).returning();
    userId = created!.id;
    if (input.invite) await creditInvite(ctx, userId, input.invite).catch(() => false);
  }
  if (!walletRow) {
    // Check and insert under a lock on the account row, so two sign-ins at once cannot both pass the
    // 3-wallet check (audit 27 Nov, L3).
    const linkTo = userId;
    await ctx.db.transaction(async (tx) => {
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, linkTo)).for("update");
      const linked = await tx.select({ address: schema.wallets.address }).from(schema.wallets).where(eq(schema.wallets.userId, linkTo));
      if (linked.length >= 3) throw new HttpError(400, "too_many_wallets", "An account can link up to 3 wallets");
      await tx.insert(schema.wallets).values({ address: wallet, userId: linkTo, kind: input.walletKind }).onConflictDoNothing();
    });
  }

  if (privy) {
    const emailHash = privy.email ? ctx.crypto.hmac(`email:${privy.email}`) : null;
    if (emailHash) {
      const [other] = await ctx.db.select().from(schema.users).where(eq(schema.users.emailHash, emailHash));
      if (other && other.id !== userId) throw new HttpError(409, "email_in_use", "That email belongs to another account");
    }
    await ctx.db
      .update(schema.users)
      .set({
        privyDid: privy.did,
        ...(privy.email && emailHash
          ? { emailHash, emailEnc: ctx.crypto.encrypt(privy.email, `email:${userId}`), emailVerified: true }
          : {}),
      })
      .where(eq(schema.users.id, userId));
  }

  const [user] = await ctx.db
    .select({ adultConfirmedAt: schema.users.adultConfirmedAt, sessionVersion: schema.users.sessionVersion, deletedAt: schema.users.deletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user || user.deletedAt) throw new HttpError(403, "account_deleted", "This account was deleted");
  // Joining a league waits for the 18+ confirmation (FR-34); the invite is remembered in the browser.
  if (input.ref && user.adultConfirmedAt) await joinLeague(userId, input.ref, input.source ?? "direct").catch(() => null);
  await ctx.db.insert(schema.notificationPrefs).values({ userId }).onConflictDoNothing();
  // QIE ID: show the wallet's verified .qie name (best effort, at most 2.5 s).
  await Promise.race([refreshQieId(ctx, userId).catch(() => null), new Promise((r) => setTimeout(r, 2500))]);

  await setSessionCookie({ userId, wallet: getAddress(wallet), sv: user.sessionVersion });
  return json({ ok: true, userId, wallet: getAddress(wallet) });
});

/**
 * DELETE /api/v1/session: sign out. The session version is bumped, so this token (and any copy of
 * it) stops working everywhere, not only in this browser (audit S13).
 */
export const DELETE = route(async () => {
  const s = await getSession().catch(() => null);
  if (s) {
    await getCtx()
      .db.update(schema.users)
      .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(eq(schema.users.id, s.userId));
  }
  await clearSessionCookie();
  return json({ ok: true });
});

/** The one host sign-in messages may name: the configured site, or the request host in development. */
function siweHost(req: Request): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      return new URL(site).host;
    } catch {
      return null;
    }
  }
  return process.env.NODE_ENV === "production" ? null : new URL(req.url).host;
}
