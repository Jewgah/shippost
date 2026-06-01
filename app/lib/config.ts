import "server-only";
import fs from "node:fs";
import path from "node:path";
import { configPath, expandTilde, findRepoRoot } from "./paths";

export interface ShippostConfig {
  author: { name: string; bio: string; portfolioDataDir: string };
  brand: { name: string; tagline: string; offers: string; vibe: string; logoPath: string };
  scrub: { clientNames: string[]; extraTerms: string[] };
  output: {
    draftsDir: string;
    recentPostsFile: string;
    voiceSampleFile: string;
    picksLogFile: string;
  };
  app: { port: number; theme: string };
  // resolved absolute paths (convenience)
  resolved: {
    draftsDir: string;
    recentPostsPath: string;
    voiceSamplePath: string;
    picksLogPath: string;
    rejectsLogPath: string;
    onboardedMarker: string;
    logoPath: string;
    repoRoot: string;
  };
}

let cached: ShippostConfig | null = null;

export function loadConfig(): ShippostConfig {
  if (cached) return cached;
  const cfgPath = configPath();
  const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

  const author = {
    name: raw.author?.name ?? "Your Name",
    bio: raw.author?.bio ?? "",
    portfolioDataDir: expandTilde(raw.author?.portfolioDataDir ?? ""),
  };
  const brand = {
    name: raw.brand?.name ?? "Your Brand",
    tagline: raw.brand?.tagline ?? "",
    offers: raw.brand?.offers ?? "",
    vibe: raw.brand?.vibe ?? "",
    logoPath: expandTilde(raw.brand?.logoPath ?? ""),
  };
  const scrub = {
    clientNames: Array.isArray(raw.scrub?.clientNames) ? raw.scrub.clientNames : [],
    extraTerms: Array.isArray(raw.scrub?.extraTerms) ? raw.scrub.extraTerms : [],
  };
  const output = {
    draftsDir: raw.output?.draftsDir ?? "~/Downloads/shippost-drafts",
    recentPostsFile: raw.output?.recentPostsFile ?? "recent-posts.md",
    voiceSampleFile: raw.output?.voiceSampleFile ?? "voice-sample.md",
    picksLogFile: raw.output?.picksLogFile ?? ".picks.jsonl",
  };
  const app = {
    port: raw.app?.port ?? 3030,
    theme: raw.app?.theme ?? "neutral",
  };

  const draftsDir = expandTilde(output.draftsDir);
  cached = {
    author,
    brand,
    scrub,
    output,
    app,
    resolved: {
      draftsDir,
      recentPostsPath: path.join(draftsDir, output.recentPostsFile),
      voiceSamplePath: path.join(draftsDir, output.voiceSampleFile),
      picksLogPath: path.join(draftsDir, output.picksLogFile),
      rejectsLogPath: path.join(draftsDir, ".rejects.jsonl"),
      onboardedMarker: path.join(draftsDir, ".onboarded"),
      logoPath: brand.logoPath,
      repoRoot: findRepoRoot(),
    },
  };
  return cached;
}

/** The safe subset exposed to the client (never the bio / client list). */
export function publicConfig() {
  const c = loadConfig();
  return {
    brandName: c.brand.name,
    brandTagline: c.brand.tagline,
    authorName: c.author.name,
    theme: c.app.theme,
    hasLogo: Boolean(c.brand.logoPath) && fs.existsSync(c.brand.logoPath),
  };
}
