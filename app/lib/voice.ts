import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

const SEP = "\n\n---\n\n";
const STORE_CAP = 100; // keep the file from growing forever (harvest only reads the last ~12)

function ensureDir() {
  const { resolved } = loadConfig();
  fs.mkdirSync(resolved.draftsDir, { recursive: true });
}

function readBlocks(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  return raw
    .split(/\n-{3,}\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function writeBlocks(file: string, blocks: string[]) {
  const kept = blocks.slice(-STORE_CAP);
  fs.writeFileSync(file, kept.join(SEP) + "\n", "utf8");
}

/** Append posts (dedup against what's already there), capped. Returns kept count added. */
export function addRecentPosts(posts: string[]): number {
  ensureDir();
  const { resolved } = loadConfig();
  const existing = readBlocks(resolved.recentPostsPath);
  const seen = new Set(existing.map((b) => b.replace(/\s+/g, " ").trim().toLowerCase()));
  let added = 0;
  for (const p of posts) {
    const norm = p.replace(/\s+/g, " ").trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    existing.push(p.trim());
    seen.add(norm);
    added++;
  }
  writeBlocks(resolved.recentPostsPath, existing);
  return added;
}

export function recentPostCount(): number {
  const { resolved } = loadConfig();
  return readBlocks(resolved.recentPostsPath).length;
}

/** Record that the author published a given option: log it + add it to the voice corpus. */
export function recordPick(args: {
  date: string;
  option: number;
  pillar: string;
  topic: string;
  companyPost: string;
  repostCaption?: string;
}): void {
  ensureDir();
  const { resolved } = loadConfig();
  const entry = {
    ts: new Date().toISOString(),
    date: args.date,
    option: args.option,
    pillar: args.pillar,
    topic: args.topic,
  };
  fs.appendFileSync(resolved.picksLogPath, JSON.stringify(entry) + "\n", "utf8");
  // Add the published company post to the voice corpus so future runs match it.
  if (args.companyPost?.trim()) addRecentPosts([args.companyPost]);
}

/**
 * Read the append-only picks log back into a map of draft id → posted option numbers.
 * Join key is the EXACT draft id recorded by recordPick (the full id, incl. _HHMMSS) — not a
 * date prefix — so same-day runs don't bleed into each other. Tolerates a partial/garbage last
 * line (the log is appended to, never rewritten). Returns {} if the log doesn't exist yet.
 */
export function pickedOptionsByDraftId(): Record<string, number[]> {
  const { resolved } = loadConfig();
  if (!fs.existsSync(resolved.picksLogPath)) return {};
  const out: Record<string, number[]> = {};
  const raw = fs.readFileSync(resolved.picksLogPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue; // skip a malformed/partial line rather than failing the whole list
    }
    // JSON.parse can succeed with null/scalar/array (e.g. a line that is literally `null`),
    // so guard for an object before touching properties — otherwise `.date` on null throws.
    if (!parsed || typeof parsed !== "object") continue;
    const e = parsed as { date?: unknown; option?: unknown };
    if (typeof e.date !== "string" || typeof e.option !== "number") continue;
    const arr = out[e.date] ?? (out[e.date] = []);
    if (!arr.includes(e.option)) arr.push(e.option); // dedupe re-posts of the same option
  }
  return out;
}

export function markOnboarded(): void {
  ensureDir();
  const { resolved } = loadConfig();
  fs.writeFileSync(resolved.onboardedMarker, new Date().toISOString() + "\n", "utf8");
}
