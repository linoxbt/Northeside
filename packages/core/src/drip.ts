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
  const since = new Date(ctx.now().getTime() - 24 * 3600_000);
  const [row] = await ctx.db
    .select({ total: sql<string>`coalesce(sum(${schema.drips.amountWei}), 0)` })
    .from(schema.drips)
    .where(and(gte(schema.drips.createdAt, since), ne(schema.drips.status, "failed")));
  return BigInt(row?.total ?? 0);
}

/**
 * FR-05: one small QIEV3 drip per verified email, wallet and device, only to empty wallets created
 * or connected through Northeside, under a daily cap. Idempotent per wallet.
 */
export async function requestDrip(
  ctx: CoreContext,
  cfg: DripConfig | null,
  req: { userId: string; wallet: Address; deviceId: string; emailVerified: boolean },
) {
  if (!cfg || !ctx.drip) throw new DripRefused("not_configured", "Gas drip is not available right now");
  const drip = ctx.drip;
  const wallet = getAddress(req.wallet);
  if (!req.emailVerified) throw new DripRefused("email_unverified", "Verify your email to get free gas");

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
    .values({ userId: req.userId, wallet: wallet.toLowerCase(), deviceHash, amountWei: cfg.amountWei, status: "pending" })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) throw new DripRefused("already_dripped", "Free gas was already sent to this account or device");
  const row = inserted[0]!;

  try {
    const txHash = await drip.sendTransaction({ to: wallet, value: cfg.amountWei });
    await ctx.db.update(schema.drips).set({ txHash, status: "sent" }).where(eq(schema.drips.id, row.id));
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
  const balance = await ctx.publicClient.getBalance({ address: drip.account.address });
  const spent = await spentLast24h(ctx);
  const daysLeft = cfg && cfg.dailyCapWei > 0n ? Number((balance * 100n) / cfg.dailyCapWei) / 100 : null;
  const low = cfg ? balance < cfg.amountWei * 50n : false;
  if (low) await ctx.alert(`gas drip wallet low: ${formatEther(balance)} QIEV3 (${daysLeft} days of cap)`);
  return { address: drip.account.address, balanceWei: balance, spent24hWei: spent, daysOfCapLeft: daysLeft, low };
}
