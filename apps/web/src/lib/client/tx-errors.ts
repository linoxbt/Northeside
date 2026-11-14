/** Shared, dependency-free so pages can map wallet errors without loading wallet code. */
/** Plain-language messages for wallet and transaction failures (audit B13). */
export function txError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rejected|denied|4001|cancel/i.test(msg)) return "You cancelled the transaction.";
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(msg)) return "Not enough QIEV3 for gas. Wait for the free gas to arrive, then try again.";
  if (/chain mismatch|does not match the target chain|wrong network|4902|Unrecognized chain/i.test(msg)) return "Your wallet is on another network. Switch it to QIE, then try again.";
  if (/connector not connected|not connected|no account/i.test(msg)) return "Your wallet is not connected. Reconnect it, then try again.";
  if (/Locked|after lock|AfterLock|TooLate/i.test(msg)) return "This matchweek is locked; seals are closed.";
  if (/timed out|timeout/i.test(msg)) return "Still waiting for the network. Your seal may still go through: check your receipt in a minute before trying again.";
  return msg.split("\n")[0]!.slice(0, 200);
}

