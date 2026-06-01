import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { parseDraft, parseDraftMeta, type Draft } from "./draftParser";
import { isDraftId } from "./draftId";
import { recentPostCount, pickedOptionsByDraftId } from "./voice";
import { effectiveLogoPath, readSettings, uploadedAvatarPath } from "./settings";

export interface DraftSummary {
  date: string;
  optionCount: number;
  pillars: string[];
  topPick: string | null;
  topScore: number | null;
  topics: string[];
  /** Option numbers the author marked "I posted this" for this run (deduped). Empty = unused. */
  postedOptions: number[];
}

// `picked` can be passed in by a caller that already read the picks log (e.g. the home page,
// which also needs cadence from the same read) — otherwise we read it ourselves.
export function listDrafts(picked?: Record<string, number[]>): DraftSummary[] {
  const { resolved } = loadConfig();
  if (!fs.existsSync(resolved.draftsDir)) return [];
  const files = fs
    .readdirSync(resolved.draftsDir)
    .filter((f) => f.endsWith(".md") && isDraftId(f.slice(0, -3)))
    .sort()
    .reverse();

  const pickedMap = picked ?? pickedOptionsByDraftId();

  return files
    .map((f): DraftSummary | null => {
      try {
        const md = fs.readFileSync(path.join(resolved.draftsDir, f), "utf8");
        const d = parseDraftMeta(md); // headers only — the list never needs post bodies
        const id = f.replace(/\.md$/, "");
        const pillars = Array.from(new Set(d.options.map((o) => o.pillar).filter(Boolean)));
        const top = d.options.find((o) => o.star) ?? d.options[0];
        // Topics in ranked order (Option 1 first) — the only thing that meaningfully
        // distinguishes one run from another. Pillars repeat almost every run.
        const topics = d.options.map((o) => o.topic.trim()).filter(Boolean);
        return {
          date: id,
          optionCount: d.options.length,
          pillars,
          topPick: top?.topic.trim() || null,
          topScore: top?.score ?? null,
          topics,
          postedOptions: pickedMap[id] ?? [],
        };
      } catch (e) {
        // A draft that vanished between readdir and read, or is unreadable, shouldn't 500
        // the whole list — drop it and render the rest, but log so it's diagnosable.
        console.error(`listDrafts: skipping unreadable draft ${f}:`, e);
        return null;
      }
    })
    .filter((d): d is DraftSummary => d !== null);
}

export function readDraft(date: string): Draft | null {
  const { resolved } = loadConfig();
  if (!isDraftId(date)) return null; // guard against path traversal
  const file = path.join(resolved.draftsDir, `${date}.md`);
  if (!fs.existsSync(file)) return null;
  return parseDraft(fs.readFileSync(file, "utf8"));
}

export interface Status {
  firstLaunch: boolean;
  draftsDirExists: boolean;
  recentPostsExists: boolean;
  draftCount: number;
  latestDate: string | null;
  brandName: string;
  authorName: string;
  theme: string;
  hasLogo: boolean;
  hasAvatar: boolean;
  companyMode: boolean;
  recentPostCount: number;
}

export function getStatus(): Status {
  const c = loadConfig();
  const draftsDirExists = fs.existsSync(c.resolved.draftsDir);
  const recentPostsExists = fs.existsSync(c.resolved.recentPostsPath);
  const onboarded = fs.existsSync(c.resolved.onboardedMarker);
  const drafts = listDrafts();
  return {
    firstLaunch: !recentPostsExists && !onboarded,
    draftsDirExists,
    recentPostsExists,
    draftCount: drafts.length,
    latestDate: drafts[0]?.date ?? null,
    brandName: c.brand.name,
    authorName: c.author.name,
    theme: c.app.theme,
    hasLogo: Boolean(effectiveLogoPath()),
    hasAvatar: Boolean(uploadedAvatarPath()),
    companyMode: readSettings().companyMode,
    recentPostCount: recentPostCount(),
  };
}
