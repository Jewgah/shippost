import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { cleanField } from "@/lib/steering";
import { isDraftId } from "@/lib/draftId";
import { acquireRunLock, releaseRunLock, touchRunLock, STALE_MS } from "@/lib/runLock";
import {
  canStartLocally,
  clearRenderPhase,
  comfyBaseUrl,
  comfyIsUp,
  comfyLogPath,
  engineStartError,
  phaseFilePath,
  readRenderPhase,
  starterDiagnosis,
  writeRenderPhase,
  type RenderPhase,
} from "@/lib/comfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Render one option's suggested visual with the local ComfyUI. Shaped like /api/edit, with two
// deliberate differences: its own `.rendering` lock (NEVER `.generating`, which a scheduled run
// holds for minutes - a render must not be blocked by, or block, a generation), and its own
// `.last_render.json` so the card can poll this route without disturbing the generate panel.
//
// This route is ALSO the only caller allowed to start ComfyUI (engine/generate.sh must not):
// clicking "Render image" is the human decision to load a 17 GB checkpoint, a 09:13 cron job is
// not. Ending a deliberate click at "now go run a shell command" was the friction that motivated
// this; the scheduled path keeps today's behaviour exactly.
function paths() {
  const { resolved } = loadConfig();
  return {
    draftsDir: resolved.draftsDir,
    repoRoot: resolved.repoRoot,
    lock: path.join(resolved.draftsDir, ".rendering"),
    result: path.join(resolved.draftsDir, ".last_render.json"),
    visualsDir: path.join(resolved.draftsDir, ".visuals"),
    phaseFile: phaseFilePath(resolved.draftsDir),
  };
}

// One `utimes` a minute against a 15 minute staleness window: frequent enough that a heartbeat
// missed to a stalled event loop still leaves ~14 minutes of slack.
const HEARTBEAT_MS = 60_000;

export async function GET() {
  const { lock, result, phaseFile } = paths();
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
  // `phase` is additive: every existing caller reads only `running` and `lastResult`.
  return NextResponse.json({ running, lastResult, phase: readRenderPhase(phaseFile, running) });
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

  const { draftsDir, repoRoot, lock, result, visualsDir, phaseFile } = paths();
  if (!fs.existsSync(path.join(draftsDir, `${date}.md`)))
    return NextResponse.json({ error: "draft not found" }, { status: 404 });

  const token = acquireRunLock(lock);
  if (!token) return NextResponse.json({ started: false, running: true });

  // Awaited before responding: a closed port on 127.0.0.1 refuses in milliseconds, so this costs
  // nothing and lets the card's very first poll show the true phase instead of a guess.
  const base = comfyBaseUrl();
  const up = await comfyIsUp(base);

  // A configured remote engine cannot be started from here (comfy-headless.sh only ever launches
  // a LOCAL server, whatever URL it then polls), so say so instead of booting 20 GB nobody asked
  // for. Answered on the POST itself: there is nothing to poll.
  if (!up && !canStartLocally(base)) {
    releaseRunLock(lock, token);
    return NextResponse.json({
      started: false,
      running: false,
      error: `The image engine at ${base} is not answering, and it is not on this machine, so it can't be started from here.`,
    });
  }

  const phase: RenderPhase = up ? "rendering" : "starting";
  writeRenderPhase(phaseFile, phase);

  // The start (up to 3 min) and the render (up to 12 min) both sit under this ONE lock, which
  // together can outlast STALE_MS - so keep the lock's mtime fresh for as long as we are alive.
  const beat = setInterval(() => touchRunLock(lock, token), HEARTBEAT_MS);
  beat.unref?.();

  // A failed spawn emits 'error' AND then 'close' with a null code, so without this guard the
  // second call would overwrite the useful message ("spawn ENOENT") with a generic
  // "Render failed (exit null)". The lock release is already idempotent (compare-and-delete);
  // this is about keeping the diagnosis the card shows.
  let done = false;
  const finish = (ok: boolean, extra: Record<string, unknown> = {}) => {
    if (done) return;
    done = true;
    clearInterval(beat);
    clearRenderPhase(phaseFile);
    try {
      fs.writeFileSync(result, JSON.stringify({ ok, date, option, finishedAt: Date.now(), ...extra }));
    } catch {
      /* ignore */
    }
    releaseRunLock(lock, token); // compare-and-delete: never unlinks a newer run's lock
  };

  const lastLineOf = (s: string) => s.trim().split("\n").filter(Boolean).pop();

  const startRender = () => {
    const script = path.join(repoRoot, "engine", "render-visual.mjs");
    const child = spawn(
      process.execPath,
      [script, "--draft", date, "--option", String(option), "--out-dir", visualsDir],
      {
        cwd: repoRoot,
        // SHIPPOST_COMFY_URL is passed explicitly: the renderer resolves it from URL alone, so
        // with only SHIPPOST_COMFY_PORT set it would otherwise probe a different port than the
        // one this route just probed and started.
        env: { ...process.env, SHIPPOST_RENDER_PROMPT: prompt, SHIPPOST_COMFY_URL: base },
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
    child.on("error", (err) => finish(false, { error: String(err) }));
    child.on("close", (code) => {
      // The renderer's last stderr line is the diagnosis (unreachable server, out of memory,
      // a graph ComfyUI rejected). Surfaced verbatim so the card can show it.
      finish(code === 0, {
        code,
        // exit 2 can no longer mean "you forgot to start it" - we just started it, or it
        // answered a moment ago - so it now reads as the server having gone away mid-run.
        ...(code === 2
          ? { error: `The image engine stopped answering at ${base}. See ${comfyLogPath(draftsDir)}` }
          : code !== 0
            ? { error: lastLineOf(stderr) || `Render failed (exit ${code}).` }
            : {}),
      });
    });
  };

  if (up) {
    startRender();
  } else {
    // comfy-headless.sh is idempotent, polls /system_stats and exits 0 only once the server
    // answers (1 on failure, 180 s cap), so waiting for it IS waiting for a usable engine.
    // Its own nohup'd child redirects both its streams into .comfy.log, so it does not hold this
    // pipe open and 'close' fires as soon as the script itself exits.
    // Nothing cancels this from the browser side: closing the tab leaves the start running to
    // its own 180 s cap, still holding the lock. That is deliberate - the engine the click asked
    // for comes up, and the next click finds it already there.
    const starter = spawn("bash", [path.join(repoRoot, "engine", "comfy-headless.sh")], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let startErr = "";
    starter.stderr?.on("data", (chunk: Buffer) => {
      if (startErr.length < 2000) startErr += chunk.toString();
    });
    // The log is only named when it exists: the likeliest failure (no ComfyUI venv) exits before
    // the script creates it, and pointing someone at a file that is not there wastes their time.
    const logIfWritten = () => (fs.existsSync(comfyLogPath(draftsDir)) ? comfyLogPath(draftsDir) : null);
    starter.on("error", (err) => finish(false, { error: engineStartError(String(err), logIfWritten()) }));
    starter.on("close", (code) => {
      if (done) return;
      if (code !== 0) {
        // No render is attempted: without an engine it would only burn a spawn to exit 2.
        finish(false, { code, error: engineStartError(starterDiagnosis(startErr), logIfWritten()) });
        return;
      }
      writeRenderPhase(phaseFile, "rendering");
      startRender();
    });
  }

  return NextResponse.json({ started: true, running: true, phase, date, option });
}
