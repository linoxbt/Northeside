export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

/** A stable random id for this browser, used only to limit the gas drip to one per device. */
export function deviceId(): string {
  const k = "ns_device";
  let id = localStorage.getItem(k);
  if (!id) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(k, id);
  }
  return id;
}

/** Product analytics (PostHog), only if configured. Wallets, people and transactions are separate events. */
export function track(event: string, props: Record<string, unknown> = {}) {
  const ph = (globalThis as { posthog?: { capture(e: string, p: unknown): void } }).posthog;
  const ref = typeof localStorage !== "undefined" ? localStorage.getItem("ns_ref") : null;
  ph?.capture(event, { league_slug: ref, source: localStorage.getItem("ns_src") ?? "direct", ...props });
}
