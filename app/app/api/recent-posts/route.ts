import { NextResponse } from "next/server";
import { addRecentPosts, recentPostCount } from "@/lib/voice";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const text: string = body?.text ?? "";
    // Accept either one post or several separated by blank-line + --- + blank-line.
    const posts = text
      .split(/\n\s*-{3,}\s*\n/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    const list = posts.length ? posts : text.trim() ? [text.trim()] : [];
    const added = addRecentPosts(list);
    return NextResponse.json({ added, total: recentPostCount() });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
