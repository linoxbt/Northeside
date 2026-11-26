import type { SealedPayload } from "@northeside/commitments";
import { api } from "./api";

/** Draft picks; `banker` is the doubled fixture (rules v2), null for none. */
export type Picks = { home: (number | null)[]; away: (number | null)[]; banker?: number | null };

export const sealedKey = (mw: number, wallet: string) => `ns_sealed_${mw}_${wallet.toLowerCase()}`;
/**
 * Seals sent (or being sent) whose result is not known yet, oldest first. Each attempt keeps its
 * own payload and salt until the chain shows which one counts (final review): a failed receipt
 * check or a second attempt must never delete the only copy of a salt that may still be mined.
 */
export const pendingKey = (mw: number, wallet: string) => `ns_pending_${mw}_${wallet.toLowerCase()}`;

export interface PendingSeal {
  payload: SealedPayload;
  txHash?: string;
  /** ms since epoch, when the attempt started. */
  createdAt: number;
}

/** A candidate that is not on-chain this long after it was sent can no longer be the seal. */
const PENDING_TTL_MS = 24 * 3600_000;

export function readPending(mw: number, wallet?: string | null): PendingSeal[] {
  if (!wallet) return [];
  try {
    const v = JSON.parse(localStorage.getItem(pendingKey(mw, wallet)) ?? "null") as PendingSeal[] | (LocalSeal & { createdAt?: number }) | null;
    if (!v) return [];
    // Before this change the slot held one object.
    return (Array.isArray(v) ? v : [{ payload: v.payload, txHash: v.txHash, createdAt: v.createdAt ?? Date.now() }]).filter((x) => x?.payload?.commitment);
  } catch {
    return [];
  }
}

function writePending(mw: number, wallet: string, list: PendingSeal[]) {
  if (list.length) localStorage.setItem(pendingKey(mw, wallet), JSON.stringify(list));
  else localStorage.removeItem(pendingKey(mw, wallet));
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Record an attempt before anything is sent. */
export function addPending(mw: number, wallet: string, payload: SealedPayload) {
  const list = readPending(mw, wallet).filter((x) => !same(x.payload.commitment, payload.commitment));
  writePending(mw, wallet, [...list, { payload, createdAt: Date.now() }]);
}

export function setPendingHash(mw: number, wallet: string, commitment: string, txHash: string) {
  writePending(mw, wallet, readPending(mw, wallet).map((x) => (same(x.payload.commitment, commitment) ? { ...x, txHash } : x)));
}

/** Only for an attempt that provably never reached the chain (cancelled in the wallet, or reverted). */
export function dropPending(mw: number, wallet: string, commitment: string) {
  writePending(mw, wallet, readPending(mw, wallet).filter((x) => !same(x.payload.commitment, commitment)));
}

/**
 * Settle pending attempts against what the chain holds for this wallet. The attempt whose
 * commitment is on-chain becomes the local backup (and is uploaded by the normal retry); attempts
 * older than a day that are not on-chain are dropped. Returns true when a backup was promoted.
 */
export function reconcilePending(mw: number, wallet: string, onChain: string | null | undefined, now = Date.now()): boolean {
  const list = readPending(mw, wallet);
  if (!list.length) return false;
  let promoted = false;
  const hit = onChain ? list.find((x) => same(x.payload.commitment, onChain)) : undefined;
  if (hit) {
    const cur = readLocalSeal(mw, wallet);
    if (!cur || !same(cur.payload.commitment, hit.payload.commitment)) {
      localStorage.setItem(sealedKey(mw, wallet), JSON.stringify({ payload: hit.payload, txHash: hit.txHash, synced: false } satisfies LocalSeal));
      promoted = true;
    }
  }
  writePending(mw, wallet, list.filter((x) => x !== hit && now - x.createdAt < PENDING_TTL_MS));
  return promoted;
}
/** Drafts on this device belong to one wallet (audit B14); a signed-out guest has its own slot. */
export const draftKey = (mw: number, wallet?: string | null) => (wallet ? `ns_draft_${mw}_${wallet.toLowerCase()}` : `ns_draft_${mw}`);

/**
 * This wallet's draft on this device. A guest draft (picks made before signing in) is adopted once by
 * the account that signs in, then removed, so it can never reach a second account.
 */
export function readDraft(mw: number, wallet?: string | null): Picks | null {
  const parse = (k: string) => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? "null") as Picks | null;
    } catch {
      return null;
    }
  };
  const own = parse(draftKey(mw, wallet));
  if (own || !wallet) return own;
  const guest = parse(draftKey(mw));
  if (guest) {
    localStorage.setItem(draftKey(mw, wallet), JSON.stringify(guest));
    localStorage.removeItem(draftKey(mw));
  }
  return guest;
}

export function writeDraft(mw: number, wallet: string | null | undefined, picks: Picks) {
  localStorage.setItem(draftKey(mw, wallet), JSON.stringify(picks));
}

/** On sign-out: no draft stays on a shared device for the next person (audit B14). */
export function clearDrafts() {
  for (const k of Object.keys(localStorage)) if (k.startsWith("ns_draft_")) localStorage.removeItem(k);
}

export interface LocalSeal {
  payload: SealedPayload;
  txHash?: string;
  synced: boolean;
}

export function readLocalSeal(mw: number, wallet?: string, key = sealedKey): LocalSeal | null {
  if (!wallet) return null;
  try {
    return JSON.parse(localStorage.getItem(key(mw, wallet)) ?? "null");
  } catch {
    return null;
  }
}


/** Send sealed picks (a local backup or an exported file) for a seal the server never received. */
export async function uploadPayload(mwId: number, payload: unknown) {
  await api(`/api/v1/predictions/${mwId}/reveal`, { method: "POST", json: { payload } });
}

/** Whether a seal's picks can still reach Northeside: until 10 minutes after the first kickoff. */
export const uploadWindowOpen = (lockTime: string | Date, now = Date.now()) => now < new Date(lockTime).getTime() + 10 * 60_000;

export async function syncSeal(mwId: number, wallet: string, local: LocalSeal) {
  try {
    await api("/api/v1/predictions/sealed", {
      method: "POST",
      headers: { "idempotency-key": `seal-${local.payload.commitment.slice(2, 34)}` },
      json: { payload: local.payload, txHash: local.txHash },
    });
  } catch (e) {
    // Too late to add (results proposed) or superseded on-chain: retrying cannot help, so stop.
    const code = (e as { code?: string }).code;
    if (code !== "reveals_closed" && code !== "superseded") throw e;
  }
  localStorage.setItem(sealedKey(mwId, wallet), JSON.stringify({ ...local, synced: true }));
}

