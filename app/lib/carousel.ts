// The content model and the document for a LinkedIn carousel (a "document post": a PDF whose
// pages LinkedIn shows as swipeable slides).
//
// Pure on purpose - no node imports, no `server-only`. It is consumed by BOTH the vitest suite
// and `app/scripts/build-carousel.mjs`, which runs outside Next under Node's type stripping;
// the only import here is a TYPE import, which stripping erases, so the script never has to
// resolve draftParser at runtime.
//
// The slides are derived from the option's own post text, never from a second content model:
// what LinkedIn would have shown as one long post becomes the same words, paced.
import type { DraftOption } from "./draftParser";

/**
 * LinkedIn's tallest document-post page, in CSS px. One `.slide` is exactly one PDF page, so
 * these are also what the caller passes to `page.pdf({width, height})`.
 */
export const PAGE_W = 1080;
export const PAGE_H = 1350;

export type SlideKind = "hook" | "statement" | "body" | "bullets" | "cta";

export interface Slide {
  kind: SlideKind;
  /** The paragraph, or the CTA line. Empty for a bullets slide. */
  text: string;
  /** Only for `kind: "bullets"`. */
  bullets?: string[];
  /** Only for `kind: "cta"` - rendered as the big link line. */
  url?: string;
}

/** A `[data-theme]` palette out of the app's own globals.css. */
export interface ThemeTokens {
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
}

// The `neutral` preset, duplicated here ONLY as the fallback for when globals.css cannot be read
// (the script runs from a checkout where the file could have moved). parseThemeTokens is what
// normally supplies these, so the CSS stays the single source of truth.
export const FALLBACK_TOKENS: ThemeTokens = {
  bg: "#0f1115",
  surface: "#161922",
  elevated: "#1d212c",
  border: "#2a2f3a",
  fg: "#e8eaf0",
  muted: "#9aa3b2",
  accent: "#5b8cff",
  accent2: "#7aa2ff",
};

const TOKEN_NAMES: (keyof ThemeTokens)[] = [
  "bg",
  "surface",
  "elevated",
  "border",
  "fg",
  "muted",
  "accent",
  "accent2",
];

/**
 * Pull one theme preset's custom properties out of `app/styles/globals.css`, so the slides use
 * the app's real tokens instead of a second copy of the hex values. The `neutral` preset shares
 * its block with `:root`, so that selector is accepted too. Anything the CSS does not define
 * falls back to FALLBACK_TOKENS rather than rendering a transparent slide.
 */
export function parseThemeTokens(css: string, themeId: string): ThemeTokens {
  // The selector list of the block that defines this theme, up to the closing brace.
  const selector = new RegExp(
    `(?:^|\\})([^{}]*\\[data-theme="${themeId.replace(/[^a-z0-9-]/gi, "")}"\\][^{}]*)\\{([^}]*)\\}`,
    "i"
  );
  // `[data-theme="neutral"]` is a real selector in globals.css (it shares its block with :root),
  // so every preset is found the same way. A bare `:root` fallback would match the FONT block
  // that comes first in the file, not the colours, so there deliberately is not one.
  const m = selector.exec(css);
  const block = m ? m[2] : null;
  if (!block) return { ...FALLBACK_TOKENS };
  const out = { ...FALLBACK_TOKENS };
  for (const name of TOKEN_NAMES) {
    const v = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block);
    if (v) out[name] = v[1].trim();
  }
  return out;
}

// A LinkedIn instruction the engine writes into the post body, not something to put on a slide.
const LINK_IN_COMMENTS = /^link in (the )?comments?\.?$/i;
const BULLET = /^\s*[-*•]\s+/;
/** Longer than this and a line is a paragraph, not a statement to set in big type. */
const STATEMENT_MAX = 120;
/** Hook + this many + CTA. Nine pages is comfortably inside what LinkedIn shows well. */
export const MAX_MIDDLE_SLIDES = 7;
/** Below this a "carousel" is a hook and a link - not worth posting as a document. */
export const MIN_SLIDES = 3;
const MAX_BULLETS_PER_SLIDE = 4;

