import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Expand a leading ~ to the user's home dir. */
export function expandTilde(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Find the repo root by walking up from the app dir looking for config.json
 * (or config.example.json as a fallback so the app still boots pre-config).
 * Honors SHIPPOST_CONFIG (absolute path to a config file) if set.
 */
export function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(dir, "config.json")) ||
      fs.existsSync(path.join(dir, "config.example.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume app/ is one level under the repo root.
  return path.resolve(process.cwd(), "..");
}

export function configPath(): string {
  if (process.env.SHIPPOST_CONFIG) return expandTilde(process.env.SHIPPOST_CONFIG);
  const root = findRepoRoot();
  const real = path.join(root, "config.json");
  return fs.existsSync(real) ? real : path.join(root, "config.example.json");
}
