import { schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { getAddress, parseAbi, type Address } from "viem";
import type { CoreContext } from "./context";

/**
 * QIE ID names (.qie). QIE's name registry on chain 1990 is public: a reverse lookup gives a
 * wallet's name and a forward lookup gives a name's owner. Northeside only shows a name after both
 * agree (a stale reverse record, or a typed-in name the wallet does not own, is never shown).
 * The registry address comes from configuration (QIE_ID_REGISTRY_ADDRESS).
 */
export const qieIdRegistryAbi = parseAbi([
  "function userDomain(address wallet) view returns (string)",
  "function resolver(string name) view returns (uint256 tokenId, address owner)",
]);

export const QIE_NAME = /^[a-z0-9-]{1,63}\.qie$/;

/** The owner of a .qie name, or null (unknown name, bad format, no registry configured). */
export async function qieNameOwner(ctx: CoreContext, name: string): Promise<Address | null> {
  const registry = ctx.deployment.qieIdRegistry;
  const n = name.trim().toLowerCase();
  if (!registry || !QIE_NAME.test(n)) return null;
  const [, owner] = await ctx.publicClient.readContract({ address: registry, abi: qieIdRegistryAbi, functionName: "resolver", args: [n] });
  return /^0x0{40}$/i.test(owner) ? null : getAddress(owner);
}

/** A wallet's .qie name, confirmed by the forward lookup; null if it has none. */
export async function qieNameOf(ctx: CoreContext, wallet: string): Promise<string | null> {
  const registry = ctx.deployment.qieIdRegistry;
  if (!registry) return null;
  const w = getAddress(wallet);
  const raw = await ctx.publicClient.readContract({ address: registry, abi: qieIdRegistryAbi, functionName: "userDomain", args: [w] });
  const name = raw.trim().toLowerCase();
  if (!QIE_NAME.test(name)) return null;
  const owner = await qieNameOwner(ctx, name);
  return owner === w ? name : null;
}

/** Whether one of these wallets owns the name. */
export async function ownsQieName(ctx: CoreContext, name: string, wallets: string[]) {
  const owner = await qieNameOwner(ctx, name);
  return !!owner && wallets.some((w) => getAddress(w) === owner);
}

/**
 * Bring a player's .qie name up to date from the chain: keep a verified name they still own,
 * otherwise adopt the name of any of their wallets, and drop a verified name they no longer own.
 * Without a registry configured, nothing changes. RPC errors leave the stored value untouched.
 */
export async function refreshQieId(ctx: CoreContext, userId: string): Promise<{ qieId: string | null; resolved: boolean; changed: boolean }> {
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u || u.deletedAt) return { qieId: null, resolved: false, changed: false };
  const current = { qieId: u.qieId, resolved: u.qieIdResolved, changed: false };
  if (!ctx.deployment.qieIdRegistry) return current;
  const wallets = (await ctx.db.select({ address: schema.wallets.address }).from(schema.wallets).where(eq(schema.wallets.userId, userId))).map((w) => w.address);
  if (wallets.length === 0) return current;

  if (u.qieId && (await ownsQieName(ctx, u.qieId, wallets))) {
    if (u.qieIdResolved) return current;
    await ctx.db.update(schema.users).set({ qieIdResolved: true }).where(eq(schema.users.id, userId));
    return { qieId: u.qieId, resolved: true, changed: true };
  }
  for (const w of wallets) {
    const name = await qieNameOf(ctx, w);
    if (name) {
      await ctx.db.update(schema.users).set({ qieId: name, qieIdResolved: true }).where(eq(schema.users.id, userId));
      return { qieId: name, resolved: true, changed: name !== u.qieId || !u.qieIdResolved };
    }
  }
  if (u.qieId) {
    // A name they no longer own (or never owned) is not shown anywhere.
    await ctx.db.update(schema.users).set({ qieId: null, qieIdResolved: false }).where(eq(schema.users.id, userId));
    return { qieId: null, resolved: false, changed: true };
  }
  return current;
}

/** Refresh every player who has sealed a slip (daily job). */
export async function refreshAllQieIds(ctx: CoreContext) {
  if (!ctx.deployment.qieIdRegistry) return { skipped: "QIE ID registry not configured" };
  const rows = await ctx.db.selectDistinct({ userId: schema.predictions.userId }).from(schema.predictions).where(eq(schema.predictions.txStatus, "confirmed"));
  let changed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      if ((await refreshQieId(ctx, r.userId)).changed) changed++;
    } catch {
      failed++;
    }
  }
  return { players: rows.length, changed, failed };
}
