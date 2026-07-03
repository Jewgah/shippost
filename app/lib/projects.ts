import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configPath, expandTilde } from "./paths";
import { loadConfig } from "./config";
import { isSensitivePath } from "./steering";

// Managing engine/postable-projects.txt — the ONLY repos shippost may mine — from the app:
// browse the local filesystem and add a folder to the allowlist. macOS-local, so paths are
// absolute POSIX ("/" separators).

export interface FolderEntry {
  name: string;
  path: string; // absolute
  isGit: boolean;
  inAllowlist: boolean;
  sensitive: boolean; // client / day-job work — never mineable, so the UI blocks adding it
}

export interface FolderListing {
  path: string; // absolute dir being listed
  parent: string | null; // absolute parent, or null at the home-dir ceiling
  home: string;
  entries: FolderEntry[];
}

export interface AddResult {
  ok: boolean;
  name?: string;
  added?: string; // the line written to the allowlist (tilde form when under home)
  alreadyListed?: boolean;
  warning?: string; // non-fatal note (e.g. added, but not a git repo yet)
  error?: string;
}

/** Collapse an absolute path under `home` back to ~ form, matching how the allowlist is
 *  hand-written (`~/Desktop/Projects/foo`). Pure — `home` is injected — so it's testable. */
export function tildeCollapse(abs: string, home: string): string {
  const h = home.replace(/\/+$/, "");
  if (abs === h) return "~";
  if (abs.startsWith(h + "/")) return "~" + abs.slice(h.length);
  return abs;
}

// Client/day-job signals, read raw from config (the typed loader doesn't expose dayJob/scrub).
// These feed the SAME isSensitivePath boundary the steering suggestions use.
function clientSignals(): { clientReposRoot: string; clientNames: string[] } {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const dayJob = (raw.dayJob ?? {}) as { clientReposRoot?: string };
    const scrub = (raw.scrub ?? {}) as { clientNames?: string[] };
    return {
      clientReposRoot: expandTilde(dayJob.clientReposRoot ?? ""),
      clientNames: Array.isArray(scrub.clientNames) ? scrub.clientNames : [],
    };
  } catch {
    return { clientReposRoot: "", clientNames: [] };
  }
}

/** The root the folder browser opens at and /api/suggestions treats as "your projects live here".
 *  Configurable via app.projectsRoot (read raw + try/catch so a missing config.json — e.g. in
 *  tests/CI — degrades to the default instead of throwing). */
export function projectsRoot(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const p = (raw.app ?? {}).projectsRoot;
    if (typeof p === "string" && p.trim()) return path.resolve(expandTilde(p.trim()));
  } catch {
    /* default below */
  }
  return path.join(os.homedir(), "Desktop", "Projects");
}

// Where the allowlist lives. SHIPPOST_ALLOWLIST overrides it (tests point this at a temp file so
// they never touch the real engine/postable-projects.txt); otherwise it's repoRoot + the configured
// relative path, the same resolution /api/suggestions uses.
function allowlistFile(): string {
  if (process.env.SHIPPOST_ALLOWLIST) return expandTilde(process.env.SHIPPOST_ALLOWLIST);
  const { resolved } = loadConfig();
  let rel = "engine/postable-projects.txt";
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    if (raw?.harvest?.repoAllowlistFile) rel = String(raw.harvest.repoAllowlistFile);
  } catch {
    /* default */
  }
  return path.join(resolved.repoRoot, rel);
}

/** Absolute, resolved paths currently in the allowlist (comments + blanks dropped). */
function allowlistResolved(): Set<string> {
  try {
    return new Set(
      fs
        .readFileSync(allowlistFile(), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => path.resolve(expandTilde(l)))
    );
  } catch {
    return new Set();
  }
}

/**
 * List the sub-folders of `target` (defaulting to the configured projects root, else home),
 * clamped so the browser can never climb above the home dir. Each entry says whether it's a git
 * repo, already on the allowlist, or sensitive client work (which the UI must not let you add).
 */
export function listFolders(target?: string): FolderListing {
  const home = os.homedir();
  const root = projectsRoot();
  const under = (d: string, base: string) => d === base || d.startsWith(base + "/");
  let dir = target ? path.resolve(expandTilde(target)) : "";
  if (!dir) {
    dir = fs.existsSync(root) ? root : home;
  }
  // Never browse outside home — except under an explicitly configured projects root
  // (which may live outside home, e.g. an external volume; suggestions honor it too).
  if (!under(dir, home) && !under(dir, root)) dir = home;

  const allow = allowlistResolved();
  const { clientReposRoot, clientNames } = clientSignals();

  const entries: FolderEntry[] = [];
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue; // hide dotfolders (.git, .Trash, …)
      const p = path.join(dir, d.name);
      entries.push({
        name: d.name,
        path: p,
        isGit: fs.existsSync(path.join(p, ".git")),
        inAllowlist: allow.has(path.resolve(p)),
        sensitive: isSensitivePath(p, clientReposRoot, clientNames),
      });
    }
  } catch {
    /* unreadable dir → empty list */
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // Ceiling: home, or the configured root itself when it lives outside home.
  const atCeiling = dir === home || (dir === root && !under(root, home));
  return { path: dir, parent: atCeiling ? null : path.dirname(dir), home, entries };
}

/**
 * Add a folder to the mineable allowlist. Refuses anything that doesn't exist, isn't a folder, or
 * trips the client-work boundary (under the day-job repos root or matching a scrub name) — there's
 * no in-app remove, so the safe default is to never let client repos in. Adding a non-git folder
 * succeeds but warns (nothing to mine until it has commits). Idempotent: re-adding is a no-op.
 */
export function addProjectToAllowlist(folderPath: string): AddResult {
  const home = os.homedir();
  if (!folderPath || typeof folderPath !== "string") return { ok: false, error: "A folder path is required." };
  const abs = path.resolve(expandTilde(folderPath));

  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(abs);
  } catch {
    /* missing */
  }
  if (!st) return { ok: false, error: "That folder doesn't exist." };
  if (!st.isDirectory()) return { ok: false, error: "That path isn't a folder." };

  const { clientReposRoot, clientNames } = clientSignals();
  if (isSensitivePath(abs, clientReposRoot, clientNames)) {
    return {
      ok: false,
      error: "That looks like client / day-job work — shippost only mines your own repos, so it can't be added.",
    };
  }

  if (allowlistResolved().has(abs)) {
    return { ok: true, alreadyListed: true, name: path.basename(abs), added: tildeCollapse(abs, home) };
  }

  const line = tildeCollapse(abs, home);
  const file = allowlistFile();
  let base = "";
  try {
    base = fs.readFileSync(file, "utf8");
  } catch {
    /* file may not exist yet — we'll create it */
  }
  const trimmed = base.replace(/\s*$/, "");
  const next = (trimmed ? trimmed + "\n" : "") + line + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, "utf8");

  const warning = fs.existsSync(path.join(abs, ".git"))
    ? undefined
    : "Added — but this folder isn't a git repo yet, so there's nothing to mine until it has commits.";
  return { ok: true, name: path.basename(abs), added: line, warning };
}
