import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

/** A detached child whose output goes to a log file: a dev-server restart must not kill it. */
export function spawnDetached(script: string, args: string[], logFile: string, env: NodeJS.ProcessEnv = process.env) {
  const { repoRoot } = loadConfig().resolved;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "a");
  spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], {
    cwd: repoRoot,
    detached: true,
    env,
    stdio: ["ignore", out, out],
  }).unref();
  fs.closeSync(out);
}
