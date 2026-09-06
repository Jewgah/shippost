import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ctaFromOption,
  FALLBACK_TOKENS,
  highlightNumbers,
  MAX_MIDDLE_SLIDES,
  parseThemeTokens,
  MIN_SLIDES,
  sizeFor,
  slidesFromOption,
  slidesHtml,
} from "@/lib/carousel";

// A carousel is derived from the option's own post text, so these tests pin the derivation:
// which paragraph becomes which slide, what never reaches a slide, and where the closing link
// comes from. The document itself is checked for the two things a LinkedIn document post
// depends on - one page per slide at exactly 1080x1350 - and for escaping.

const option = (over: Partial<Parameters<typeof slidesFromOption>[0]> = {}) => ({
  companyPost: "",
  firstComment: "",
  pillar: "build-in-public",
  ...over,
});

describe("slidesFromOption", () => {
  it("makes the post's first paragraph the hook and the rest the middle, and always closes on a CTA", () => {
    const { slides, dropped } = slidesFromOption(
      option({
        companyPost:
          "Anyone could hit my password reset as many times as they wanted.\n\n" +
          "Every rate limiter in the app read the first IP in the header, and that header is just text the caller sends, so rotating it strolls past every cap I ever built into the thing.\n\n" +
          "The scariest inputs are the ones you stopped questioning.",
        firstComment: "More of what I build lives here: https://example.test",
      })
    );
    expect(slides.map((s) => s.kind)).toEqual(["hook", "body", "statement", "cta"]);
    expect(slides[0].text).toMatch(/^Anyone could hit/);
    expect(slides.at(-1)).toMatchObject({ url: "https://example.test", text: "More of what I build lives here" });
    expect(dropped).toBe(0);
  });

  it("never puts 'link in comments' on a slide - it is an instruction to the author, not copy", () => {
    const { slides } = slidesFromOption(
      option({ companyPost: "The hook.\n\nA real point here.\n\nlink in comments" })
    );
    expect(slides.map((s) => s.text)).not.toContain("link in comments");
    expect(slides.map((s) => s.kind)).toEqual(["hook", "statement", "cta"]);
  });

  it("sets a question as a statement even when it is long, and a long paragraph as body", () => {
    const long = "x".repeat(200);
    const { slides } = slidesFromOption(
      option({ companyPost: `Hook.\n\n${long}\n\n${long}?` })
    );
    expect(slides.map((s) => s.kind)).toEqual(["hook", "body", "statement", "cta"]);
  });

  it("turns a bullet paragraph into a bullets slide, splitting past four", () => {
    const { slides } = slidesFromOption(
      option({ companyPost: "Hook.\n\n- one\n- two\n- three\n- four\n- five" })
    );
    expect(slides[1]).toMatchObject({ kind: "bullets", bullets: ["one", "two", "three", "four"] });
    expect(slides[2]).toMatchObject({ kind: "bullets", bullets: ["five"] });
  });

  it("caps the middle and reports what it dropped instead of losing the end of a long post silently", () => {
    const paras = Array.from({ length: 12 }, (_, i) => `Paragraph number ${i}.`);
    const { slides, dropped } = slidesFromOption(option({ companyPost: paras.join("\n\n") }));
    expect(slides.length).toBe(MAX_MIDDLE_SLIDES + 2); // hook + cap + cta
    expect(dropped).toBe(12 - 1 - MAX_MIDDLE_SLIDES);
  });

  it("still produces a deck when the post is a single paragraph", () => {
    const { slides } = slidesFromOption(option({ companyPost: "Just the one line." }));
    expect(slides.map((s) => s.kind)).toEqual(["hook", "cta"]);
  });
});

describe("ctaFromOption (the link ladder is the engine's, not a second copy)", () => {
  it("takes the URL the engine already chose, in the option's own first comment", () => {
    expect(
      ctaFromOption(
        { firstComment: "The offer, with prices, is here: https://example.test/offer", pillar: "client-outcome" },
        { landingUrl: "https://ignored.test", siteUrl: "https://ignored.test" }
      )
    ).toEqual({ text: "The offer, with prices, is here", url: "https://example.test/offer" });
  });

  it("falls back to landingUrl only for client-outcome, and to siteUrl otherwise", () => {
    const cfg = { landingUrl: "https://landing.test", siteUrl: "https://site.test" };
    expect(ctaFromOption({ firstComment: "", pillar: "client-outcome" }, cfg).url).toBe("https://landing.test");
    expect(ctaFromOption({ firstComment: "", pillar: "lesson" }, cfg).url).toBe("https://site.test");
    expect(ctaFromOption({ firstComment: "", pillar: "client-outcome" }, { siteUrl: "https://site.test" }).url).toBe(
      "https://site.test"
    );
  });

  it("ignores a '(no link - soft CTA)' placeholder and degrades to no URL rather than inventing one", () => {
    expect(ctaFromOption({ firstComment: "(no link - soft CTA)", pillar: "lesson" }, {})).toEqual({
      text: "",
      url: undefined,
    });
  });
});

