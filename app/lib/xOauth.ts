// OAuth 1.0a user-context signing for the X API (RFC 5849, HMAC-SHA1). Pure: no I/O, no clock
// unless the caller leaves out `nonce` / `timestamp`. Imported by app/scripts/x-post.mjs through
// Node's type stripping, so this file uses erasable TypeScript only (types and interfaces).
//
// What enters the signature base (RFC 5849 3.4.1.3): the query string of the URL and the
// form-encoded body params passed in `params`. A JSON body (POST /2/tweets) and a multipart body
// (a media APPEND) are NOT signed: the caller passes no `params` for those.
import crypto from "node:crypto";

export interface XKeys {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 percent-encoding: encodeURIComponent plus the five characters it leaves alone. */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The signature base string: METHOD&base-url&sorted-params, each part percent-encoded. */
export function signatureBase(method: string, url: string, params: Record<string, string>): string {
  const u = new URL(url);
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) pairs.push([percentEncode(k), percentEncode(v)]);
  for (const [k, v] of Object.entries(params)) pairs.push([percentEncode(k), percentEncode(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  // URL lowercases the scheme and host and drops a default port, as 3.4.1.2 asks.
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join("&");
}

/** HMAC-SHA1 of the base string, keyed by the two secrets, base64. */
export function oauth1Signature(base: string, apiSecret: string, accessSecret: string): string {
  return crypto.createHmac("sha1", `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`).update(base).digest("base64");
}

/**
 * The `Authorization` header value for one request. `params` holds the form-encoded body params
 * (none for JSON or multipart); the URL's own query string is read from `url`.
 */
export function oauth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  keys: XKeys,
  fixed: { nonce?: string; timestamp?: string } = {}
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: fixed.nonce ?? crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const signature = oauth1Signature(signatureBase(method, url, { ...params, ...oauth }), keys.apiSecret, keys.accessSecret);
  const all: Record<string, string> = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(all)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(all[k])}"`)
      .join(", ")
  );
}
