import type { DraftOption } from "./draftParser";

export interface CommentLinks {
  /** brand.siteUrl: the author's own site (jordanperez.dev). */
  siteUrl: string;
  /** brand.landingUrl: the Infinify AI diagnostic offer. */
  landingUrl: string;
  /** brand.companyUrl: the company's own site (hakolkal.com), for the page's comment. */
  companyUrl?: string;
}

/**
 * The comment the company page leaves on its own post (Jordan, 2026-10-19): the page's voice, never
 * first person, and the company's site, never the author's. Empty when no company site is set.
 */
export function defaultPageComment(links: CommentLinks): string {
  const url = (links.companyUrl ?? "").trim();
  return url ? `More of what we build: ${url}` : "";
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
  const company = (links.companyUrl ?? "").trim();
  // A post about the company itself (section C links its site) keeps that link, client-outcome or not.
  if (mode === "personal" && company && c.includes(company)) return c;
  const infinify =
    Boolean(landing) && (option.pillar === "client-outcome" || [c, option.companyPost].some((t) => t.includes(landing)));
  if (mode === "personal" && infinify)
    return c.includes(landing) ? c : `The AI diagnostic, with what it covers and the pricing, is here: ${landing}`;
  if (!site) return landing && c.includes(landing) ? "" : c;
  return c.includes(site) ? c : `More of what I build: ${site}`;
}
