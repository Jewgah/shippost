import { describe, it, expect } from "vitest";
import { normalizeDraftMarkdown, parseDraft, parseDraftMeta, removeOptionFromMarkdown } from "@/lib/draftParser";

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

describe("parseDraft — C. First comment section", () => {
  const WITH_C = `# LinkedIn drafts — 2026-07-03

## ⭐ Option 1 — build-in-public — quit button   (9.0/10)
**A. Company post**
Shipped a quit button.

**B. Repost caption (your profile)**
Small thing, big comfort.

**C. First comment**
https://example.dev

_Why it works:_ concrete and relatable.
_Suggested visuals:_
1. screenshot (screenshot — no AI)
`;

  it("extracts the first comment and keeps it OUT of the repost caption", () => {
    const o = parseDraft(WITH_C).options[0];
    expect(o.parsed).toBe(true);
    expect(o.firstComment).toBe("https://example.dev");
    expect(o.repostCaption).toBe("Small thing, big comfort.");
    expect(o.repostCaption).not.toContain("example.dev");
    expect(o.why).toBe("concrete and relatable.");
  });

  it("drafts without a C section still parse (firstComment empty)", () => {
    const o = parseDraft(WELL_FORMED).options[0];
    expect(o.firstComment).toBe("");
    expect(o.repostCaption).toContain("My personal take on it.");
  });

  it("tolerates a slipped C header ('**C — First comment**') so the link never lands in the caption", () => {
    const md = WITH_C.replace("**C. First comment**", "**C — First comment**");
    const o = parseDraft(md).options[0];
    expect(o.firstComment).toBe("https://example.dev");
    expect(o.repostCaption).toBe("Small thing, big comfort.");
  });

  it("personal-only mode (no B section): the post excludes C/why/visuals, C still extracted", () => {
    const md = `# LinkedIn drafts — 2026-07-03

## ⭐ Option 1 — build-in-public — quit button   (9.0/10)
**A. Company post**
Shipped a quit button today.

**C. First comment**
https://example.dev

_Why it works:_ concrete.
_Suggested visuals:_
1. screenshot (screenshot — no AI)
`;
    const o = parseDraft(md).options[0];
    expect(o.parsed).toBe(true);
    expect(o.companyPost).toBe("Shipped a quit button today.");
    expect(o.companyPost).not.toContain("example.dev");
    expect(o.companyPost).not.toContain("Why it works");
    expect(o.firstComment).toBe("https://example.dev");
    expect(o.repostCaption).toBe("");
  });

  it("personal-only mode without C: the post stops at the why-line", () => {
    const md = `# LinkedIn drafts — 2026-07-03

## Option 1 — lesson — anchors   (8.0/10)
**A. Company post**
Just the post.

_Why it works:_ x.
_Suggested visuals:_
1. screenshot (screenshot — no AI)
`;
    const o = parseDraft(md).options[0];
    expect(o.companyPost).toBe("Just the post.");
    expect(o.visual).toContain("screenshot");
  });
});

