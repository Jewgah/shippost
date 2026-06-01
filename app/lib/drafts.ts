import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { parseDraft, type Draft } from "./draftParser";
import { isDraftId } from "./draftId";
import { recentPostCount } from "./voice";
import { effectiveLogoPath, readSettings, uploadedAvatarPath } from "./settings";

export interface DraftSummary {
  date: string;
  optionCount: number;
  pillars: string[];
  topPick: string | null;
}

export function listDrafts(): DraftSummary[] {
  const { resolved } = loadConfig();
  if (!fs.existsSync(resolved.draftsDir)) return [];
  const files = fs
    .readdirSync(resolved.draftsDir)
    .filter((f) => f.endsWith(".md") && isDraftId(f.slice(0, -3)))
    .sort()
    .reverse();

  return files.map((f) => {
    const md = fs.readFileSync(path.join(resolved.draftsDir, f), "utf8");
    const d = parseDraft(md);
    const pillars = Array.from(new Set(d.options.map((o) => o.pillar).filter(Boolean)));
    const top = d.options.find((o) => o.star) ?? d.options[0];
    return {
      date: f.replace(/\.md$/, ""),
      optionCount: d.options.length,
      pillars,
      topPick: top ? top.topic : null,
    };
  });
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
