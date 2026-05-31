import { NextResponse } from "next/server";

/**
 * Blocks drive-by cross-site requests (CSRF) to mutating routes.
 *
 * Modern browsers always send `Sec-Fetch-Site`, and a cross-origin page CANNOT
 * forge it to "same-origin" — so this stops a malicious page the user visits from
 * POSTing to localhost. Non-browser clients (curl, no header) don't send it and
 * aren't a CSRF vector, so we allow when the header is absent. We also allow
 * "none" (user typed the URL / bookmark).
 *
 * Returns a 403 NextResponse to short-circuit, or null to proceed.
 */
export function blockCrossSite(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "forbidden (cross-site request)" }, { status: 403 });
  }
  return null;
}
