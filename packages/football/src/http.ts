import type { FetchLike } from "./types";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** GET JSON with a timeout and bounded retries on 429/5xx. Free tiers allow 10 calls a minute. */
export async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  { retries = 2, timeoutMs = 10_000, backoffMs = 6_500 } = {},
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: ctrl.signal });
      if (res.ok) return await res.json();
      const body = await res.text().catch(() => "");
      lastError = new ProviderError(provider, res.status, `HTTP ${res.status} ${body.slice(0, 200)}`);
      if (res.status !== 429 && res.status < 500) throw lastError;
    } catch (e) {
      lastError = e;
      if (e instanceof ProviderError && e.status !== 429 && e.status < 500) throw e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
  }
  throw lastError;
}
