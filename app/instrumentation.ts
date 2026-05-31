// Runs once when the Next server boots. If a previous run was killed mid-flight
// (Ctrl-C, crash), the `.generating` lock can linger and show a stuck spinner for
// up to STALE_MS. Clearing it on boot makes a restart recover instantly — safe,
// because the generation child process does not survive the server it was spawned by.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { loadConfig } = await import("@/lib/config");
    const lock = path.join(loadConfig().resolved.draftsDir, ".generating");
    if (fs.existsSync(lock)) {
      fs.unlinkSync(lock);
      console.log("[shippost] cleared a stale .generating lock on boot");
    }
  } catch {
    /* best-effort — never block startup */
  }
}
