import "server-only";
import Papa from "papaparse";
import AdmZip from "adm-zip";

const IMPORT_CAP = 30; // keep the most-recent N posts

export interface ImportResult {
  posts: string[];
  column: string;
  totalRows: number;
}

/** Pull the CSV text out of a LinkedIn export — accepts a raw .csv or the .zip. */
function extractCsv(buf: Buffer, filename: string): string {
  const isZip = filename.toLowerCase().endsWith(".zip") || (buf[0] === 0x50 && buf[1] === 0x4b);
  if (!isZip) return buf.toString("utf8");

  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  // Prefer a "Shares.csv"-like entry; fall back to any .csv.
  const shares =
    entries.find((e) => /shares?.*\.csv$/i.test(e.entryName)) ??
    entries.find((e) => /\.csv$/i.test(e.entryName));
  if (!shares) throw new Error("No CSV found inside the ZIP (looked for Shares.csv).");
  return shares.getData().toString("utf8");
}

/** Find the column that holds the post text. Names drift by export version/locale. */
function findCommentaryColumn(fields: string[]): string | null {
  const lc = (s: string) => s.toLowerCase().replace(/[\s_]/g, "");
  // Best match: contains "commentary"
  let col = fields.find((f) => lc(f).includes("commentary"));
  if (col) return col;
  // Fallbacks
  col = fields.find((f) => ["sharecommentary", "content", "text", "post", "message"].includes(lc(f)));
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
