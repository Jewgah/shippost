import "server-only";
import fs from "node:fs";

// One engine run at a time. The `.generating` lock file is shared by /api/generate and
// /api/edit; acquisition is atomic (O_EXCL create), so two near-simultaneous POSTs can't
// both pass a check-then-write and spawn overlapping `claude -p` runs. The lock's content
// is an owner token: release is compare-and-delete, so a run that outlived the stale
// threshold can't unlink the lock a NEWER run now holds.

export const STALE_MS = 15 * 60 * 1000; // a lock older than this is a dead run (well beyond a real ~1-5min run)

/**
 * Atomically take the run lock. Returns the owner token to release with, or null if a live
 * run already holds it. Non-EEXIST failures (EACCES, ENOSPC, missing dir) throw — they must
 * surface as a real error, not read as "already running" forever.
 */
export function acquireRunLock(lock: string): string | null {
  const token = `${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const tryCreate = () => {
    try {
      fs.writeFileSync(lock, token, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      return false;
    }
  };
  if (tryCreate()) return token;
  // Lock exists — steal it only if stale (the run died without cleaning up).
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < STALE_MS) return null;
    fs.unlinkSync(lock);
  } catch {
    /* raced with the other run's cleanup — retry the create below */
  }
  return tryCreate() ? token : null;
}

/** Release the lock only if we still own it (a staler run must not delete a newer run's lock). */
export function releaseRunLock(lock: string, token: string): void {
  try {
    if (fs.readFileSync(lock, "utf8") === token) fs.unlinkSync(lock);
  } catch {
    /* already gone */
  }
}
