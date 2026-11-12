import "server-only";

/**
 * The app runs in preview mode until the production backend exists: no database, no deployed
 * contracts, no secrets. Pages then render "launching soon" states instead of failing.
 */
export function backendConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    env.DATABASE_URL &&
      env.DATA_ENCRYPTION_KEY &&
      env.SESSION_SECRET &&
      (env.NEXT_PUBLIC_MATCHWEEKS_ADDRESS || env.MATCHWEEKS_ADDRESS) &&
      (env.NEXT_PUBLIC_HOST_REWARDS_ADDRESS || env.HOST_REWARDS_ADDRESS) &&
      (env.NEXT_PUBLIC_IDENTITY_ADDRESS || env.IDENTITY_ADDRESS),
  );
}

/** Run a data loader; in preview mode or on failure, return the fallback instead of throwing. */
export async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!backendConfigured()) return fallback;
  try {
    return await fn();
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "page data failed", error: e instanceof Error ? e.message : String(e) }));
    return fallback;
  }
}
