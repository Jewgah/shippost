import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { isDraftId } from "@/lib/draftId";
import { effectiveLogoPath, uploadedAvatarPath } from "@/lib/settings";
import { cardPath, isQueueId, variantImagePath } from "@/lib/linkedinQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
};

/**
 * A per-option asset: `<draftsDir>/.visuals/<draftId>-o<N>.<ext>` - the rendered hero (`png`)
 * or the built carousel (`pdf`).
 * The filename is BUILT from a validated draft id, a clamped integer and an extension this
 * file chooses - the caller never supplies a path fragment, so no traversal is possible even
 * with a hostile query string.
 */
function optionAssetPath(date: string | null, option: string | null, ext: "png" | "pdf"): string | null {
  if (!date || !isDraftId(date)) return null;
  const n = Number(option);
  if (!Number.isInteger(n) || n < 1 || n > 20) return null;
  const { resolved } = loadConfig();
  return path.join(resolved.draftsDir, ".visuals", `${date}-o${n}.${ext}`);
}

// Streams the brand logo (uploaded one wins over config), the author avatar, a rendered
// option visual, a built carousel PDF, or a queued post's candidate image. Only these known assets - never an arbitrary path.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const which = params.get("which");
  let file: string | null = null;
  if (which === "logo") file = effectiveLogoPath();
  else if (which === "avatar") file = uploadedAvatarPath();
  else if (which === "visual" || which === "carousel") {
    file = optionAssetPath(params.get("date"), params.get("option"), which === "visual" ? "png" : "pdf");
    if (!file) return NextResponse.json({ error: "invalid draft id or option" }, { status: 400 });
  } else if (which === "card") {
    // A queued post's comment card: built from a validated queue id and one of two kinds.
    const id = params.get("id");
    const kind = params.get("kind");
    if (!isQueueId(id) || (kind !== "post" && kind !== "repost")) return NextResponse.json({ error: "invalid queue id or card" }, { status: 400 });
    file = cardPath(id, kind);
  } else if (which === "queue") {
    // A queued post's candidate: built from a validated queue id and an integer 1-3 (images), 4 (the clip) or 5 (your video).
    // `&channel=x` reads the X queue's candidates (x/.visuals); anything else is LinkedIn's.
    const id = params.get("id");
    const v = Number(params.get("v"));
    if (!isQueueId(id) || !Number.isInteger(v) || v < 1 || v > 5)
      return NextResponse.json({ error: "invalid queue id or image" }, { status: 400 });
    file = variantImagePath(id, v, params.get("channel") === "x" ? "x" : "linkedin");
  } else return NextResponse.json({ error: "unknown asset" }, { status: 400 });

  if (!file || !fs.existsSync(file)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  // Safari will not play a <video> unless the server answers byte ranges.
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
    if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
    return new NextResponse(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
  });
}
