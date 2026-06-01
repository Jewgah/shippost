import { NextResponse } from "next/server";
import { listFolders } from "@/lib/projects";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Browse local folders for the "add a project" picker. Guarded against cross-site reads so a random
// page the user visits can't enumerate their filesystem through the localhost app.
export async function GET(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const path = new URL(req.url).searchParams.get("path") || undefined;
    return NextResponse.json(listFolders(path));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
