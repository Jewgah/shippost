import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { cleanField } from "@/lib/steering";
import { isDraftId } from "@/lib/draftId";
import { acquireRunLock, releaseRunLock, STALE_MS } from "@/lib/runLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Render one option's suggested visual with the local ComfyUI. Shaped like /api/edit, with two
// deliberate differences: its own `.rendering` lock (NEVER `.generating`, which a scheduled run
// holds for minutes - a render must not be blocked by, or block, a generation), and its own
// `.last_render.json` so the card can poll this route without disturbing the generate panel.
function paths() {
  const { resolved } = loadConfig();
  return {
    draftsDir: resolved.draftsDir,
    repoRoot: resolved.repoRoot,
    lock: path.join(resolved.draftsDir, ".rendering"),
    result: path.join(resolved.draftsDir, ".last_render.json"),
    visualsDir: path.join(resolved.draftsDir, ".visuals"),
  };
}

export async function GET() {
  const { lock, result } = paths();
  let running = false;
  if (fs.existsSync(lock)) {
    try {
      running = Date.now() - fs.statSync(lock).mtimeMs < STALE_MS;
    } catch {
      /* vanished between the two calls - treat as not running */
    }
  }
  let lastResult: unknown = null;
  if (fs.existsSync(result)) {
    try {
      lastResult = JSON.parse(fs.readFileSync(result, "utf8"));
    } catch {
      /* ignore malformed */
    }
  }
  return NextResponse.json({ running, lastResult });
}

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* validated below */
  }
  const date = typeof body.date === "string" ? body.date : "";
  const option = Number(body.option);
  const prompt = cleanField(body.prompt, 2000);

  if (!isDraftId(date)) return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  if (!Number.isInteger(option) || option < 1 || option > 20)
    return NextResponse.json({ error: "invalid option" }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "no image prompt on this option" }, { status: 400 });

  const { draftsDir, repoRoot, lock, result, visualsDir } = paths();
  if (!fs.existsSync(path.join(draftsDir, `${date}.md`)))
    return NextResponse.json({ error: "draft not found" }, { status: 404 });

  const token = acquireRunLock(lock);
  if (!token) return NextResponse.json({ started: false, running: true });

  const script = path.join(repoRoot, "engine", "render-visual.mjs");
  const child = spawn(
    process.execPath,
    [script, "--draft", date, "--option", String(option), "--out-dir", visualsDir],
    {
      cwd: repoRoot,
      env: { ...process.env, SHIPPOST_RENDER_PROMPT: prompt },
      // stderr is PIPED, not ignored: the renderer's own message ("ComfyUI failed to render:
      // out of memory") is the only useful diagnosis a user gets, and it exists nowhere else -
      // .comfy.log is the ComfyUI server's log, not this child's.
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 2000) stderr += chunk.toString();
  });

  // A failed spawn emits 'error' AND then 'close' with a null code, so without this guard the
  // second call would overwrite the useful message ("spawn ENOENT") with a generic
  // "Render failed (exit null)". The lock release is already idempotent (compare-and-delete);
  // this is about keeping the diagnosis the card shows.
  let done = false;
  const finish = (ok: boolean, extra: Record<string, unknown> = {}) => {
    if (done) return;
    done = true;
    try {
      fs.writeFileSync(result, JSON.stringify({ ok, date, option, finishedAt: Date.now(), ...extra }));
    } catch {
      /* ignore */
    }
    releaseRunLock(lock, token); // compare-and-delete: never unlinks a newer run's lock
  };
  child.on("error", (err) => finish(false, { error: String(err) }));
  child.on("close", (code) => {
    // The renderer's last stderr line is the diagnosis (unreachable server, out of memory,
    // a graph ComfyUI rejected). Surfaced verbatim so the card can show it.
    const lastLine = stderr.trim().split("\n").filter(Boolean).pop();
    finish(code === 0, {
      code,
      // exit 2 is the renderer's documented "ComfyUI is not running" code, not a broken render
      ...(code === 2
        ? { error: "ComfyUI is not running. Start it with: bash engine/comfy-headless.sh" }
        : code !== 0
          ? { error: lastLine || `Render failed (exit ${code}).` }
          : {}),
    });
  });

  return NextResponse.json({ started: true, running: true, date, option });
}
