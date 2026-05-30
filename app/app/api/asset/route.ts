import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";

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

// Streams the configured brand logo only — never an arbitrary path.
export async function GET(req: Request) {
  const which = new URL(req.url).searchParams.get("which");
  if (which !== "logo") return NextResponse.json({ error: "unknown asset" }, { status: 400 });

  const { brand } = loadConfig();
  if (!brand.logoPath || !fs.existsSync(brand.logoPath)) {
    return NextResponse.json({ error: "no logo configured" }, { status: 404 });
  }
  const ext = path.extname(brand.logoPath).toLowerCase();
  const data = fs.readFileSync(brand.logoPath);
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
  });
}
