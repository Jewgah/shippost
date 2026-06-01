import { describe, it, expect } from "vitest";
import { parseDraft } from "@/lib/draftParser";

const WELL_FORMED = `# LinkedIn drafts — 2026-05-31 · 5 options, ranked · pick ONE

> Post section A to your company page, then Repost-with-thoughts to your
> profile using section B. ⭐ = my top pick this run.

## ⭐ Option 1 — smart-ai-workflow — multi-agent review   (9.2/10)
**A. Company post**
A hook that stops the scroll.

The body of the post.

Built it in a day — then shipped → live.

**B. Repost caption (your profile)**
My personal take on it.

_Why it works:_ strong specific hook.
_Suggested visuals:_
1. before/after screenshot (screenshot — no AI)
2. a desk at night — AI prompt: "candid, natural light, 35mm, subtle grain"
3. the brand logo

---
## Option 2 — build-in-public — currency formatter   (8.6/10)
**A. Company post**
Second post body.

**B. Repost caption (your profile)**
Second caption.

_Why it works:_ relatable.
_Suggested visuals:_
1. screenshot (screenshot — no AI)
2. idea two
3. logo

---
pillars used: smart-ai-workflow, build-in-public
sources (scrubbed): 1) multi-agent review; 2) currency formatter
scrubbed: yes (no clients)
`;

describe("parseDraft — well-formed", () => {
  const d = parseDraft(WELL_FORMED);

  it("extracts the date and exactly the option count (footer is not an option)", () => {
    expect(d.date).toBe("2026-05-31");
    expect(d.options).toHaveLength(2);
  });

  it("does NOT split a hyphenated pillar name (smart-ai-workflow stays whole)", () => {
    expect(d.options[0].pillar).toBe("smart-ai-workflow");
    expect(d.options[0].topic).toBe("multi-agent review");
  });

  it("captures star, score, and all sub-sections", () => {
    const o = d.options[0];
    expect(o.star).toBe(true);
    expect(o.score).toBe(9.2);
    expect(o.parsed).toBe(true);
    expect(o.companyPost).toContain("A hook that stops the scroll.");
    expect(o.companyPost).toContain("The body of the post.");
    expect(o.repostCaption).toContain("My personal take on it.");
    expect(o.why).toBe("strong specific hook.");
  });

  it("companyPost excludes the B caption text", () => {
    expect(d.options[0].companyPost).not.toContain("My personal take");
  });

  it("humanizes the post body: strips em-dashes/arrows from A & B but NOT the header", () => {
    const o = d.options[0];
    expect(o.companyPost).toContain("Built it in a day - then shipped to live.");
    expect(o.companyPost).not.toMatch(/[—–→]/);
    // the header keeps its em-dashes (they're the parser separator) — pillar/topic intact
    expect(o.pillar).toBe("smart-ai-workflow");
    expect(o.topic).toBe("multi-agent review");
  });

  it("captures the multi-line 3-idea visuals block incl. an AI prompt", () => {
    const v = d.options[0].visual;
    expect(v).toContain("AI prompt");
    expect(v.split("\n").filter(Boolean).length).toBe(3);
  });

  it("second option: not starred, correct score", () => {
    expect(d.options[1].star).toBe(false);
    expect(d.options[1].score).toBe(8.6);
    expect(d.options[1].pillar).toBe("build-in-public");
  });

  it("captures the footer separately", () => {
    expect(d.footer).toContain("pillars used:");
    expect(d.footer).toContain("scrubbed:");
  });
});

describe("parseDraft — back-compat & robustness", () => {
  it("parses the OLD single-line `_Suggested visual:_` form", () => {
    const md = `# LinkedIn drafts — 2026-05-29

## ⭐ Option 1 — lesson — NaN check   (9.0/10)
**A. Company post**
Body.

**B. Repost caption (your profile)**
Cap.

_Why it works:_ x.
_Suggested visual:_ the brand logo, or a screenshot
`;
    const o = parseDraft(md).options[0];
    expect(o.parsed).toBe(true);
    expect(o.visual).toContain("the brand logo");
  });

  it("marks a malformed block (missing A section) as not parsed but keeps raw", () => {
    const md = `# LinkedIn drafts — 2026-05-29

## Option 1 — lesson — broken
some freeform text without the A/B structure
`;
    const o = parseDraft(md).options[0];
    expect(o.parsed).toBe(false);
    expect(o.raw).toContain("broken");
  });

  it("does not crash on empty input", () => {
    expect(() => parseDraft("")).not.toThrow();
    expect(parseDraft("").options).toHaveLength(0);
  });
});
