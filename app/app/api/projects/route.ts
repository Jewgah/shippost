import { NextResponse } from "next/server";
import { addProjectToAllowlist } from "@/lib/projects";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Add a folder to the mineable allowlist (engine/postable-projects.txt). Validation + the
// client-work boundary live in addProjectToAllowlist; a refusal comes back as ok:false + 400.
export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const b = (await req.json().catch(() => ({}))) as { path?: unknown };
    const res = addProjectToAllowlist(typeof b?.path === "string" ? b.path : "");
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
