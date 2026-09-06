import "server-only";
import Papa from "papaparse";
import AdmZip from "adm-zip";

const IMPORT_CAP = 30; // keep the most-recent N posts

export interface ImportResult {
  posts: string[];
  column: string;
  totalRows: number;
}

// LinkedIn's messages.csv (your DMs) sits next to Shares.csv in the full export and has a
// CONTENT column, so it used to import cleanly as "your voice". It is rejected by name here,
// and its column shape is no longer accepted below.
const isMessagesCsv = (name: string) => /messages?\.csv$/i.test(name);
const MESSAGES_HINT = "messages.csv holds your LinkedIn DMs, not your posts. Import Shares.csv (the posts export).";

/** Pull the CSV text out of a LinkedIn export — accepts a raw .csv or the .zip. */
function extractCsv(buf: Buffer, filename: string): string {
  const isZip = filename.toLowerCase().endsWith(".zip") || (buf[0] === 0x50 && buf[1] === 0x4b);
  if (!isZip) {
    if (isMessagesCsv(filename)) throw new Error(MESSAGES_HINT);
    return buf.toString("utf8");
  }

  const zip = new AdmZip(buf);
  const csvs = zip.getEntries().filter((e) => !e.isDirectory && /\.csv$/i.test(e.entryName));
  // Only a Shares-like entry qualifies. There is deliberately NO "any .csv" fallback: that is
  // how a messages.csv once became the voice corpus, and a wrong file is worse than no file.
  const shares = csvs.find((e) => /shares?[^/]*\.csv$/i.test(e.entryName) && !isMessagesCsv(e.entryName));
  if (!shares) {
    const names = csvs.map((e) => e.entryName).join(", ") || "(none)";
    throw new Error(
      `No Shares.csv inside the ZIP. CSV files found: ${names}. ` +
        `Export your posts ("Shares"), not messages or connections, or import the extracted Shares.csv directly.`
    );
  }
  return shares.getData().toString("utf8");
}

/** Find the column that holds the post text. Names drift by export version/locale. */
function findCommentaryColumn(fields: string[]): string | null {
  const lc = (s: string) => s.toLowerCase().replace(/[\s_]/g, "");
  // Best match: contains "commentary"
  let col = fields.find((f) => lc(f).includes("commentary"));
  if (col) return col;
  // Fallbacks. "content" and "message" are NOT here on purpose: they are the messages.csv
  // (DMs) column names, and matching them is what polluted a corpus with cold-outreach DMs.
  col = fields.find((f) => ["sharecommentary", "text", "post"].includes(lc(f)));
  return col ?? null;
}

function findDateColumn(fields: string[]): string | null {
  const lc = (s: string) => s.toLowerCase();
  return fields.find((f) => lc(f).includes("date") || lc(f) === "time") ?? null;
}

const looksLikeUrlOnly = (s: string) => /^https?:\/\/\S+$/.test(s.trim());

export function parseShares(buf: Buffer, filename: string): ImportResult {
  const csv = extractCsv(buf, filename);
  if (csv.length > 20_000_000) {
    throw new Error("CSV too large (max ~20 MB of text). Trim the export and retry.");
  }
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const fields = parsed.meta.fields ?? [];
  const col = findCommentaryColumn(fields);
  if (!col) {
    throw new Error(
      `Couldn't find a post-text column. Columns were: ${fields.join(", ") || "(none)"}. ` +
        `Try the manual paste option instead.`
    );
  }
  const dateCol = findDateColumn(fields);

  let rows = parsed.data.filter((r) => {
    const v = (r[col] ?? "").trim();
    return v.length > 0 && !looksLikeUrlOnly(v);
  });

  // Sort oldest → newest if we have a date, so the newest ends up appended last
  // (harvest tails the most-recent posts). Compare as real timestamps — a lexical compare
  // mis-orders non-ISO exports (e.g. US "6/12/2026") and would feed the wrong "most recent"
  // posts into the voice corpus. One consistent rule for the WHOLE set: timestamps only when
  // every row parses, else pure lexical — mixing the two per-pair is not a total order.
  if (dateCol) {
    const ts = (r: Record<string, string>) => Date.parse(String(r[dateCol]));
    const allParse = rows.every((r) => !Number.isNaN(ts(r)));
    rows = rows.sort((a, b) =>
      allParse ? ts(a) - ts(b) : String(a[dateCol]).localeCompare(String(b[dateCol]))
    );
  }

  // Keep the most-recent IMPORT_CAP, preserving ascending order.
  const recent = rows.slice(-IMPORT_CAP);
  const posts = recent.map((r) => r[col].trim());

  return { posts, column: col, totalRows: parsed.data.length };
}
