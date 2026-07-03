import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { STALE_MS } from "@/lib/runLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stops the dev server from the UI so it never lingers in the background unnoticed.
export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  // Refuse while an engine run is live: process.exit would orphan the spawned
  // `claude -p` child (it survives the server) and leave the lock behind.
  try {
    const lock = path.join(loadConfig().resolved.draftsDir, ".generating");
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < STALE_MS) {
      return NextResponse.json(
        { error: "A generation is still running — wait for it to finish before quitting." },
        { status: 409 }
      );
    }
  } catch {
    /* can't read the lock — nothing provably running, allow the quit */
  }

  // Let the response flush, then exit. ponytail: process.exit is the whole mechanism —
  // `next dev` has no supervisor, so exiting ends it (and the npm parent with it).
  setTimeout(() => process.exit(0), 300);
  return NextResponse.json({ ok: true });
}
