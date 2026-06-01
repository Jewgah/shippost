// Parses the exact draft markdown shippost's engine writes, into typed options.
// DEFENSIVE: if a block deviates from the format, it's returned with parsed=false
// and its raw markdown, so the UI can show it rather than crash.

export interface DraftOption {
  n: number;
  star: boolean;
  pillar: string;
  topic: string;
  score: number | null;
  companyPost: string;
  repostCaption: string;
  why: string;
  visual: string;
  raw: string;
  parsed: boolean;
}

export interface Draft {
  date: string | null;
  title: string;
  instruction: string;
  options: DraftOption[];
  footer: string;
}

// Header-only view of an option — everything that lives on the `## Option N — pillar — topic (score)`
// line, without parsing the post bodies. Used by the drafts list, which never needs the post text.
export interface DraftOptionMeta {
  n: number;
  star: boolean;
  pillar: string;
  topic: string;
  score: number | null;
  parsedHeader: boolean;
}

export interface DraftMeta {
  date: string | null;
  options: DraftOptionMeta[];
}

const EMDASH = "—";
// Separators are " — " (space-dash-space). Requiring surrounding whitespace is
// essential so the internal hyphens in pillar names (smart-ai-workflow,
// build-in-public, cool-repo) are NOT treated as separators.
const SEP = `\\s+[${EMDASH}-]\\s+`;
// ## [⭐ ]Option N — pillar — topic   (score/10)   (tolerate 2+ spaces before score)
const HEADER_RE = new RegExp(
  `^#{2,3}\\s+(⭐\\s*)?Option\\s+(\\d+)${SEP}(.+?)${SEP}(.+?)\\s{2,}\\(\\s*([\\d.]+)\\s*\\/\\s*10\\s*\\)\\s*$`
);
// Same, but no score (fallback)
const HEADER_RE_NOSCORE = new RegExp(
  `^#{2,3}\\s+(⭐\\s*)?Option\\s+(\\d+)${SEP}(.+?)${SEP}(.+?)\\s*$`
);

const FOOTER_RE = /^(pillars used|sources(\s*\(scrubbed\))?|scrubbed)\s*:/i;

/**
 * Strip "AI tells" from POST BODY text (sections A & B) so a pasted post reads human:
 * em/en dashes become a spaced hyphen, fancy arrows become the word "to". NEVER run this
 * on the header/title/footer — the option header uses " — " (em-dash) as the parser
 * separator (see SEP above). Idempotent; only touches em/en dashes + arrow glyphs, never
 * ASCII hyphens, and never collapses newlines (only runs of spaces/tabs).
 */
export function humanizeText(s: string): string {
  return s
    .replace(/[ \t]*[—–][ \t]*/g, " - ")
    .replace(/[ \t]*[→←⇒⟶➜➔➙➔]+[ \t]*/g, " to ")
    .replace(/[ \t]{2,}/g, " ");
}

// The single source of truth for reading an option's header line. Both the full parse
// and the lightweight meta parse go through here so they can never disagree on which
// `##` lines are options or on their pillar/topic/score/star.
function parseHeader(headerLine: string): DraftOptionMeta {
  let m = HEADER_RE.exec(headerLine);
  if (m) {
    return { star: Boolean(m[1]), n: parseInt(m[2], 10), pillar: m[3].trim(), topic: m[4].trim(), score: parseFloat(m[5]), parsedHeader: true };
  }
  if ((m = HEADER_RE_NOSCORE.exec(headerLine))) {
    return { star: Boolean(m[1]), n: parseInt(m[2], 10), pillar: m[3].trim(), topic: m[4].trim(), score: null, parsedHeader: true };
  }
  return { n: 0, star: false, pillar: "", topic: "", score: null, parsedHeader: false };
}

function parseOptionBlock(headerLine: string, body: string[]): DraftOption {
  const raw = [headerLine, ...body].join("\n").trim();
  const h = parseHeader(headerLine);

  // Sub-section extraction. Humanize ONLY the published post text (A & B).
  const text = body.join("\n");
  const companyPost = humanizeText(
    extractBetween(text, /\*\*A\.\s*Company post\*\*/i, /\*\*B\.\s*Repost caption[^\n]*\*\*/i)
  );
  const repostCaption = humanizeText(
    extractBetween(text, /\*\*B\.\s*Repost caption[^\n]*\*\*/i, /^_Why it works:_/im)
  );
  const why = extractLine(text, /^_Why it works:_\s*(.*)$/im);
  const visual = extractVisuals(text);

  const parsed = h.parsedHeader && companyPost.length > 0;

  return { n: h.n, star: h.star, pillar: h.pillar, topic: h.topic, score: h.score, companyPost, repostCaption, why, visual, raw, parsed };
}

function stripTrailingRule(s: string): string {
  return s.replace(/\n?-{3,}\s*$/m, "").trim();
}

