import { NextResponse } from "next/server";
import { recordReject } from "@/lib/voice";
import { blockCrossSite } from "@/lib/guard";
import { isDraftId } from "@/lib/draftId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const b = await req.json();
    if (!b?.date || !isDraftId(b.date) || typeof b?.option !== "number") {
      return NextResponse.json({ error: "valid draft date and numeric option required" }, { status: 400 });
    }
    recordReject({
      date: b.date,
      option: b.option,
      pillar: b.pillar ?? "",
      topic: b.topic ?? "",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
