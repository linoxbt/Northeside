/**
 * Only same-origin paths, so ?next= cannot send people to another site. Parsed with URL, because
 * browsers treat "/\\evil.com" like "//evil.com" (audit S4).
 */
export function safeNext(raw: string | null, origin = typeof window === "undefined" ? "https://northeside.invalid" : window.location.origin) {
  if (!raw || /[\\\u0000-\u001f]/.test(raw)) return "/play";
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin || u.pathname.startsWith("/sign-in")) return "/play";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/play";
  }
}
