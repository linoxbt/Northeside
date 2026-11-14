/**
 * Where people reach the team. Set NEXT_PUBLIC_CONTACT_EMAIL to an address you control (inlined at
 * build time). Until then, links go to the public repository, never to a domain nobody owns
 * (audit G10: northeside.app does not exist, so mail to it bounces or could be squatted).
 */
export const REPO_URL = "https://github.com/linoxbt/Northeside";
export const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";

/** A mailto: link when an address is configured, otherwise the repository's contact route. */
export function contactHref(subject: string, fallback: "security" | "issues" = "issues") {
  if (contactEmail) return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`;
  return fallback === "security" ? `${REPO_URL}/security/advisories/new` : `${REPO_URL}/issues/new?title=${encodeURIComponent(subject)}`;
}

/** Human-readable contact for legal text. */
export const contactText = contactEmail || `the contact link on ${REPO_URL}`;
