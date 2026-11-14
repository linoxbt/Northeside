/**
 * Where people reach the team: NEXT_PUBLIC_CONTACT_EMAIL (inlined at build time). Without it,
 * contact buttons are hidden rather than pointing at an address nobody reads.
 */
export const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";

/** A mailto: link, or null when no contact address is configured. */
export function contactHref(subject: string): string | null {
  return contactEmail ? `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}` : null;
}

/** Human-readable contact for legal text. */
export const contactText = contactEmail || "the contact email published on this site";
