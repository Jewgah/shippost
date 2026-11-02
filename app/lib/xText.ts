// Pure, client-safe helpers for X (twitter) posts. No node imports.
//
// The weights follow twitter-text config v3 (https://github.com/twitter/twitter-text,
// config/v3.json, read 2026-11-02): scale 100, default weight 200, weight 100 for the code
// point ranges 0-4351, 8192-8205, 8208-8223 and 8242-8247, every URL counts 23, limit 280.

export const X_LIMIT = 280;
const URL_WEIGHT = 23;
const LIGHT_RANGES: Array<[number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

// http(s) URL up to the next whitespace. Trailing sentence punctuation is not part of the link.
const URL_RE = /https?:\/\/[^\s]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;
// One emoji, with its skin tone / variation selector / ZWJ joins, is a single weight-2 glyph on X.
const EMOJI_SEQ_RE =
  /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*/gu;

function codePointWeight(cp: number): number {
  for (const [lo, hi] of LIGHT_RANGES) if (cp >= lo && cp <= hi) return 1;
  return 2;
}

function plainWeight(s: string): number {
  let w = 0;
  let last = 0;
  for (const m of s.matchAll(EMOJI_SEQ_RE)) {
    // (c) and (r) are pictographic but sit in Latin-1: they weigh 1 like the rest of it.
    if ((m[0].codePointAt(0) as number) <= 0xff) continue;
    w += lightOrHeavy(s.slice(last, m.index));
    w += 2;
    last = (m.index ?? 0) + m[0].length;
  }
  return w + lightOrHeavy(s.slice(last));
}

function lightOrHeavy(s: string): number {
  let w = 0;
  for (const ch of s) w += codePointWeight(ch.codePointAt(0) as number);
  return w;
}

/** X's weighted length of a post. A plain count: nothing is capped, 281 comes back as 281. */
export function xLength(text: string): number {
  let w = 0;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    const trail = TRAILING_PUNCT_RE.exec(m[0])?.[0] ?? "";
    const urlLen = m[0].length - trail.length;
    if (urlLen === 0) continue;
    w += plainWeight(text.slice(last, idx)) + URL_WEIGHT;
    last = idx + urlLen;
  }
  return w + plainWeight(text.slice(last));
}

/** The X compose link with `text` prefilled (the intent path is /intent/post, checked 2026-11-02). */
export function xComposeUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/**
 * Split the `**B. Thread**` body into its posts. Posts start with `2/`, `3/`... on their own line;
 * the leading number is dropped. Text without any numbered marker is one post.
 */
export function splitThread(b: string): string[] {
  const t = b.trim();
  if (!t) return [];
  const parts = t.split(/^\s*\d+\/[ \t]*/m).map((p) => p.trim());
  const posts = parts.filter(Boolean);
  return posts.length ? posts : [t];
}
