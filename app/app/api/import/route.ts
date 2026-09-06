import { NextResponse } from "next/server";
import { parseShares } from "@/lib/sharesCsv";
import { addRecentPosts, looksLikePost, recentPostCount } from "@/lib/voice";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXCERPT_CHARS = 280;
const excerpt = (s: string) => (s.length > EXCERPT_CHARS ? s.slice(0, EXCERPT_CHARS).trimEnd() + "…" : s);

// Two modes on one route:
//  - preview (form field `preview=1`): parse the file and report what WOULD be imported
//    (detected column, counts, the two most recent posts) without writing anything;
//  - default: parse and write, as before.
// The UI always previews first and only writes after the user confirms the sample is theirs:
// a wrong file (LinkedIn's messages.csv, once) is far cheaper to catch on screen than in the
// voice corpus.
export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const preview = form.get("preview") === "1";
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const { posts, column, totalRows } = parseShares(buf, file.name);
    const usable = posts.filter(looksLikePost);
    if (preview) {
      return NextResponse.json({
        preview: true,
        column,
        totalRows,
        found: posts.length,
        usable: usable.length,
        sample: usable.slice(-2).reverse().map(excerpt), // posts are oldest->newest; show the 2 newest
      });
    }
    const added = addRecentPosts(posts);
    return NextResponse.json({
      added,
      found: posts.length,
      skipped: posts.length - usable.length,
      totalRows,
      column,
      total: recentPostCount(),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 400 });
  }
}
