import { NextResponse } from "next/server";
import { listDrafts } from "@/lib/drafts";
import { resolveChannel } from "@/lib/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const channel = resolveChannel(new URL(req.url).searchParams.get("channel"));
    if (!channel) return NextResponse.json({ error: "unknown channel" }, { status: 400 });
    return NextResponse.json({ drafts: listDrafts(undefined, channel) });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
