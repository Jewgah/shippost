import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 15 * 60 * 1000; // a run older than this is considered dead (well beyond a real ~1-5min run)

function paths() {
  const { resolved } = loadConfig();
  return {
    draftsDir: resolved.draftsDir,
    repoRoot: resolved.repoRoot,
    lock: path.join(resolved.draftsDir, ".generating"),
    result: path.join(resolved.draftsDir, ".last_generate.json"),
  };
}

function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  const { draftsDir, repoRoot, lock, result } = paths();
  fs.mkdirSync(draftsDir, { recursive: true });

  const { running } = readRunning(lock);
  if (running) return NextResponse.json({ started: false, running: true });

  const date = today();
  fs.writeFileSync(lock, String(Date.now()), "utf8");

  const script = path.join(repoRoot, "engine", "generate.sh");
  const child = spawn("bash", [script, "--force"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
  });

  const finish = (ok: boolean, extra: Record<string, unknown> = {}) => {
    try {
      fs.writeFileSync(result, JSON.stringify({ ok, date, finishedAt: Date.now(), ...extra }));
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(lock);
    } catch {
      /* ignore */
    }
  };

  child.on("error", (err) => finish(false, { error: String(err) }));
  child.on("close", (code) => {
    const ok = code === 0 && fs.existsSync(path.join(draftsDir, `${date}.md`));
    finish(ok, { code });
  });

  return NextResponse.json({ started: true, running: true, date });
}
