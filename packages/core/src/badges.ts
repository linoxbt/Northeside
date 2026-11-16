import { badgesAbi } from "@northeside/chain";
import { schema } from "@northeside/db";
import { buildBadgesTree } from "@northeside/merkle";
import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { need, type CoreContext } from "./context";
import { BADGES, playerCard, type BadgeId } from "./fun";
import { audit, confirm, sendWrite } from "./ops";

/**
 * FR-39 on-chain badges. Every few hours the worker builds one cumulative Merkle root of every
 * (wallet, badgeId) earned so far and posts it to NorthesideBadges; each player then mints their
 * own soulbound badge from their own wallet. Badges carry no value and pay nothing.
 */

/** On-chain badge number for a badge (1-based position in BADGES: append only, never reorder). */
export const badgeNumber = (id: BadgeId) => BADGES.findIndex((b) => b.id === id) + 1;
export const badgeById = (n: number) => BADGES[n - 1] ?? null;

interface StoredTree {
  root: Hex;
  round: number | null;
  status: "pending" | "confirmed";
  txHash: Hex | null;
  leaves: { wallet: Address; badgeId: number }[];
  proofs: Hex[][];
  builtAt: string;
}
const KEY = "badges:tree";

async function stored(ctx: CoreContext): Promise<StoredTree | null> {
  const [row] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  return (row?.value as StoredTree | undefined) ?? null;
}
async function store(ctx: CoreContext, t: StoredTree) {
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: KEY, value: t as unknown as object })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: t as unknown as object, updatedAt: new Date() } });
}

/**
 * Every earned badge, for the wallet that sealed each player's first slip (one wallet per player,
 * so a badge is minted once). Sorted, so the same facts give the same root.
 */
export async function badgeLeaves(ctx: CoreContext) {
  const rows = await ctx.db
    .select({ userId: schema.predictions.userId, wallet: schema.predictions.wallet, sealedAt: schema.predictions.sealedAt })
    .from(schema.predictions)
    .where(eq(schema.predictions.txStatus, "confirmed"));
  const first = new Map<string, { wallet: string; t: number }>();
  for (const r of rows) {
    const t = r.sealedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const cur = first.get(r.userId);
    if (!cur || t < cur.t) first.set(r.userId, { wallet: r.wallet, t });
  }
  const leaves: { wallet: Address; badgeId: number }[] = [];
  for (const [userId, { wallet }] of first) {
    const [u] = await ctx.db.select({ deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, userId));
    if (!u || u.deletedAt) continue;
    const card = await playerCard(ctx, userId);
    for (const b of card.badges) if (b.earned) leaves.push({ wallet: getAddress(wallet), badgeId: badgeNumber(b.id) });
  }
  return leaves.sort((a, b) => (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : a.wallet.toLowerCase() > b.wallet.toLowerCase() ? 1 : a.badgeId - b.badgeId));
}

/** Post a new cumulative root when the earned set changed. Skips until the contract is configured. */
export async function postBadgeRoot(ctx: CoreContext) {
  const address = ctx.deployment.badges;
  if (!address) return { skipped: "badges contract not configured" };
  const operator = need(ctx.operator, "OPERATOR_PRIVATE_KEY");
  const prev = await stored(ctx);

  // A post that was sent but not confirmed: settle it first.
  if (prev?.status === "pending" && prev.txHash) {
    const ok = await ctx.publicClient.getTransactionReceipt({ hash: prev.txHash }).then((r) => r.status === "success", () => false);
    if (ok) {
      await store(ctx, { ...prev, status: "confirmed", round: await roundOf(ctx, address, prev.root) });
      return { settled: prev.root };
    }
  }

  const leaves = await badgeLeaves(ctx);
  if (leaves.length === 0) return { skipped: "no badges earned yet" };
  const tree = buildBadgesTree(leaves);
  if (prev?.status === "confirmed" && prev.root.toLowerCase() === tree.root.toLowerCase()) return { skipped: "no new badges", root: tree.root, round: prev.round };

  const { request } = await ctx.publicClient.simulateContract({ account: operator.account, address, abi: badgesAbi, functionName: "postRoot", args: [tree.root] });
  const next: StoredTree = { root: tree.root, round: null, status: "pending", txHash: null, leaves, proofs: leaves.map((_, i) => tree.proof(i)), builtAt: ctx.now().toISOString() };
  const tx = await sendWrite(ctx, operator, request);
  await store(ctx, { ...next, txHash: tx });
  await confirm(ctx, tx, "Badges postRoot");
  const round = await roundOf(ctx, address, tree.root);
  await store(ctx, { ...next, txHash: tx, status: "confirmed", round });
  await audit(ctx, "operator", "badges-post-root", { root: tree.root, round, leaves: leaves.length }, tx);
  return { root: tree.root, round, leaves: leaves.length, txHash: tx };
}

/** The latest round holding `root` (searched from the newest). */
async function roundOf(ctx: CoreContext, address: Address, root: Hex): Promise<number | null> {
  const n = Number(await ctx.publicClient.readContract({ address, abi: badgesAbi, functionName: "rounds" }));
  for (let r = n; r >= Math.max(1, n - 20); r--) {
    const got = await ctx.publicClient.readContract({ address, abi: badgesAbi, functionName: "roots", args: [BigInt(r)] });
    if (got.toLowerCase() === root.toLowerCase()) return r;
  }
  return null;
}

export interface BadgeClaim {
  badgeId: number;
  slug: BadgeId;
  name: string;
  wallet: Address;
  round: number;
  proof: Hex[];
  claimed: boolean;
}

/** What this player can mint (or has minted) from the latest posted root. */
export async function badgeClaimsFor(ctx: CoreContext, wallets: string[]): Promise<{ address: Address | null; claims: BadgeClaim[] }> {
  const address = ctx.deployment.badges ?? null;
  const t = await stored(ctx);
  if (!address || !t || t.status !== "confirmed" || t.round === null) return { address, claims: [] };
  const mine = new Set(wallets.map((w) => w.toLowerCase()));
  const out: BadgeClaim[] = [];
  for (let i = 0; i < t.leaves.length; i++) {
    const l = t.leaves[i]!;
    if (!mine.has(l.wallet.toLowerCase())) continue;
    const b = badgeById(l.badgeId);
    if (!b) continue;
    const claimed = await ctx.publicClient.readContract({ address, abi: badgesAbi, functionName: "claimed", args: [l.wallet, BigInt(l.badgeId)] }).catch(() => false);
    out.push({ badgeId: l.badgeId, slug: b.id, name: b.name, wallet: l.wallet, round: t.round, proof: t.proofs[i]!, claimed });
  }
  return { address, claims: out };
}
