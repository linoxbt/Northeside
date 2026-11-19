import type { SealedPayload } from "@northeside/commitments";
import { api } from "./api";

/** Draft picks; `banker` is the doubled fixture (rules v2), null for none. */
export type Picks = { home: (number | null)[]; away: (number | null)[]; banker?: number | null };

export const sealedKey = (mw: number, wallet: string) => `ns_sealed_${mw}_${wallet.toLowerCase()}`;
/** A seal whose transaction has not succeeded yet. Promoted to sealedKey only after its receipt (audit B6). */
export const pendingKey = (mw: number, wallet: string) => `ns_pending_${mw}_${wallet.toLowerCase()}`;
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

