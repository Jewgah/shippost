import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { PILLAR_LABELS } from "@/lib/theme";
import { cleanField } from "@/lib/steering";
import { readSettings } from "@/lib/settings";
import { acquireRunLock, releaseRunLock, STALE_MS } from "@/lib/runLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function paths() {
  const { resolved } = loadConfig();
  return {
    draftsDir: resolved.draftsDir,
    repoRoot: resolved.repoRoot,
    lock: path.join(resolved.draftsDir, ".generating"),
    result: path.join(resolved.draftsDir, ".last_generate.json"),
  };
}

// A per-run id: YYYY-MM-DD_HHMMSS. Passed to the engine via SHIPPOST_STAMP so the
// route and engine agree on the output filename, and so multiple runs on the same
// day produce distinct files instead of overwriting each other.
function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readRunning(lock: string): { running: boolean; startedAt: number | null } {
  if (!fs.existsSync(lock)) return { running: false, startedAt: null };
  const stat = fs.statSync(lock);
  const startedAt = Number(fs.readFileSync(lock, "utf8").trim()) || stat.mtimeMs;
  return { running: Date.now() - stat.mtimeMs < STALE_MS, startedAt };
}

export async function GET() {
  const { lock, result } = paths();
  const { running, startedAt } = readRunning(lock);
  let lastResult: unknown = null;
  if (fs.existsSync(result)) {
    try {
      lastResult = JSON.parse(fs.readFileSync(result, "utf8"));
    } catch {
      /* ignore malformed */
    }
  }
  return NextResponse.json({ running, startedAt, lastResult });
}

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  // Optional steering (back-compatible: existing callers send no body).
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* no/invalid body — run with defaults */
  }
  const direction = cleanField(body.direction, 500);
  const project = cleanField(body.project, 100);
  let category = cleanField(body.category, 100);
  if (category && !(category in PILLAR_LABELS)) category = undefined; // ignore unknown pillars

  const { draftsDir, repoRoot, lock, result } = paths();
  fs.mkdirSync(draftsDir, { recursive: true });

  const token = acquireRunLock(lock);
  if (!token) return NextResponse.json({ started: false, running: true });

  const date = nowStamp();

  const script = path.join(repoRoot, "engine", "generate.sh");
  const child = spawn("bash", [script, "--force"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SHIPPOST_STAMP: date,
      SHIPPOST_COMPANY_MODE: readSettings().companyMode ? "1" : "0",
      ...(direction ? { SHIPPOST_FOCUS: direction } : {}),
      ...(project ? { SHIPPOST_PROJECT: project } : {}),
      ...(category ? { SHIPPOST_CATEGORY: category } : {}),
    },
    stdio: "ignore",
  });

  const finish = (ok: boolean, extra: Record<string, unknown> = {}) => {
    try {
      fs.writeFileSync(result, JSON.stringify({ ok, date, finishedAt: Date.now(), ...extra }));
    } catch {
      /* ignore */
    }
    releaseRunLock(lock, token); // compare-and-delete: never unlinks a newer run's lock
  };

  child.on("error", (err) => finish(false, { error: String(err) }));
  child.on("close", (code) => {
    const ok = code === 0 && fs.existsSync(path.join(draftsDir, `${date}.md`));
    finish(ok, { code });
  });

  return NextResponse.json({ started: true, running: true, date });
}
