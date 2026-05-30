import { NextResponse } from "next/server";
import { markOnboarded } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    markOnboarded();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
