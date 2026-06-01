import { NextResponse } from "next/server";
import { blockCrossSite } from "@/lib/guard";
import { readSettings, writeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ignore — nothing to patch */
  }
  const patch: Partial<{ companyMode: boolean }> = {};
  if (typeof body.companyMode === "boolean") patch.companyMode = body.companyMode;
  return NextResponse.json(writeSettings(patch));
}