function extractBetween(text: string, start: RegExp, end: RegExp): string {
  const s = start.exec(text);
  if (!s) return "";
  const from = s.index + s[0].length;
  const rest = text.slice(from);
  const e = end.exec(rest);
  const chunk = e ? rest.slice(0, e.index) : rest;
  return stripTrailingRule(chunk);
}

function extractLine(text: string, re: RegExp): string {
  const m = re.exec(text);
  return m ? m[1].trim() : "";
}

// Captures the whole "Suggested visuals" block (3 ideas, possibly multi-line),
// or the old single-line "_Suggested visual:_ …" form.
function extractVisuals(text: string): string {
  const m = /_Suggested visuals?:_[ \t]*(.*)$/im.exec(text);
  if (!m) return "";
  const inline = m[1].trim();
  const after = text.slice(m.index + m[0].length);
  return stripTrailingRule((inline ? inline + "\n" : "") + after).trim();
}

interface RawBlock {
  header: string;
  body: string[];
}

// Splits raw draft markdown into its structural parts (title/date, instruction, the raw
// option blocks, footer). This is the ONE place that decides where options begin/end and
// where the footer starts — shared by parseDraft and parseDraftMeta so they never diverge.
function splitDraft(md: string): {
  title: string;
  date: string | null;
  instruction: string;
  blocks: RawBlock[];
  footer: string;
} {
  const lines = md.split(/\r?\n/);
  let title = "";
  let date: string | null = null;
  const instruction: string[] = [];
  const blocks: RawBlock[] = [];
  const footerLines: string[] = [];

  let inFooter = false;
  let curHeader: string | null = null;
  let curBody: string[] = [];
  let seenFirstOption = false;

  const flush = () => {
    if (curHeader !== null) blocks.push({ header: curHeader, body: curBody });
    curHeader = null;
    curBody = [];
  };

  for (const line of lines) {
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, "").trim();
      const dm = /(\d{4}-\d{2}-\d{2})/.exec(title);
      date = dm ? dm[1] : null;
      continue;
    }
    if (FOOTER_RE.test(line)) {
      inFooter = true;
      flush();
    }
    if (inFooter) {
      footerLines.push(line);
      continue;
    }
    if (/^#{2,3}\s+/.test(line)) {
      // start of a new option
      flush();
      curHeader = line;
      seenFirstOption = true;
      continue;
    }
    if (!seenFirstOption) {
      if (line.trim().startsWith(">") || line.trim().length > 0) {
        instruction.push(line.replace(/^>\s?/, ""));
      }
      continue;
    }
    curBody.push(line);
  }
  flush();

  return { title, date, instruction: instruction.join("\n").trim(), blocks, footer: footerLines.join("\n").trim() };
}

export function parseDraft(md: string): Draft {
  const { title, date, instruction, blocks, footer } = splitDraft(md);
  return {
    date,
    title,
    instruction,
    options: blocks.map((b) => parseOptionBlock(b.header, b.body)),
    footer,
  };
}

// Lightweight parse for the drafts list: option headers only, no post-body extraction or
// humanizing. Same option boundaries and header regexes as parseDraft (via splitDraft/parseHeader).
export function parseDraftMeta(md: string): DraftMeta {
  const { date, blocks } = splitDraft(md);
  return { date, options: blocks.map((b) => parseHeader(b.header)) };
}

/**
 * Remove one option block (by its Option number) from raw draft markdown, leaving the title,
 * instruction, the other option blocks, and footer intact. Block boundaries use the SAME rules
 * as splitDraft (a `## `/`### ` line starts an option; the first FOOTER_RE line starts the
 * footer) so the two can never disagree about where an option begins or ends. Every option block
 * carries its own trailing `---` rule, so removing the line span [start, nextStart) also takes
 * that block's separator and never orphans one. Returns the rewritten markdown, how many option
 * blocks remain, and whether a block was actually removed (false ⇒ no such option, md unchanged).
 */
export function removeOptionFromMarkdown(
  md: string,
  n: number
): { md: string; remaining: number; removed: boolean } {
  const lines = md.split(/\r?\n/);
  const optionStarts: number[] = [];
  let footerStart = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_RE.test(lines[i])) {
      footerStart = i; // the footer claims the rest of the file — options never follow it
      break;
    }
    if (/^#{2,3}\s+/.test(lines[i])) optionStarts.push(i);
  }

  // Match the target on the same header parse the rest of the app uses, so "delete Option 3"
  // hits exactly the block the UI labelled Option 3.
  const target = optionStarts.findIndex((start) => {
    const h = parseHeader(lines[start]);
    return h.parsedHeader && h.n === n;
  });
  if (target === -1) return { md, remaining: optionStarts.length, removed: false };

  const start = optionStarts[target];
  const end = target + 1 < optionStarts.length ? optionStarts[target + 1] : footerStart;
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  return { md: kept.join("\n"), remaining: optionStarts.length - 1, removed: true };
}
