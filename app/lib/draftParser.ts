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

function parseOptionBlock(headerLine: string, body: string[]): DraftOption {
  const raw = [headerLine, ...body].join("\n").trim();
  let m = HEADER_RE.exec(headerLine);
  let score: number | null = null;
  let star = false;
  let n = 0;
  let pillar = "";
  let topic = "";
  let parsedHeader = true;

  if (m) {
    star = Boolean(m[1]);
    n = parseInt(m[2], 10);
    pillar = m[3].trim();
    topic = m[4].trim();
    score = parseFloat(m[5]);
  } else if ((m = HEADER_RE_NOSCORE.exec(headerLine))) {
    star = Boolean(m[1]);
    n = parseInt(m[2], 10);
    pillar = m[3].trim();
    topic = m[4].trim();
  } else {
    parsedHeader = false;
  }

  // Sub-section extraction
  const text = body.join("\n");
  const companyPost = extractBetween(text, /\*\*A\.\s*Company post\*\*/i, /\*\*B\.\s*Repost caption[^\n]*\*\*/i);
  const repostCaption = extractBetween(
    text,
    /\*\*B\.\s*Repost caption[^\n]*\*\*/i,
    /^_Why it works:_/im
  );
  const why = extractLine(text, /^_Why it works:_\s*(.*)$/im);
  const visual = extractLine(text, /^_Suggested visual:_\s*(.*)$/im);

  const parsed = parsedHeader && companyPost.length > 0;

  return { n, star, pillar, topic, score, companyPost, repostCaption, why, visual, raw, parsed };
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

export function parseDraft(md: string): Draft {
  const lines = md.split(/\r?\n/);
  let title = "";
  let date: string | null = null;
  const instruction: string[] = [];
  const options: DraftOption[] = [];
  const footerLines: string[] = [];

  let inFooter = false;
  let curHeader: string | null = null;
  let curBody: string[] = [];
  let seenFirstOption = false;

  const flush = () => {
    if (curHeader !== null) options.push(parseOptionBlock(curHeader, curBody));
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

  return {
    date,
    title,
    instruction: instruction.join("\n").trim(),
    options,
    footer: footerLines.join("\n").trim(),
  };
}
