import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
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
};

// Streams the brand logo (uploaded one wins over config) or the author avatar.
// Only these two known assets — never an arbitrary path.
export async function GET(req: Request) {
  const which = new URL(req.url).searchParams.get("which");
  let file: string | null = null;
  if (which === "logo") file = effectiveLogoPath();
  else if (which === "avatar") file = uploadedAvatarPath();
  else return NextResponse.json({ error: "unknown asset" }, { status: 400 });

  if (!file || !fs.existsSync(file)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" },
  });
}
