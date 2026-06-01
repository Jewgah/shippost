import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accepts a brand logo or personal avatar and writes it into the drafts dir.
const TYPE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};
const STEMS: Record<string, string> = { logo: ".brand-logo", avatar: ".author-avatar" };
const ALL_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form" }, { status: 400 });
  }
  const which = String(form.get("which") || "");
  const stem = STEMS[which];
  if (!stem) return NextResponse.json({ error: "unknown asset (logo|avatar)" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "file too large (max 5 MB)" }, { status: 413 });
  const ext = TYPE_EXT[file.type];
  if (!ext) return NextResponse.json({ error: "unsupported type (png, jpg, webp, gif, svg)" }, { status: 415 });

  const { resolved } = loadConfig();
  fs.mkdirSync(resolved.draftsDir, { recursive: true });
  // Drop any prior upload for this stem (any extension) so there's exactly one.
  for (const e of ALL_EXTS) {
    const p = path.join(resolved.draftsDir, stem + e);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(resolved.draftsDir, stem + ext), new Uint8Array(buf));
  return NextResponse.json({ ok: true, which });
}
