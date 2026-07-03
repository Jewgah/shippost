import "server-only";
import fs from "node:fs";

// One engine run at a time. The `.generating` lock file is shared by /api/generate and
// /api/edit; acquisition is atomic (O_EXCL create), so two near-simultaneous POSTs can't
// both pass a check-then-write and spawn overlapping `claude -p` runs.

export const STALE_MS = 15 * 60 * 1000; // a lock older than this is a dead run (well beyond a real ~1-5min run)

/** Atomically take the run lock. Returns false if a live run already holds it. */
export function acquireRunLock(lock: string): boolean {
  const tryCreate = () => {
    try {
      fs.writeFileSync(lock, String(Date.now()), { encoding: "utf8", flag: "wx" });
      return true;
    } catch {
      return false;
    }
  };
  if (tryCreate()) return true;
  // Lock exists — steal it only if stale (the run died without cleaning up).
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < STALE_MS) return false;
    fs.unlinkSync(lock);
  } catch {
    /* raced with the other run's cleanup — retry the create below */
  }
  return tryCreate();
}
