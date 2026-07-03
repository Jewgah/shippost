import { NextResponse } from "next/server";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stops the dev server from the UI so it never lingers in the background unnoticed.
export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  // Let the response flush, then exit. ponytail: process.exit is the whole mechanism —
  // `next dev` has no supervisor, so exiting ends it (and the npm parent with it).
  setTimeout(() => process.exit(0), 300);
  return NextResponse.json({ ok: true });
}
