import { describe, it, expect } from "vitest";
import { defaultComment, defaultPageComment } from "@/lib/firstComment";
import type { DraftOption } from "@/lib/draftParser";

const links = { siteUrl: "https://jordanperez.dev", landingUrl: "https://infinify.ai/en/diagnostic-ia/" };
const opt = (pillar: string, firstComment = "", companyPost = "a post") => ({ pillar, firstComment, companyPost }) as DraftOption;
const SITE = "More of what I build: https://jordanperez.dev";
const OFFER = "The AI diagnostic, with what it covers and the pricing, is here: https://infinify.ai/en/diagnostic-ia/";

describe("defaultComment (Jordan's rule, 2026-10-15)", () => {
  it("company page post + repost: always the site link, even on an Infinify option", () => {
    expect(defaultComment(opt("client-outcome", "The offer is here: https://infinify.ai/en/diagnostic-ia/"), "company", links)).toBe(SITE);
    expect(defaultComment(opt("lesson"), "company", links)).toBe(SITE);
  });
  it("profile only, about Infinify (client-outcome pillar, or a post linking the offer): the offer link", () => {
    expect(defaultComment(opt("client-outcome"), "personal", links)).toBe(OFFER);
    expect(defaultComment(opt("lesson", "", "see https://infinify.ai/en/diagnostic-ia/"), "personal", links)).toBe(OFFER);
  });
  it("profile only, unrelated: the site link", () => {
    expect(defaultComment(opt("build-in-public"), "personal", links)).toBe(SITE);
  });
  it("keeps section C's own wording when it already points at the right link", () => {
    const c = "If your mornings start like this, it is usually fixable: https://jordanperez.dev";
    expect(defaultComment(opt("lesson", c), "personal", links)).toBe(c);
    const offer = "The offer, with prices, is here: https://infinify.ai/en/diagnostic-ia/";
    expect(defaultComment(opt("client-outcome", offer), "personal", links)).toBe(offer);
  });
  it("profile only, a client-outcome post about the company itself (C links its site): keeps C, never the offer", () => {
    const c = "The offer, with prices and what is included, is here: https://hakolkal.com";
    expect(defaultComment(opt("client-outcome", c), "personal", { ...links, companyUrl: "https://hakolkal.com" })).toBe(c);
  });
  it("the page's own comment (Jordan, 2026-10-19): the page's voice and the company site, never the author's", () => {
    expect(defaultPageComment({ ...links, companyUrl: "https://hakolkal.com" })).toBe("More of what we build: https://hakolkal.com");
    expect(defaultPageComment(links)).toBe("");
  });
  it("never prefills a link that is not configured", () => {
    expect(defaultComment(opt("lesson", "(no link: nothing to add)"), "personal", { siteUrl: "", landingUrl: "" })).toBe("");
  });
});
