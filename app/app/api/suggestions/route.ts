import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { configPath, expandTilde } from "@/lib/paths";
import { PILLAR_LABELS } from "@/lib/theme";
import { shouldSurfaceRecent } from "@/lib/steering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Project = { name: string; path: string; source: "allowlist" | "recent"; inAllowlist: boolean };

const MAX_RECENT = 8;

function safeMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// A session's working dir lives on message records inside the .jsonl (not line 1).
// Read a bounded head of the newest one or two sessions and pull the first cwd.
function sessionCwd(dir: string): string | null {
  let files: { f: string; m: number }[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, m: safeMtimeMs(path.join(dir, f)) }))
      .sort((a, b) => b.m - a.m);
  } catch {
    return null;
  }
  for (const { f } of files.slice(0, 2)) {
    try {
      const fd = fs.openSync(path.join(dir, f), "r");
      const buf = Buffer.alloc(262144);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const m = buf
        .subarray(0, n)
        .toString("utf8")
        .match(/"cwd"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    } catch {
      /* unreadable — skip */
    }
  }
  return null;
}

export async function GET() {
  const { resolved } = loadConfig();
  const repoRoot = resolved.repoRoot;

  // Raw config for fields the typed loader doesn't expose (harvest allowlist, dayJob, scrub).
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    /* defaults below */
  }
  const harvest = (raw.harvest ?? {}) as { repoAllowlistFile?: string };
  const dayJob = (raw.dayJob ?? {}) as { clientReposRoot?: string };
  const scrub = (raw.scrub ?? {}) as { clientNames?: string[] };
  const allowlistRel = harvest.repoAllowlistFile ?? "engine/postable-projects.txt";
  const clientNames = Array.isArray(scrub.clientNames) ? scrub.clientNames : [];
  const clientReposRoot = expandTilde(dayJob.clientReposRoot ?? "");

  // ---- allowlist projects (the ONLY repos ever mined) ----
  const allowlistPath = path.join(repoRoot, allowlistRel);
  let allowEntries: string[] = [];
  try {
    allowEntries = fs
      .readFileSync(allowlistPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => expandTilde(l));
  } catch {
    /* no allowlist yet */
  }
  const allowResolved = new Set(allowEntries.map((p) => path.resolve(p)));
  const projects: Project[] = allowEntries.map((p) => ({
    name: path.basename(p),
    path: p,
    source: "allowlist",
    inAllowlist: true,
  }));

  // ---- recent Claude Code sessions (display/nudge only; hard-filtered for safety) ----
  const projectsRoot = path.join(os.homedir(), "Desktop", "Projects");
  const sessionsDir = path.join(os.homedir(), ".claude", "projects");

  try {
    const dirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, m: safeMtimeMs(path.join(sessionsDir, d.name)) }))
      .sort((a, b) => b.m - a.m);
    const seen = new Set<string>();
    let added = 0;
    for (const d of dirs) {
      if (added >= MAX_RECENT) break;
      const cwd = sessionCwd(path.join(sessionsDir, d.name));
      if (!cwd) continue;
      if (!shouldSurfaceRecent(cwd, { projectsRoot, clientReposRoot, clientNames })) continue; // never surface client work
      const rp = path.resolve(cwd);
      if (allowResolved.has(rp) || seen.has(rp)) continue; // already shown as allowlist / dup
      seen.add(rp);
      projects.push({ name: path.basename(cwd), path: cwd, source: "recent", inAllowlist: false });
      added++;
    }
  } catch {
    /* no ~/.claude/projects — allowlist-only is fine */
  }

  const categories = Object.entries(PILLAR_LABELS).map(([id, label]) => ({ id, label }));
  return NextResponse.json({ projects, categories });
}
