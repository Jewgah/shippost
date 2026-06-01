import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

const SEP = "\n\n---\n\n";
const STORE_CAP = 100; // keep the file from growing forever (harvest only reads the last ~12)
export const PICKS_CAP = 2000; // bound the picks log too (~years of an every-2-days habit)

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
  // Append in the common case (a plain append never risks more than a torn last line). Only
  // when the log has actually grown past the cap do we rewrite a trimmed copy — so the rare
  // whole-file rewrite, the only op that could truncate history on a crash, happens seldom.
  fs.appendFileSync(resolved.picksLogPath, JSON.stringify(entry) + "\n", "utf8");
  const lines = fs.readFileSync(resolved.picksLogPath, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > PICKS_CAP) {
    fs.writeFileSync(resolved.picksLogPath, lines.slice(-PICKS_CAP).join("\n") + "\n", "utf8");
  }
  // Add the published company post to the voice corpus so future runs match it.
  if (args.companyPost?.trim()) addRecentPosts([args.companyPost]);
}

interface PickEntry {
  date: string; // the EXACT draft id (incl. _HHMMSS), as recorded by recordPick
  option: number;
  ts: string; // ISO timestamp; "" if a legacy/garbage line had none
}

/**
 * The one place that reads the append-only picks log back into typed entries. Tolerates blank,
 * malformed/partial, and valid-JSON-but-non-object lines (e.g. a literal `null`) without throwing.
 * Requires a string date + numeric option; ts is best-effort. Returns [] if the log is absent.
 */
function readPickEntries(): PickEntry[] {
  const { resolved } = loadConfig();
  if (!fs.existsSync(resolved.picksLogPath)) return [];
  const out: PickEntry[] = [];
  const raw = fs.readFileSync(resolved.picksLogPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue; // skip a malformed/partial line rather than failing the whole read
    }
    if (!parsed || typeof parsed !== "object") continue; // guard before property access
    const e = parsed as { date?: unknown; option?: unknown; ts?: unknown };
    if (typeof e.date !== "string" || typeof e.option !== "number") continue;
    out.push({ date: e.date, option: e.option, ts: typeof e.ts === "string" ? e.ts : "" });
  }
  return out;
}

function groupOptionsByDraftId(entries: PickEntry[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const e of entries) {
    const arr = out[e.date] ?? (out[e.date] = []);
    if (!arr.includes(e.option)) arr.push(e.option); // dedupe re-posts of the same option
  }
  return out;
}

/**
 * Map of draft id → posted option numbers. Joined on the EXACT draft id so same-day runs
 * (2026-05-31_185437 vs _190218) don't bleed into each other.
 */
export function pickedOptionsByDraftId(): Record<string, number[]> {
  return groupOptionsByDraftId(readPickEntries());
}

/**
 * Posted-options map AND posting cadence from a SINGLE read of the picks log — the home page
 * needs both, so this avoids reading/parsing the log twice per render.
 */
export function pickData(): { pickedByDraftId: Record<string, number[]>; cadence: Cadence } {
  const entries = readPickEntries();
  const stamps = entries.map((e) => Date.parse(e.ts)).filter((ms) => Number.isFinite(ms));
  return { pickedByDraftId: groupOptionsByDraftId(entries), cadence: computeCadence(stamps, Date.now()) };
}

export interface Cadence {
  lastPostedAt: string | null; // ISO of the most recent post, or null if none
  daysSince: number | null; // whole days since the last post
  due: boolean; // true if it's been >= 2 days (the every-2-days habit), or nothing posted yet
  streak: number; // consecutive on-cadence posting days ending at the most recent post
  total: number; // total posts logged
}

const DAY_MS = 86_400_000;
const CADENCE_DAYS = 2; // the every-2-days posting habit
const STREAK_GAP_DAYS = 3; // a streak survives a gap of up to this many days (cadence + a day of slack)

/**
 * Pure cadence math, separated from disk I/O so it's trivially testable. `nowMs` is injected.
 * Streak = how many consecutive distinct posting-days, walking back from the most recent, stayed
 * within STREAK_GAP_DAYS of each other.
 */
export function computeCadence(postTimestampsMs: number[], nowMs: number): Cadence {
  const ts = postTimestampsMs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (ts.length === 0) return { lastPostedAt: null, daysSince: null, due: true, streak: 0, total: 0 };

  const last = ts[ts.length - 1];
  const daysSince = Math.max(0, Math.floor((nowMs - last) / DAY_MS));
  const due = nowMs - last >= CADENCE_DAYS * DAY_MS;

  const days = Array.from(new Set(ts.map((t) => Math.floor(t / DAY_MS)))).sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] <= STREAK_GAP_DAYS) streak++;
    else break;
  }
  return { lastPostedAt: new Date(last).toISOString(), daysSince, due, streak, total: ts.length };
}

export function markOnboarded(): void {
  ensureDir();
  const { resolved } = loadConfig();
  fs.writeFileSync(resolved.onboardedMarker, new Date().toISOString() + "\n", "utf8");
}
