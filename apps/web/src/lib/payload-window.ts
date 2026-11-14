/**
 * Payloads must reach Northeside by the first kickoff, plus a short grace for a seal mined seconds
 * before lock whose upload was still in flight. Later uploads are refused: otherwise a player who
 * sealed different picks from several wallets could reveal only the best one once scores are known
 * (final review H-2).
 */
export const LATE_PAYLOAD_GRACE_MS = 10 * 60_000;

export function payloadWindowOpen(lockTime: Date, now: Date = new Date()): boolean {
  return now.getTime() < lockTime.getTime() + LATE_PAYLOAD_GRACE_MS;
}
