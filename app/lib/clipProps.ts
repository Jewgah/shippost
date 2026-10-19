/**
 * Props for marketing-studio's `PostClip` composition: the 4:5 explainer clip that is a queued
 * post's 4th candidate (engine/render-variants.mjs renders it).
 *
 * The script (hook, up to 3 points, takeaway) is written by Claude from the post (scriptPrompt,
 * parsed by parseScript). When that call fails or answers garbage, fallbackScript builds one from
 * the post's own sentences, so a clip always renders.
 */

export const CLIP_SIZE = { width: 1080, height: 1350 } as const;
// Mirrors postClipSchema's length budget in marketing-studio.
const LIMITS = { hook: 70, title: 40, detail: 90, takeaway: 80 } as const;

export interface ClipBrand {
  brandId: string;
  /** Small label above the hook: the page name (company) or the author (personal). */
  kicker: string;
  /** End-card text, e.g. the site host. */
  cta: string;
}

export interface ClipScript {
  hook: string;
  points: { title: string; detail: string }[];
  takeaway: string;
}

/** Sentences of the post, hashtag lines and links dropped. */
export function sentences(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => !/^\s*#\w/.test(l))
    .join(" ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(^|\s)#\w+/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Cut at a word boundary, with an ellipsis when something was cut. No em dashes survive. */
function clip(s: string, max: number): string {
  s = s.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).replace(/[,;:]$/, "")}…`;
}

export function scriptPrompt(text: string): string {
  return `You write the on-screen script of a silent 20-second video that sums up the LinkedIn post below, for people scrolling with sound off. The viewer must get the post's point from the video alone.

Answer with ONLY a JSON object, no prose, no code fence:
{"hook": "...", "points": [{"title": "...", "detail": "..."}], "takeaway": "..."}

Rules:
- hook: at most ${LIMITS.hook} characters, the problem or claim that stops the scroll.
- points: 2 or 3 of them, in the order of the post. title at most ${LIMITS.title} characters, detail at most ${LIMITS.detail} characters. Concrete, explicit, plain words.
- takeaway: at most ${LIMITS.takeaway} characters, the one thing to remember.
- Same language as the post. Only facts the post states. No hashtags, no emojis, no em dashes, no hype words, no client names.

The post:
"""
${text}
"""`;
}

/** The script from Claude's answer, clamped to the budget; null when it is not usable. */
export function parseScript(raw: string): ClipScript | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: unknown;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const o = j as Partial<ClipScript>;
  if (typeof o.hook !== "string" || typeof o.takeaway !== "string" || !Array.isArray(o.points)) return null;
  const points = o.points
    .filter((p) => p && typeof p.title === "string" && p.title.trim())
    .slice(0, 3)
    .map((p) => ({ title: clip(p.title, LIMITS.title), detail: clip(typeof p.detail === "string" ? p.detail : "", LIMITS.detail) }));
  if (!o.hook.trim() || !o.takeaway.trim() || !points.length) return null;
  return { hook: clip(o.hook, LIMITS.hook), points, takeaway: clip(o.takeaway, LIMITS.takeaway) };
}

/** No Claude: the first sentence as hook, the next ones as points, the last as takeaway. */
export function fallbackScript(post: { text: string; topic: string }): ClipScript {
  const all = sentences(post.text);
  const rest = all.slice(1);
  // ponytail: a post of one or two sentences has nothing to spare, so the topic or the hook closes it.
  const takeaway = rest.length > 1 ? rest[rest.length - 1] : rest.length === 1 ? post.topic : all[0] ?? post.topic;
  const points = (rest.length > 1 ? rest.slice(0, -1) : rest).slice(0, 3).map((s) => ({ title: clip(s, LIMITS.title), detail: "" }));
  return {
    hook: clip(all[0] ?? post.topic, LIMITS.hook),
    points: points.length ? points : [{ title: clip(post.topic, LIMITS.title), detail: "" }],
    takeaway: clip(takeaway, LIMITS.takeaway),
  };
}

/** The mood of a post's ambient track, from its pillar (the names engine/SKILL.md emits). */
export function moodFor(pillar: string | undefined): "focus" | "warm" | "bright" {
  if (pillar === "client-outcome" || pillar === "lesson") return "warm";
  if (pillar === "cool-repo" || pillar === "build-in-public") return "bright";
  return "focus"; // smart-ai-workflow, and any pillar added later
}

/**
 * One track from `<mood>-N.mp3` files, the same one every time for the same post (hash of its id).
 * Falls back to any track when the mood has none; null when there are no tracks at all.
 */
export function pickTrack(files: string[], pillar: string | undefined, id: string): string | null {
  // Dotfiles out: macOS leaves `._x.mp3` resource forks next to copied files, and Remotion can't play those.
  const mp3 = files.filter((f) => /\.mp3$/i.test(f) && !f.startsWith(".")).sort();
  const mood = moodFor(pillar);
  const pool = mp3.filter((f) => f.startsWith(`${mood}-`));
  const from = pool.length ? pool : mp3;
  if (!from.length) return null;
  const h = [...id].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 0);
  return from[h % from.length];
}

export function clipProps(script: ClipScript, brand: ClipBrand, image: string | null, music: string | null) {
  return {
    brandId: brand.brandId,
    kicker: brand.kicker,
    hook: script.hook,
    image,
    points: script.points,
    takeaway: script.takeaway,
    cta: brand.cta,
    music: music ? { src: music } : null,
    formatWidth: CLIP_SIZE.width,
    formatHeight: CLIP_SIZE.height,
  };
}
