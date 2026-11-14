import "server-only";
import { createJobs } from "@northeside/core";
import { getCtx } from "./ctx";

/**
 * Scheduled jobs (spec 10.3), shared with the ops-worker background function. The cron route runs
 * one job on demand (operator, CLI, tests); in production the worker runs them on a schedule.
 */
export const JOBS = createJobs(getCtx, process.env);
export type { JobName } from "@northeside/core";
