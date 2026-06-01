// Pure helpers for the generation-steering feature, extracted from the API routes
// so the routes and the unit tests share ONE implementation. No node/server-only
// imports here — keep it pure and trivially testable. Paths are absolute POSIX
// (this is a macOS-local app), so "/" is the separator.

/** Strip control chars, collapse whitespace, cap length. undefined if empty/non-string. */
export function cleanField(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || undefined;
}

const lc = (s: string) => s.toLowerCase();

/** True only if `p` is `root` itself or sits strictly under it (the trailing "/"
 *  prevents sibling-prefix false matches, e.g. ".../Projects-Archive" vs ".../Projects"). */
export function isUnderRoot(p: string, root: string): boolean {
  return p === root || p.startsWith(root + "/");
}

/** A path is sensitive (client / day-job work) if it sits under the client-repos
 *  root, or its path contains any configured client name (case-insensitive). */
export function isSensitivePath(cwd: string, clientReposRoot: string, clientNames: string[]): boolean {
  if (clientReposRoot && isUnderRoot(cwd, clientReposRoot)) return true;
  return clientNames.some((c) => c && lc(cwd).includes(lc(c)));
}

/** Whether a recent-session cwd may be surfaced as a project suggestion: it must
 *  live under the safe projects root AND not be sensitive client work. This is the
 *  load-bearing client-data boundary — both gates must pass to surface a project. */
export function shouldSurfaceRecent(
  cwd: string,
  opts: { projectsRoot: string; clientReposRoot: string; clientNames: string[] }
): boolean {
  return isUnderRoot(cwd, opts.projectsRoot) && !isSensitivePath(cwd, opts.clientReposRoot, opts.clientNames);
}
