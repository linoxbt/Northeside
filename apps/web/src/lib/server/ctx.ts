import "server-only";
import { createContextFromEnv, type CoreContext } from "@northeside/core";

let ctx: CoreContext | undefined;

/** One core context per server process. */
export function getCtx(): CoreContext {
  ctx ??= createContextFromEnv(process.env);
  return ctx;
}
