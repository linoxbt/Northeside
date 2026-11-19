import { schema } from "@northeside/db";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { formatEther, getAddress, type Address } from "viem";
import { need, type CoreContext } from "./context";
import { alertOnce, sixHourBlock } from "./ops";

export class DripRefused extends Error {
  constructor(
    readonly code: "email_unverified" | "disposable_email" | "not_your_wallet" | "has_balance" | "already_dripped" | "daily_cap" | "drip_empty" | "not_configured",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Throwaway inboxes make farming the drip free (audit S9). Not exhaustive: it raises the cost of the
 * common ones; the daily cap bounds the rest.
 */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamailblock.com", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "tempmail.net", "tempmailo.com", "tempr.email", "yopmail.com", "yopmail.net",
  "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com",
  "mintemail.com", "mohmal.com", "emailondeck.com", "1secmail.com", "1secmail.org", "1secmail.net", "spamgourmet.com", "mailnesia.com",
  "mytemp.email", "burnermail.io", "inboxkitten.com", "tempinbox.com", "discard.email", "mail.tm", "linshiyouxiang.net", "moakt.com",
]);
export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@").pop()?.trim().toLowerCase() ?? "";
  return DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`));
}

export interface DripConfig {
  amountWei: bigint;
  dailyCapWei: bigint;
}

export function dripConfigFromEnv(env: Record<string, string | undefined> = process.env): DripConfig | null {
  if (!env.DRIP_AMOUNT_WEI || !env.DRIP_DAILY_CAP_WEI) return null;
  return { amountWei: BigInt(env.DRIP_AMOUNT_WEI), dailyCapWei: BigInt(env.DRIP_DAILY_CAP_WEI) };
}

async function spentLast24h(ctx: CoreContext) {
  // The window uses the database clock, the same clock that stamped created_at.
  const [row] = await ctx.db
    .select({ total: sql<string>`coalesce(sum(${schema.drips.amountWei}), 0)` })
    .from(schema.drips)
    .where(and(gte(schema.drips.createdAt, sql`now() - interval '24 hours'`), ne(schema.drips.status, "failed")));
  return BigInt(row?.total ?? 0);
}

/**
 * FR-05: one small QIEV3 drip per verified email, wallet and device, only to empty wallets created
 * or connected through Northeside, under a daily cap. Idempotent per wallet.
 */
export async function requestDrip(
  ctx: CoreContext,
  cfg: DripConfig | null,
  req: { userId: string; wallet: Address; deviceId: string; emailVerified: boolean; emailHash: string | null; email?: string | null },
) {
  if (!cfg || !ctx.drip) throw new DripRefused("not_configured", "Gas drip is not available right now");
  const drip = ctx.drip;
  const wallet = getAddress(req.wallet);
  if (!req.emailVerified || !req.emailHash) throw new DripRefused("email_unverified", "Verify your email to get free gas");
  if (req.email && isDisposableEmail(req.email)) throw new DripRefused("disposable_email", "Free gas needs a permanent email address");

  const [owned] = await ctx.db
    .select()
    .from(schema.wallets)
    .where(and(eq(schema.wallets.address, wallet.toLowerCase()), eq(schema.wallets.userId, req.userId)));
  if (!owned) throw new DripRefused("not_your_wallet", "That wallet is not linked to your account");

  const [already] = await ctx.db.select().from(schema.drips).where(eq(schema.drips.wallet, wallet.toLowerCase()));
  if (already && already.status !== "failed") return { status: "already", txHash: already.txHash };

  const balance = await ctx.publicClient.getBalance({ address: wallet });
  if (balance > 0n) throw new DripRefused("has_balance", "This wallet already has gas");

  const capReached = () =>
    alertOnce(ctx, `drip-cap:${ctx.now().toISOString().slice(0, 10)}`, "gas drip daily cap reached; drip paused until the window rolls over");
  if ((await spentLast24h(ctx)) + cfg.amountWei > cfg.dailyCapWei) {
    await capReached();
    throw new DripRefused("daily_cap", "Free gas is paused for today. Try again tomorrow.");
  }
  const dripBalance = await ctx.publicClient.getBalance({ address: drip.account.address });
  if (dripBalance < cfg.amountWei * 2n) {
    await alertOnce(ctx, `drip-empty:${sixHourBlock(ctx.now())}`, `gas drip wallet nearly empty: ${formatEther(dripBalance)} QIEV3 left`);
    throw new DripRefused("drip_empty", "Free gas is temporarily unavailable");
  }

  const deviceHash = ctx.crypto.hmac(`device:${req.deviceId}`);
  if (already) await ctx.db.delete(schema.drips).where(eq(schema.drips.id, already.id));
  const inserted = await ctx.db
    .insert(schema.drips)
    // email_hash survives account deletion, so deleting and signing up again cannot drip twice (audit S5).
    .values({ userId: req.userId, wallet: wallet.toLowerCase(), deviceHash, emailHash: req.emailHash, amountWei: cfg.amountWei, status: "pending" })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) throw new DripRefused("already_dripped", "Free gas was already sent to this account or device");
  const row = inserted[0]!;

  // Once a transaction is sent its row is never deleted, so a later error cannot pay twice (audit B10).
  let sentHash: `0x${string}` | null = null;
  try {
    // One sender at a time for the drip key, with an explicit nonce, across every server instance
    // (a transaction-scoped advisory lock works through the transaction pooler) (audit B12). The
    // daily cap is checked again under the lock, counting this drip, so concurrent requests cannot
    // overshoot it (audit B10).
    const txHash = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('northeside:drip-signer'))`);
      const [spent] = await tx
        .select({ total: sql<string>`coalesce(sum(${schema.drips.amountWei}), 0)` })
        .from(schema.drips)
        .where(and(gte(schema.drips.createdAt, sql`now() - interval '24 hours'`), ne(schema.drips.status, "failed")));
      if (BigInt(spent?.total ?? 0) > cfg.dailyCapWei) throw new DripRefused("daily_cap", "Free gas is paused for today. Try again tomorrow.");
      const nonce = await ctx.publicClient.getTransactionCount({ address: drip.account.address, blockTag: "pending" });
      const hash = await drip.sendTransaction({ to: wallet, value: cfg.amountWei, nonce });
      sentHash = hash;
      await tx.update(schema.drips).set({ txHash: hash, status: "sent" }).where(eq(schema.drips.id, row.id));
      return hash;
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 }).catch(() => null);
    if (receipt?.status === "success") {
      await ctx.db.update(schema.drips).set({ status: "confirmed" }).where(eq(schema.drips.id, row.id));
    }
    return { status: receipt?.status === "success" ? "confirmed" : "sent", txHash };
  } catch (e) {
    if (sentHash) {
      // The QIEV3 is on its way: record it (the transaction above may have rolled back) and let
      // reconcileDrips confirm or free it later. Never free the slot here.
      await ctx.db.update(schema.drips).set({ txHash: sentHash, status: "sent" }).where(eq(schema.drips.id, row.id));
      return { status: "sent", txHash: sentHash };
    }
    // Nothing was sent: free the unique slots so the player can try again.
    await ctx.db.delete(schema.drips).where(eq(schema.drips.id, row.id));
    if (e instanceof DripRefused && e.code === "daily_cap") await capReached();
    throw e;
  }
}

