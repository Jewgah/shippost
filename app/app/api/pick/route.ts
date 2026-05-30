import { NextResponse } from "next/server";
import { recordPick } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b?.date || typeof b?.option !== "number" || !b?.companyPost) {
      return NextResponse.json({ error: "date, option, companyPost required" }, { status: 400 });
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
