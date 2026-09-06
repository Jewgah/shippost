import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { isDraftId } from "@/lib/draftId";
import { effectiveLogoPath, uploadedAvatarPath } from "@/lib/settings";

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
// option visual, or a built carousel PDF. Only these known assets - never an arbitrary path.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const which = params.get("which");
  let file: string | null = null;
  if (which === "logo") file = effectiveLogoPath();
  else if (which === "avatar") file = uploadedAvatarPath();
  else if (which === "visual" || which === "carousel") {
    file = optionAssetPath(params.get("date"), params.get("option"), which === "visual" ? "png" : "pdf");
    if (!file) return NextResponse.json({ error: "invalid draft id or option" }, { status: 400 });
  } else return NextResponse.json({ error: "unknown asset" }, { status: 400 });

  if (!file || !fs.existsSync(file)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" },
  });
}
