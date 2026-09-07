import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Everything /api/render needs to know about the local ComfyUI: where it is, whether it answers,
 * and which phase of a run the card should be showing.
 *
 * The asymmetry this module exists to serve: a SCHEDULED run (engine/generate.sh) never starts
 * ComfyUI - loading a 17 GB checkpoint that expands to ~24 GB resident is not a decision a 09:13
 * cron job makes on a machine that may be asleep. A human clicking "Render image" HAS made that
 * decision, so the route may start it.
 */

export const COMFY_DEFAULT_URL = "http://127.0.0.1:8188";

/** "starting" = bringing ComfyUI up; "rendering" = the renderer child is running. */
export type RenderPhase = "starting" | "rendering";

/**
 * Resolve the base URL the way engine/comfy-headless.sh does: SHIPPOST_COMFY_URL wins, else
 * 127.0.0.1 on SHIPPOST_COMFY_PORT, else the default.
 *
 * engine/render-visual.mjs reads SHIPPOST_COMFY_URL only, so with just a PORT set it would probe
 * 8188 while the script brought a server up elsewhere: the route would start an engine, flip the
 * card to "rendering", and the renderer would exit 2 against the wrong port. The route therefore
 * resolves the URL itself and hands it to the renderer as SHIPPOST_COMFY_URL, which makes all
 * three agree without changing the shell script's contract.
 */
export function comfyBaseUrl(env: Record<string, string | undefined> = process.env): string {
  // Trailing slashes are stripped HERE, not at one use site: this value is also handed to the
  // renderer child as SHIPPOST_COMFY_URL and interpolated into error text, and a configured
  // "http://127.0.0.1:8188/" would otherwise have the child requesting "//system_stats".
  const url = (env.SHIPPOST_COMFY_URL ?? "").trim().replace(/\/+$/, "");
  if (url) return url;
  const port = (env.SHIPPOST_COMFY_PORT ?? "").trim();
  return /^\d+$/.test(port) ? `http://127.0.0.1:${port}` : COMFY_DEFAULT_URL;
}

/** ComfyUI's cheapest liveness endpoint. */
export function comfyProbeUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/system_stats`;
}

/**
 * May the route start this base URL itself?
 *
 * engine/comfy-headless.sh always launches `main.py --listen 127.0.0.1` locally, but polls
 * whatever SHIPPOST_COMFY_URL says. Point that at another machine and asking the script to start
 * it boots a LOCAL ~20 GB server nobody asked for, waits out the full 180 s against a host that
 * was never going to answer, and reports failure while leaving that server resident. So a base
 * that is not on this machine is reported as unreachable instead of started.
 */
export function canStartLocally(base: string): boolean {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"].includes(host);
  } catch {
    return false; // not a URL we can reason about - do not launch anything on its behalf
  }
}

/** The log engine/comfy-headless.sh appends to ($CFG_OUTPUT_DIR is output.draftsDir). */
export function comfyLogPath(draftsDir: string): string {
  return path.join(draftsDir, ".comfy.log");
}

/**
 * Pull the diagnosis out of comfy-headless.sh's stderr. NOT the last line: the no-venv failure
 * (much the likeliest one) prints the cause first and a generic "Install ComfyUI … or set
 * SHIPPOST_COMFY_DIR." hint second, so the renderer's last-line convention would show the hint
 * and hide the path. Every message the script raises itself is `shippost:`-prefixed.
 */
export function starterDiagnosis(stderr: string): string | null {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.find((l) => l.startsWith("shippost:")) ?? lines[0] ?? null;
}

/**
 * The message the card shows when the engine could not be started.
 *
 * `logPath` is null when there is no log to read: the no-venv path exits before the script ever
 * runs `mkdir -p` on the drafts dir or redirects anything into .comfy.log, so naming the file
 * there would send someone after a file that does not exist. The caller checks.
 */
export function engineStartError(detail?: string | null, logPath?: string | null): string {
  // The script's own lines carry no closing punctuation, so add one: without it the message runs
  // "…/venv/bin/python See /…/.comfy.log" and the two paths read as one.
  const d = (detail ?? "").trim().replace(/\.+$/, "");
  const head = `Couldn't start the image engine${d ? `: ${d}` : ""}.`;
  return logPath ? `${head} See ${logPath}` : head;
}

/** Where the current run publishes its phase for the GET poller. */
export function phaseFilePath(draftsDir: string): string {
  return path.join(draftsDir, ".render_phase");
}

export function writeRenderPhase(phaseFile: string, phase: RenderPhase): void {
  try {
    fs.writeFileSync(phaseFile, phase, "utf8");
  } catch {
    /* the phase is a progress hint, never a correctness input - losing it degrades to a spinner */
  }
}

export function clearRenderPhase(phaseFile: string): void {
  try {
    fs.unlinkSync(phaseFile);
  } catch {
    /* already gone */
  }
}

/**
 * Read the phase, but only while a run actually holds the lock: a phase file left behind by a
 * killed run would otherwise make the card claim "starting" forever. `running` comes from the
 * same freshness check the GET already does, so the lock stays the single source of truth.
 */
export function readRenderPhase(phaseFile: string, running: boolean): RenderPhase | null {
  if (!running) return null;
  try {
    const v = fs.readFileSync(phaseFile, "utf8").trim();
    return v === "starting" || v === "rendering" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Is ComfyUI answering? Same shape as the renderer's own probe. A closed port on 127.0.0.1
 * refuses immediately, so this is cheap enough to await before responding to the POST - which is
 * what lets the very first poll show the true phase instead of guessing.
 */
export async function comfyIsUp(base: string = comfyBaseUrl(), timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(comfyProbeUrl(base), { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
