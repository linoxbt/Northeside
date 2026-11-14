import { schema } from "@northeside/db";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { formatEther, getAddress, type Address } from "viem";
import { need, type CoreContext } from "./context";

export class DripRefused extends Error {
  constructor(
    readonly code: "email_unverified" | "not_your_wallet" | "has_balance" | "already_dripped" | "daily_cap" | "drip_empty" | "not_configured",
    message: string,
  ) {
    super(message);
  }
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
  req: { userId: string; wallet: Address; deviceId: string; emailVerified: boolean; emailHash: string | null },
) {
  if (!cfg || !ctx.drip) throw new DripRefused("not_configured", "Gas drip is not available right now");
  const drip = ctx.drip;
  const wallet = getAddress(req.wallet);
  if (!req.emailVerified || !req.emailHash) throw new DripRefused("email_unverified", "Verify your email to get free gas");

  const [owned] = await ctx.db
    .select()
    .from(schema.wallets)
    .where(and(eq(schema.wallets.address, wallet.toLowerCase()), eq(schema.wallets.userId, req.userId)));
  if (!owned) throw new DripRefused("not_your_wallet", "That wallet is not linked to your account");

  const [already] = await ctx.db.select().from(schema.drips).where(eq(schema.drips.wallet, wallet.toLowerCase()));
  if (already && already.status !== "failed") return { status: "already", txHash: already.txHash };

  const balance = await ctx.publicClient.getBalance({ address: wallet });
  if (balance > 0n) throw new DripRefused("has_balance", "This wallet already has gas");

  if ((await spentLast24h(ctx)) + cfg.amountWei > cfg.dailyCapWei) {
    await ctx.alert("gas drip daily cap reached; drip paused until the window rolls over");
    throw new DripRefused("daily_cap", "Free gas is paused for today. Try again tomorrow.");
  }
  const dripBalance = await ctx.publicClient.getBalance({ address: drip.account.address });
  if (dripBalance < cfg.amountWei * 2n) {
    await ctx.alert(`gas drip wallet nearly empty: ${formatEther(dripBalance)} QIEV3 left`);
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

  try {
    // One sender at a time for the drip key, with an explicit nonce, across every server instance
    // (a transaction-scoped advisory lock works through the transaction pooler) (audit B12).
    const txHash = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('northeside:drip-signer'))`);
      const nonce = await ctx.publicClient.getTransactionCount({ address: drip.account.address, blockTag: "pending" });
      const hash = await drip.sendTransaction({ to: wallet, value: cfg.amountWei, nonce });
      await tx.update(schema.drips).set({ txHash: hash, status: "sent" }).where(eq(schema.drips.id, row.id));
      return hash;
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 }).catch(() => null);
    if (receipt?.status === "success") {
      await ctx.db.update(schema.drips).set({ status: "confirmed" }).where(eq(schema.drips.id, row.id));
    }
    return { status: receipt?.status === "success" ? "confirmed" : "sent", txHash };
  } catch (e) {
    // Free the unique slots so the player can try again.
    await ctx.db.delete(schema.drips).where(eq(schema.drips.id, row.id));
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
  if (low) await ctx.alert(`gas drip wallet low: ${formatEther(balance)} QIEV3 (${daysLeft} days of cap)`);
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
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash: d.txHash as `0x${string}` }).catch(() => null);
    if (receipt?.status === "success") {
      await ctx.db.update(schema.drips).set({ status: "confirmed" }).where(eq(schema.drips.id, d.id));
      confirmed++;
      continue;
    }
    const pendingTx = receipt ? null : await ctx.publicClient.getTransaction({ hash: d.txHash as `0x${string}` }).catch(() => null);
    if (receipt?.status === "reverted" || !pendingTx) {
      await ctx.db.delete(schema.drips).where(eq(schema.drips.id, d.id));
      freed++;
    }
  }
  if (freed > 0) await ctx.alert(`gas drip: ${freed} drip(s) were dropped or reverted and can be requested again`);
  return { confirmed, freed };
}
