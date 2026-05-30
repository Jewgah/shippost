import { NextResponse } from "next/server";
import { parseShares } from "@/lib/sharesCsv";
import { addRecentPosts, recentPostCount } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const { posts, column, totalRows } = parseShares(buf, file.name);
    const added = addRecentPosts(posts);
    return NextResponse.json({
      added,
      found: posts.length,
      totalRows,
      column,
      total: recentPostCount(),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 400 });
  }
}
