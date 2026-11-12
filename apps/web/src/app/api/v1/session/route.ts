import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import { HttpError, json, limitWrites, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { verifyPrivyToken } from "@/lib/server/privy";
import { joinLeague, userById, walletsOf, isVerifiedUser } from "@/lib/server/services/accounts";
import { checkNonce, clearSessionCookie, getSession, setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/session: current user, wallets, verified status. */
export const GET = route(async () => {
  const s = await getSession();
  if (!s) return json({ user: null });
  const user = await userById(s.userId);
  if (!user) return json({ user: null });
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
  });
});

const body = z.object({
  message: z.string().max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  walletKind: z.enum(["embedded", "external"]),
  privyToken: z.string().max(4000).optional(),
  ref: z.string().regex(/^[a-z0-9-]{2,32}$/i).optional(),
  source: z.enum(["whatsapp", "x", "telegram", "direct"]).optional(),
});

/** POST /api/v1/session: sign in with a wallet signature (EIP-4361), optionally with a Privy email. */
export const POST = route(async (req) => {
  await limitWrites(null, "session", 0, 20);
  const input = body.parse(await req.json());
  const ctx = getCtx();
  const parsed = parseSiweMessage(input.message);
  const host = new URL(req.url).host;
  if (!parsed.address || !parsed.nonce || parsed.domain !== host) {
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
    userId = byDid?.id ?? null;
  }
  if (!userId) {
    const [created] = await ctx.db.insert(schema.users).values({}).returning();
    userId = created!.id;
  }
  if (!walletRow) {
    await ctx.db.insert(schema.wallets).values({ address: wallet, userId, kind: input.walletKind }).onConflictDoNothing();
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

  if (input.ref) await joinLeague(userId, input.ref, input.source ?? "direct").catch(() => null);
  await ctx.db.insert(schema.notificationPrefs).values({ userId }).onConflictDoNothing();

  await setSessionCookie({ userId, wallet: getAddress(wallet) });
  return json({ ok: true, userId, wallet: getAddress(wallet) });
});

export const DELETE = route(async () => {
  await clearSessionCookie();
  return json({ ok: true });
});