describe("normalizeDraftMarkdown — freezes generic headers into explicit Option N", () => {
  const MIXED = `# LinkedIn drafts — 2026-07-03

## Option 1 — lesson — first   (9.0/10)
**A. Company post**
First body.

**B. Repost caption (your profile)**
Cap 1.

_Why it works:_ a.

---
## ⭐ The post — build-in-public — generic slip   (7.0/10)
**A. Company post**
Generic body.

**B. Repost caption (your profile)**
Cap g.

_Why it works:_ c.

---
pillars used: lesson, build-in-public
`;

  it("rewrites all headers to their displayed (position) numbers, keeping star/pillar/topic/score", () => {
    const { md, changed } = normalizeDraftMarkdown(MIXED);
    expect(changed).toBe(true);
    expect(md).toContain("## Option 1 — lesson — first   (9/10)");
    expect(md).toContain("## ⭐ Option 2 — build-in-public — generic slip   (7/10)");
    expect(md).not.toContain("The post —");
    // parses identically to the pre-normalization display
    const d = parseDraft(md);
    expect(d.options.map((o) => o.n)).toEqual([1, 2]);
    expect(d.options[1].star).toBe(true);
    expect(d.footer).toContain("pillars used:");
  });

  it("is idempotent and a no-op on explicit drafts", () => {
    const once = normalizeDraftMarkdown(MIXED);
    expect(normalizeDraftMarkdown(once.md).changed).toBe(false);
    expect(normalizeDraftMarkdown(WELL_FORMED)).toEqual({ md: WELL_FORMED, changed: false });
  });

  it("after normalization, deleting an option no longer shifts the survivors' numbers", () => {
    const { md } = normalizeDraftMarkdown(MIXED);
    const { md: after } = removeOptionFromMarkdown(md, 1);
    // the survivor keeps its frozen identity (Option 2), so a pick/reject logged as 2 still matches
    expect(parseDraft(after).options.map((o) => o.n)).toEqual([2]);
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

  // Regression: a generation slipped the format — header labelled "## The post — …" instead of
  // "## Option 1 — …", and a singular "pillar:"/"source (scrubbed):" footer. It used to render as a
  // raw "Option ?" dump. Now it's tolerated: numbered by position, content + footer parsed.
  it("tolerates a non-`Option N` header (numbers by position) and a singular footer", () => {
    const md = `# LinkedIn draft — 2026-06-22 · the MOONFORGE post

> Post section A then repost using section B.

## The post — build-in-public — I built a roguelike   (9.3/10)
**A. Company post**
This week I shipped my own game.

**B. Repost caption (your profile)**
Built by the kid who used to play these.

_Why it works:_ a real full-circle story.
_Suggested visuals:_
1. a nostalgic diptych (AI prompt: "…")

---
pillar: build-in-public (personal / nostalgia)
source (scrubbed): MOONFORGE, my own game
scrubbed: yes
`;
    const d = parseDraft(md);
    expect(d.options).toHaveLength(1);
    const o = d.options[0];
    expect(o.n).toBe(1); // numbered by position, not shown as "?"
    expect(o.parsed).toBe(true);
    expect(o.pillar).toBe("build-in-public");
    expect(o.topic).toBe("I built a roguelike");
    expect(o.score).toBe(9.3);
    expect(o.companyPost).toContain("This week I shipped my own game.");
    expect(o.repostCaption).toContain("Built by the kid");
    expect(o.why).toBe("a real full-circle story.");
    // the singular footer is split off, not swept into the option body
    expect(d.footer).toContain("pillar:");
    expect(o.raw).not.toContain("source (scrubbed)");
    // delete still targets it by its displayed number
    expect(removeOptionFromMarkdown(md, 1).removed).toBe(true);
  });

  // Regression: with per-block position numbering, a generic header at position 3 could collide
  // with an explicit "## Option 3" elsewhere (two blocks both labelled 3) and delete could hit the
  // wrong one. When ANY generic header exists, ALL blocks are numbered by position — unique, and
  // parseDraft/parseDraftMeta/removeOptionFromMarkdown agree.
  it("mixed explicit + generic headers: numbers all by position, delete hits the right block", () => {
    const md = `# LinkedIn drafts — 2026-07-03

## Option 1 — lesson — first   (9.0/10)
**A. Company post**
First body.

**B. Repost caption (your profile)**
Cap 1.

_Why it works:_ a.

---
## Option 3 — lesson — labelled three   (8.0/10)
**A. Company post**
Labelled-three body.

**B. Repost caption (your profile)**
Cap 3.

_Why it works:_ b.

---
## The post — build-in-public — generic slip   (7.0/10)
**A. Company post**
Generic body.

**B. Repost caption (your profile)**
Cap g.

_Why it works:_ c.
`;
    const d = parseDraft(md);
    expect(d.options.map((o) => o.n)).toEqual([1, 2, 3]); // unique — no double "3"
    const meta = parseDraftMeta(md);
    expect(meta.options.map((o) => o.n)).toEqual([1, 2, 3]);
    // deleting "Option 3" (the third card in the UI) removes the generic block, not the
    // block whose raw header happens to say "Option 3" (shown as card 2)
    const { md: after, removed } = removeOptionFromMarkdown(md, 3);
    expect(removed).toBe(true);
    expect(after).not.toContain("Generic body.");
    expect(after).toContain("Labelled-three body.");
  });
});

describe("parseDraftMeta — agrees with parseDraft on header fields", () => {
  const MALFORMED = `# LinkedIn drafts — 2026-05-29

## Option 1 — lesson — broken
some freeform text without the A/B structure

---
pillars used: lesson
`;

  // parseDraftMeta is the lightweight (header-only) parse used by the drafts list. It must
  // never disagree with the full parse on which blocks are options or on their core fields,
  // otherwise the list would show a different count/topic than the draft page.
  const sameHeaders = (md: string) => {
    const full = parseDraft(md);
    const meta = parseDraftMeta(md);
    expect(meta.date).toBe(full.date);
    expect(meta.options).toHaveLength(full.options.length);
    full.options.forEach((o, i) => {
      expect(meta.options[i].n).toBe(o.n);
      expect(meta.options[i].star).toBe(o.star);
      expect(meta.options[i].pillar).toBe(o.pillar);
      expect(meta.options[i].topic).toBe(o.topic);
      expect(meta.options[i].score).toBe(o.score);
    });
  };

  it("matches on a well-formed draft", () => sameHeaders(WELL_FORMED));
  it("matches on a malformed block (header parses, body missing)", () => sameHeaders(MALFORMED));
  it("matches on empty input", () => sameHeaders(""));
});

describe("removeOptionFromMarkdown — splices one option, keeps everything else parseable", () => {
  it("removes a middle/last option and leaves the rest + footer intact", () => {
    const { md, remaining, removed } = removeOptionFromMarkdown(WELL_FORMED, 2);
    expect(removed).toBe(true);
    expect(remaining).toBe(1);
    const d = parseDraft(md);
    expect(d.options).toHaveLength(1);
    expect(d.options[0].n).toBe(1); // surviving option keeps its identity (no renumbering)
    expect(d.options[0].topic).toBe("multi-agent review");
    expect(d.footer).toContain("pillars used:"); // footer survives removing the last option
    expect(md).not.toContain("## Option 2"); // the option's header + body are gone…
    expect(md).not.toContain("Second post body.");
    expect(md).toContain("currency formatter"); // …though the footer's sources line still names it
  });

  it("removes the first option without orphaning a leading separator", () => {
    const { md, remaining } = removeOptionFromMarkdown(WELL_FORMED, 1);
    expect(remaining).toBe(1);
    const d = parseDraft(md);
    expect(d.options).toHaveLength(1);
    expect(d.options[0].n).toBe(2);
    expect(d.title).toContain("LinkedIn drafts"); // title + instruction preamble untouched
    // the surviving block still parses fully (separator handling didn't corrupt its body)
    expect(d.options[0].parsed).toBe(true);
    expect(d.options[0].companyPost).toContain("Second post body.");
  });

  it("reports remaining=0 when the only option is removed (caller deletes the file)", () => {
    const ONE = `# LinkedIn drafts — 2026-05-29

## ⭐ Option 1 — lesson — solo   (9.0/10)
**A. Company post**
Body.

**B. Repost caption (your profile)**
Cap.

_Why it works:_ x.
_Suggested visuals:_
1. screenshot (screenshot — no AI)
`;
    const { remaining, removed } = removeOptionFromMarkdown(ONE, 1);
    expect(removed).toBe(true);
    expect(remaining).toBe(0);
  });

  it("is a no-op for an option number that doesn't exist", () => {
    const { md, remaining, removed } = removeOptionFromMarkdown(WELL_FORMED, 9);
    expect(removed).toBe(false);
    expect(remaining).toBe(2);
    expect(md).toBe(WELL_FORMED); // unchanged
  });
});