/** FR-06: balance alarm and daily spend, for the operator status page and the drip-health job. */
export async function dripHealth(ctx: CoreContext, cfg: DripConfig | null) {
  const drip = need(ctx.drip, "DRIP_PRIVATE_KEY");
  const reconciled = await reconcileDrips(ctx);
  const balance = await ctx.publicClient.getBalance({ address: drip.account.address });
  const spent = await spentLast24h(ctx);
  const daysLeft = cfg && cfg.dailyCapWei > 0n ? Number((balance * 100n) / cfg.dailyCapWei) / 100 : null;
  // Alert with a day of budget left, so there is time to top up before players are refused.
  const low = cfg ? balance < cfg.dailyCapWei : false;
  if (low) await alertOnce(ctx, `drip-low:${sixHourBlock(ctx.now())}`, `gas drip wallet low: ${formatEther(balance)} QIEV3 (${daysLeft} days of cap)`);
  return { address: drip.account.address, balanceWei: balance, spent24hWei: spent, daysOfCapLeft: daysLeft, low, reconciled };
}

/**
 * Drips marked "sent" whose transaction never confirmed: confirm the mined ones, and free the slot of
 * any that reverted or were dropped so the player can ask again (audit B12).
 */
export async function reconcileDrips(ctx: CoreContext) {
  const stuck = await ctx.db
    .select()
    .from(schema.drips)
    .where(and(eq(schema.drips.status, "sent"), sql`${schema.drips.createdAt} < now() - interval '10 minutes'`));
  let confirmed = 0;
  let freed = 0;
  for (const d of stuck) {
    if (!d.txHash) continue;
    const hash = d.txHash as `0x${string}`;
    // A receipt lookup that fails is "unknown", not "dropped": try again next run (audit B10).
    let receipt: Awaited<ReturnType<typeof ctx.publicClient.getTransactionReceipt>> | null;
    try {
      receipt = await ctx.publicClient.getTransactionReceipt({ hash });
    } catch (e) {
      if (!/not found|could not be found/i.test(e instanceof Error ? e.message : String(e))) continue;
      receipt = null;
    }
    if (receipt?.status === "success") {
      await ctx.db.update(schema.drips).set({ status: "confirmed" }).where(eq(schema.drips.id, d.id));
      confirmed++;
      continue;
    }
    let known = true;
    if (!receipt) {
      try {
        await ctx.publicClient.getTransaction({ hash });
      } catch (e) {
        if (!/not found|could not be found/i.test(e instanceof Error ? e.message : String(e))) continue;
        known = false;
      }
    }
    if (receipt?.status === "reverted" || !known) {
      await ctx.db.delete(schema.drips).where(eq(schema.drips.id, d.id));
      freed++;
    }
  }
  // A row still "pending" with no transaction after 30 minutes was never sent (the sender records
  // every hash it sends): free it (audit B10).
  const neverSent = await ctx.db
    .delete(schema.drips)
    .where(and(eq(schema.drips.status, "pending"), sql`${schema.drips.txHash} is null`, sql`${schema.drips.createdAt} < now() - interval '30 minutes'`))
    .returning({ id: schema.drips.id });
  freed += neverSent.length;
  if (freed > 0) await ctx.alert(`gas drip: ${freed} drip(s) were dropped or reverted and can be requested again`);
  return { confirmed, freed };
}
