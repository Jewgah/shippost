import { NextResponse } from "next/server";
import { recordPick } from "@/lib/voice";
import { blockCrossSite } from "@/lib/guard";
import { isDraftId } from "@/lib/draftId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const b = await req.json();
    if (!b?.date || typeof b?.option !== "number" || !b?.companyPost) {
      return NextResponse.json({ error: "date, option, companyPost required" }, { status: 400 });
    }
    // Same shape check as /api/reject and /api/edit — the date is the exact-id join key for
    // cadence + posted badges, so garbage here would silently corrupt the picks log.
    if (!isDraftId(b.date)) {
      return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
    }
    recordPick({
      date: b.date,
      option: b.option,
      pillar: b.pillar ?? "",
      topic: b.topic ?? "",
      companyPost: b.companyPost,
      repostCaption: b.repostCaption,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