describe("parseThemeTokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles", "globals.css"), "utf8");

  it("reads each preset out of the app's real globals.css, so the slides cannot drift from the app", () => {
    // Pinned against the file itself rather than against literals copied out of it.
    for (const theme of ["neutral", "midnight", "neon"]) {
      const t = parseThemeTokens(css, theme);
      for (const [k, v] of Object.entries(t)) {
        expect(v, `${theme}.${k}`).toMatch(/^#[0-9a-f]{3,8}$/i);
      }
    }
    expect(parseThemeTokens(css, "midnight").accent).not.toBe(parseThemeTokens(css, "neon").accent);
  });

  it("falls back to the neutral palette rather than rendering a transparent slide", () => {
    expect(parseThemeTokens("", "neutral")).toEqual(FALLBACK_TOKENS);
    expect(parseThemeTokens(css, "no-such-theme")).toEqual(FALLBACK_TOKENS);
  });
});

describe("highlightNumbers", () => {
  it("paints quantities and leaves words alone", () => {
    expect(highlightNumbers("saved 12 hours and 30%")).toBe(
      'saved <b class="n">12 hours</b> and <b class="n">30%</b>'
    );
    expect(highlightNumbers("Next.js 15 on port 3030")).toContain('<b class="n">15</b>');
    expect(highlightNumbers("no numbers here")).toBe("no numbers here");
    // must never reach inside an entity the escaper produced
    expect(highlightNumbers("&amp; &lt;")).toBe("&amp; &lt;");
  });
});

describe("slidesHtml", () => {
  const meta = {
    tokens: FALLBACK_TOKENS,
    brandName: "Brand",
    authorName: "Author",
    topic: "a topic",
  };

  it("emits one 1080x1350 page per slide and the @page rule LinkedIn's document post needs", () => {
    const { slides } = slidesFromOption(
      option({ companyPost: "Hook.\n\nSecond.\n\nThird.", firstComment: "here: https://example.test" })
    );
    const html = slidesHtml(slides, meta);
    expect(html.match(/class="slide /g)).toHaveLength(slides.length);
    expect(html).toMatch(/@page\s*\{[^}]*size:\s*1080px\s+1350px/);
    expect(html).toMatch(/margin:\s*0/);
    expect(html).toContain("1350px");
  });

  it("escapes post text instead of letting it become markup", () => {
    const html = slidesHtml(
      [{ kind: "hook", text: '<script>alert("x")</script> & more' }],
      meta
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
  });

  it("puts the hero in as a data URI on slide 1 only", () => {
    const html = slidesHtml(
      [
        { kind: "hook", text: "Hook." },
        { kind: "body", text: "Body." },
      ],
      { ...meta, heroDataUri: "data:image/png;base64,AAAA" }
    );
    expect(html.match(/data:image\/png;base64,AAAA/g)).toHaveLength(1);
  });
});

describe("sizeFor", () => {
  it("keeps the floors a phone-sized carousel needs, at every length", () => {
    for (const chars of [10, 85, 86, 125, 126, 170, 400]) {
      expect(sizeFor("hook", chars), `hook@${chars}`).toBeGreaterThanOrEqual(64);
      expect(sizeFor("body", chars), `body@${chars}`).toBeGreaterThanOrEqual(40);
      expect(sizeFor("statement", chars), `statement@${chars}`).toBeGreaterThanOrEqual(72);
    }
    // a realistic hook (a LinkedIn line 1) stays at or above the 72px the format wants
    expect(sizeFor("hook", 160)).toBeGreaterThanOrEqual(72);
    // and it steps DOWN as the text grows, which is what keeps print from cropping in silence
    expect(sizeFor("hook", 200)).toBeLessThan(sizeFor("hook", 40));
    expect(sizeFor("body", 600)).toBeLessThan(sizeFor("body", 300));
  });
});

describe("the accent/accent2 split (measured, do not relax)", () => {
  // #8b5cf6 (midnight --accent) on that preset's --surface is 4.40:1, under the 4.5:1 floor,
  // so --accent may only ever be a fill or a rule. Every coloured WORD uses --accent2.
  const css = slidesHtml([{ kind: "cta", text: "x", url: "https://e.test" }], {
    tokens: { ...FALLBACK_TOKENS, accent: "#AAAAAA", accent2: "#BBBBBB" },
    brandName: "B",
    authorName: "A",
    topic: "t",
  });

  it("never paints text with --accent", () => {
    for (const rule of [".n {", ".ctaEyebrow {", ".ctaUrl {"]) {
      const block = css.slice(css.indexOf(rule), css.indexOf("}", css.indexOf(rule)));
      expect(block, rule).not.toContain("#AAAAAA");
    }
    expect(css).toContain("color: #BBBBBB"); // accent2 is what carries colour on text
  });
});

describe("MIN_SLIDES", () => {
  it("is the floor the CLI refuses below - a hook plus a link is not a carousel", () => {
    const { slides } = slidesFromOption(option({ companyPost: "Only one paragraph." }));
    expect(slides.length).toBeLessThan(MIN_SLIDES);
  });
});
