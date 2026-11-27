import "server-only";
import { deploymentFromEnv } from "@northeside/chain";
import { createContextFromEnv, type CoreContext } from "@northeside/core";

let ctx: CoreContext | undefined;

/**
 * Web functions never sign as the operator or the results publisher on mainnet: those signers exist
 * only in the ops-worker background function, so no web route can post a matchweek, results or a
 * reward root, even through a bug (audit 27 Nov, S1). WEB_SIGNERS=1 lets a local or test chain run
 * the whole pipeline through the cron route (the e2e suite); it has no effect on chain 1990.
 */
export function webSigners(): boolean {
  return process.env.WEB_SIGNERS === "1" && deploymentFromEnv(process.env).chainId !== 1990;
}

/** One core context per server process. The drip and attester keys stay: their routes need them. */
export function getCtx(): CoreContext {
  ctx ??= createContextFromEnv(process.env, webSigners() ? {} : { operator: undefined, results: undefined });
  return ctx;
}
