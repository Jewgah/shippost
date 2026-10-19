import type { DraftOption } from "./draftParser";

export interface CommentLinks {
  /** brand.siteUrl: the author's own site (jordanperez.dev). */
  siteUrl: string;
  /** brand.landingUrl: the Infinify AI diagnostic offer. */
  landingUrl: string;
}

/**
 * The first comment the queue panel starts with (Jordan, 2026-10-15):
 *  - the company page post and its repost, and any post unrelated to Infinify: the site link;
 *  - a profile-only post about Infinify (AI for a client's business): the Infinify offer link.
 * Infinify-related = the client-outcome pillar, or the option already links the offer.
 * Section C is kept when it already points at the right link, so its wording survives.
 */
export function defaultComment(option: DraftOption, mode: "personal" | "company", links: CommentLinks): string {
  const c = /^\(?\s*no link/i.test(option.firstComment) ? "" : option.firstComment.trim();
  const landing = links.landingUrl.trim();
  const site = links.siteUrl.trim();
  const infinify =
    Boolean(landing) && (option.pillar === "client-outcome" || [c, option.companyPost].some((t) => t.includes(landing)));
  if (mode === "personal" && infinify)
    return c.includes(landing) ? c : `The AI diagnostic, with what it covers and the pricing, is here: ${landing}`;
  if (!site) return landing && c.includes(landing) ? "" : c;
  return c.includes(site) ? c : `More of what I build: ${site}`;
}
