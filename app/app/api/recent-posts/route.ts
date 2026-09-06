import { NextResponse } from "next/server";
import { addRecentPosts, looksLikePost, recentPostCount } from "@/lib/voice";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const text: string = body?.text ?? "";
    if (text.length > 1_000_000) {
      return NextResponse.json({ error: "too much text (max ~1 MB)" }, { status: 413 });
    }
    // Accept either one post or several separated by blank-line + --- + blank-line.
    const posts = text
      .split(/\n\s*-{3,}\s*\n/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    const list = posts.length ? posts : text.trim() ? [text.trim()] : [];
    const added = addRecentPosts(list);
    // Blocks that fail the post filter (too short, HTML, merge tokens) are dropped by
    // addRecentPosts; say how many so a paste never reads as a silent "added 0".
    const skipped = list.filter((p: string) => !looksLikePost(p)).length;
    return NextResponse.json({ added, skipped, total: recentPostCount() });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