const firstUrl = (s: string): string | null => /(https?:\/\/[^\s<>"')\]]+)/.exec(s)?.[1] ?? null;

/**
 * The closing slide's ask. The link ladder is NOT re-implemented here: the engine already
 * applied it per option (engine/SKILL.md, "client-outcome + a Landing URL wins, else the Site
 * URL") and wrote the result into `**C. First comment**`, so that comment is the first source.
 * The config values are only the fallback for a draft written before the C section existed.
 */
export function ctaFromOption(
  option: Pick<DraftOption, "firstComment" | "pillar">,
  cfg: { landingUrl?: string; siteUrl?: string } = {}
): { text: string; url?: string } {
  const comment = (option.firstComment ?? "").trim();
  // A "(no link - soft CTA)" placeholder is a note to the author, never slide copy.
  const usable = comment && !/^\(?\s*no link/i.test(comment) ? comment : "";
  const fromComment = usable ? firstUrl(usable) : null;
  const fallback =
    (option.pillar === "client-outcome" && cfg.landingUrl?.trim()) || cfg.siteUrl?.trim() || "";
  const url = fromComment ?? (fallback || undefined);

  // The comment's own wording, minus the URL and any trailing punctuation left behind by it.
  const text = usable
    ? usable
        .replace(/(https?:\/\/[^\s<>"')\]]+)/g, "")
        .replace(/\s+/g, " ")
        .replace(/[\s:.,;-]+$/, "")
        .trim()
    : "";
  return { text, url };
}

/** Split a paragraph into its bullet lines, or null when it is not a bullet list. */
function bulletsOf(paragraph: string): string[] | null {
  const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every((l) => BULLET.test(l))) return null;
  return lines.map((l) => l.replace(BULLET, "").trim()).filter(Boolean);
}

/**
 * Turn one option's company post into slides.
 *
 * Slide 1 is the post's first paragraph (LinkedIn's "line 1", the only thing a scroller reads),
 * over the hero image when one has been rendered. The middle is one slide per remaining
 * paragraph - short ones and questions get set as statements, because that is what they are.
 * The last slide is the ask.
 *
 * Returns the slides plus how many paragraphs were dropped by the cap, so the caller can say so
 * instead of silently losing the end of a long post.
 */
export function slidesFromOption(
  option: Pick<DraftOption, "companyPost" | "firstComment" | "pillar">,
  cfg: { landingUrl?: string; siteUrl?: string } = {}
): { slides: Slide[]; dropped: number } {
  const paragraphs = (option.companyPost ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+$/gm, "").trim())
    .filter((p) => p && !LINK_IN_COMMENTS.test(p));

  const slides: Slide[] = [];
  if (paragraphs.length) slides.push({ kind: "hook", text: paragraphs[0] });

  const middle: Slide[] = [];
  for (const p of paragraphs.slice(1)) {
    const bullets = bulletsOf(p);
    if (bullets) {
      for (let i = 0; i < bullets.length; i += MAX_BULLETS_PER_SLIDE) {
        middle.push({ kind: "bullets", text: "", bullets: bullets.slice(i, i + MAX_BULLETS_PER_SLIDE) });
      }
      continue;
    }
    const oneLine = p.replace(/\s+/g, " ");
    middle.push({
      kind: oneLine.length <= STATEMENT_MAX || oneLine.endsWith("?") ? "statement" : "body",
      text: p,
    });
  }
  const dropped = Math.max(0, middle.length - MAX_MIDDLE_SLIDES);
  slides.push(...middle.slice(0, MAX_MIDDLE_SLIDES));

  const cta = ctaFromOption(option, cfg);
  slides.push({ kind: "cta", text: cta.text, url: cta.url });
  return { slides, dropped };
}

// ── document ────────────────────────────────────────────────────────────────────────────────
// Only `& < >` are escaped, with named entities: `&#39;`-style numeric escapes would inject
// digits that the number highlighter below would then paint.
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Paint quantities in the accent colour - a carousel is skimmed, and the numbers are what a
 * reader stops on. Conservative on purpose: a run of digits, optionally with a thousands or
 * decimal separator and one trailing unit, and never a fragment of a longer word.
 */
export function highlightNumbers(escaped: string): string {
  return escaped.replace(
    /(?<![\w&#-])(\d[\d.,]*(?:\s?(?:%|x|k|h|€|\$|EUR|USD|min|hours?|hrs?))?)(?![\w])/g,
    '<b class="n">$1</b>'
  );
}

const rich = (s: string): string => highlightNumbers(esc(s)).replace(/\n/g, "<br>");

export interface DeckMeta {
  tokens: ThemeTokens;
  brandName: string;
  authorName: string;
  topic: string;
  /** A `data:image/png;base64,…` URI for slide 1's background, when a hero has been rendered. */
  heroDataUri?: string;
}

/**
 * The whole standalone document: N `.slide` divs at exactly 1080x1350 CSS px, sized for
 * `page.pdf({width:'1080px',height:'1350px'})` so one slide is one PDF page.
 *
 * Every word is HTML - a diffusion model renders text as gibberish, so nothing readable is ever
 * baked into the hero image.
 */
export function slidesHtml(slides: Slide[], meta: DeckMeta): string {
  const total = slides.length;
  const body = slides.map((s, i) => slideHtml(s, i, total, meta)).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(meta.topic || meta.brandName)}</title>
<style>${deckCss(meta.tokens)}</style></head>
<body>
${body}
</body></html>`;
}

// The hero lands inside a `style` attribute, inside `url('…')`. The only caller builds it from
// base64 bytes, which cannot contain a quote - but this function is exported, so the shape is
// checked here rather than trusted. Anything else is simply not a hero.
const SAFE_DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function slideHtml(s: Slide, i: number, total: number, meta: DeckMeta): string {
  const withHero = s.kind === "hook" && Boolean(meta.heroDataUri) && SAFE_DATA_URI.test(meta.heroDataUri!);
  const hero = withHero
    ? `<div class="hero" style="background-image:url('${meta.heroDataUri}')"></div><div class="scrim"></div>`
    : "";
  // Kicker and wordmark land on the same pixels on every page; only the content block moves.
  const kicker = `<div class="kicker">${esc(meta.topic || meta.brandName)}</div>`;
  // The rule is the deck's progress bar: it fills left to right and completes on the last page.
  const rule = `<div class="rule"><i style="width:${Math.round((100 * (i + 1)) / total)}%"></i></div>`;
  const counter =
    s.kind === "cta" ? "" : `<div class="count">${i + 1}<span class="of"> / ${total}</span></div>`;

  let main: string;
  if (s.kind === "bullets") {
    main = `<ul class="bul">${(s.bullets ?? []).map((b) => `<li>${rich(b)}</li>`).join("")}</ul>`;
  } else if (s.kind === "cta") {
    main = `<div class="ctaBlock">
<div class="ctaEyebrow">${esc(meta.brandName)}</div>
<p class="ctaLine">${s.text ? rich(s.text) : "More of what I build"}</p>
${s.url ? `<p class="ctaUrl">${esc(s.url.replace(/^https?:\/\//, ""))}</p>` : ""}
</div>`;
  } else {
    // Size from the character count: print crops in silence, so a long paragraph steps down a
    // bucket rather than running off the bottom of the page.
    const px = sizeFor(s.kind, s.text.replace(/\s+/g, " ").length);
    main = `<p class="txt" style="font-size:${px}px">${rich(s.text)}</p>`;
  }

  const foot = `<div class="foot">${esc(s.kind === "cta" ? meta.authorName : meta.brandName)}</div>`;
  return `<section class="slide ${s.kind}${withHero ? " withHero" : ""}">${hero}${kicker}${rule}${main}${foot}${counter}</section>`;
}

// ── design ──────────────────────────────────────────────────────────────────────────────────
// A carousel is read on a phone, at thumbnail size, in a feed, and it is PRINT: no hover, no
// focus, no transition, no JS, and no scrollbar to warn you when something overflows. Everything
// below follows from that.
//
// COLOUR RULE, measured, do not relax: `--accent` is fills and rules ONLY, never text. On the
// midnight preset #8b5cf6 on --surface is 4.40:1, under the 4.5:1 floor. `--accent2` clears it
// on all three presets (6.8:1 midnight, 7.1:1 neutral, 10.6:1 neon), so every coloured word and
// every filled block that carries text uses accent2.
//
// Contrast, neutral preset (AA needs 4.5:1):
//   --fg on --bg .......... 15.7:1     --fg on --surface ..... 14.6:1
//   --muted on --bg ....... 7.4:1      --accent2 on --bg ..... 7.6:1
//   --bg on --accent2 ..... 7.6:1  (the CTA block)
// Over the hero, with the worst photo there is (pure white) and no pre-darkening, the scrim puts
// --fg at 11.3:1 where the hook sits.
//
// What makes N pages read as ONE deck: the kicker, the rule, the wordmark, the counter and the
// 100 px frame land on the same pixels on every page; only the content block moves. The one
// distinctive detail is that rule - it is a progress bar, filling left to right across the deck
// and completing exactly on the closing page. Slides 1..N-1 carry no filled shape at all, which
// is what makes the single filled block on the CTA page land as an ask.
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const PAD = 100; // every edge; LinkedIn crops document posts and the floor is 60
const COL = 840; // text column, inside the 880 px padding box

/**
 * Type size by length. Print crops silently, so the size is chosen from the character count
 * rather than measured after the fact: a long hook steps down instead of running off the page.
 * Floors honoured: hook >= 72 px, body >= 40 px.
 */
export function sizeFor(kind: SlideKind, chars: number): number {
  if (kind === "hook") return chars <= 85 ? 88 : chars <= 125 ? 80 : chars <= 170 ? 72 : 64;
  if (kind === "statement") return chars <= 45 ? 104 : chars <= 75 ? 88 : 72;
  if (kind === "body") return chars <= 520 ? 46 : 40;
  return 46; // bullets
}

function deckCss(t: ThemeTokens): string {
  const band = PAGE_H - 2 * PAD - 30 - 34 - 4 - 48 - 34; // kicker, gaps, rule, footer
  return `
@page { size: ${PAGE_W}px ${PAGE_H}px; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { width: ${PAGE_W}px; background: ${t.bg}; color: ${t.fg}; font-family: ${FONT_STACK}; }
body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

/* One .slide is exactly one PDF page. overflow:hidden is the last line of defence behind the
   size buckets: a freak paragraph clips rather than spilling into an unwanted extra page. */
.slide {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: ${PAGE_W}px;
  height: ${PAGE_H}px;
  padding: ${PAD}px;
  display: flex;
  flex-direction: column;
  background: ${t.bg};
  /* the same ambient wash the app paints behind its own UI (styles/globals.css body::before) */
  background-image:
    radial-gradient(900px 620px at 8% -4%, ${rgba(t.accent, 0.16)}, transparent 62%),
    radial-gradient(700px 520px at 104% 104%, ${rgba(t.accent2, 0.08)}, transparent 60%);
  break-after: page;
  page-break-after: always;
}
.slide:last-child { break-after: auto; page-break-after: auto; }
.slide.statement { background-color: ${t.surface}; }

.kicker {
  flex: none;
  height: 30px;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: ${t.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* the progress rule: a full-width track, filled to this page's share of the deck */
.rule {
  flex: none;
  width: ${COL}px;
  height: 4px;
  margin-top: 34px;
  background: ${t.border};
}
.rule i { display: block; height: 100%; background: ${t.accent2}; }

/* the content band, between the rule and the wordmark */
.txt, .bul, .ctaBlock {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 48px;
  max-width: ${COL}px;
  display: flex;
  flex-direction: column;
}
.txt { color: ${t.fg}; }
.hook .txt { justify-content: flex-end; font-weight: 700; line-height: 1.1; letter-spacing: -0.025em; }
.statement .txt { justify-content: center; font-weight: 700; line-height: 1.08; letter-spacing: -0.03em; }
.body .txt { justify-content: center; font-weight: 400; line-height: 1.42; letter-spacing: -0.005em; }

.bul { justify-content: center; gap: 40px; list-style: none; }
.bul li {
  position: relative;
  padding-left: 56px;
  font-size: 46px;
  line-height: 1.32;
  font-weight: 500;
  letter-spacing: -0.005em;
}
/* a square, not an emoji: iconography here has to survive rasterisation at thumbnail size */
.bul li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 21px;
  width: 20px;
  height: 20px;
  background: ${t.accent2};
}

.n { color: ${t.accent2}; font-weight: 700; }

.foot {
  flex: none;
  height: 34px;
  margin-top: 38px;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${t.muted};
}
.count {
  position: absolute;
  right: ${PAD}px;
  bottom: ${PAD}px;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: ${t.muted};
  z-index: 3;
}
.count .of { opacity: 0.6; }

/* The closing page is an ask, not a footer: it is the only page in the deck with a filled block,
   its rule is full for the first time, and the URL is set in mono because a LinkedIn document
   post is not clickable - the reader has to retype it. */
.ctaBlock { justify-content: center; align-items: flex-start; }
.ctaEyebrow {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: ${t.accent2};
}
.ctaLine {
  margin-top: 40px;
  font-size: 72px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: ${t.fg};
}
.ctaUrl {
  margin-top: 56px;
  align-self: flex-start;
  max-width: ${COL}px;
  background: ${t.accent2};
  color: ${t.bg};
  font-family: ${MONO_STACK};
  font-size: 40px;
  font-weight: 600;
  line-height: 1;
  padding: 34px 44px;
  word-break: break-word;
}

/* The hero fills the page. The hook is bottom-anchored, so the scrim only has to go opaque in
   the lower half, which keeps the picture readable while the words stay legible over ANY photo.
   Plain rgba gradients only: backdrop-filter and blend modes are unreliable through page.pdf(). */
.hero {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-size: cover;
  background-position: center;
}
.scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    linear-gradient(90deg, ${rgba(t.bg, 0.45)} 0px, ${rgba(t.bg, 0)} 520px),
    linear-gradient(180deg, ${rgba(t.bg, 0.7)} 0px, ${rgba(t.bg, 0.36)} 250px, ${rgba(t.bg, 0.36)} 430px, ${rgba(t.bg, 0.88)} 620px, ${rgba(t.bg, 0.94)} 980px, ${rgba(t.bg, 0.97)} ${PAGE_H}px);
}
.withHero > .kicker, .withHero > .foot { color: ${t.fg}; position: relative; z-index: 2; }
.withHero > .rule { position: relative; z-index: 2; background: ${rgba(t.fg, 0.28)}; }
.withHero > .txt { position: relative; z-index: 2; }
.withHero .count { color: ${t.fg}; }

/* the content band is ${band}px tall; the size buckets in sizeFor() keep every kind inside it */
`.trim();
}

/** `#rrggbb` to `rgba(r,g,b,a)`. Falls back to the input for a value that is not a plain hex. */
function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
