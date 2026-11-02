import { NextResponse } from "next/server";
import { readDraft, deleteDraft, deleteOption } from "@/lib/drafts";
import { blockCrossSite } from "@/lib/guard";
import { isDraftId } from "@/lib/draftId";
import { resolveChannel } from "@/lib/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  try {
    const { date } = await params;
    const channel = resolveChannel(new URL(req.url).searchParams.get("channel"));
    if (!channel) return NextResponse.json({ error: "unknown channel" }, { status: 400 });
    const draft = readDraft(date, channel);
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}

// DELETE with no body removes the whole draft package; DELETE with a `{ option: n }` body removes
// just that one option (and deletes the package too if it was the last one standing).
export async function DELETE(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const { date } = await params;
    if (!isDraftId(date)) return NextResponse.json({ error: "invalid draft id" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { option?: unknown; channel?: unknown };
    const channel = resolveChannel(body?.channel ?? new URL(req.url).searchParams.get("channel"));
    if (!channel) return NextResponse.json({ error: "unknown channel" }, { status: 400 });
    if (typeof body?.option === "number") {
      const res = deleteOption(date, body.option, channel);
      if (!res) return NextResponse.json({ error: "option not found" }, { status: 404 });
      return NextResponse.json({ ok: true, ...res });
    }

    if (!deleteDraft(date, channel)) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, draftDeleted: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
