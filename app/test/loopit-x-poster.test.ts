import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Acceptance check (loopit starry-scribbling-bear-2): app/scripts/x-post.mjs --job <id> posts ONE
// queued X item through the X API: the media first, then the post, each thread post as a reply to
// the previous one, the link reply last, every id saved as it lands so a retry never re-posts.
//
// NEVER a real network call: the script runs with a preload that replaces global fetch with a fake
// X (only x.com / twitter.com hosts answer, everything else throws), disables node:http(s), and
// points any env proxy at a dead local port. HOME is a temp dir, so the real keys file is never read.

const script = path.resolve(__dirname, "..", "scripts", "x-post.mjs");
const DRAFT = "2031-03-01_120000";
const KEYS = {
  apiKey: "test-consumer-key-0001",
  apiSecret: "test-consumer-secret-SHOULD-NEVER-PRINT",
  accessToken: "100-test-access-token-0001",
  accessSecret: "test-access-secret-SHOULD-NEVER-PRINT",
};

const FAKE_X = String.raw`
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const LOG = process.env.FAKE_X_LOG;
const rec = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
const refuse = (name) => () => { rec({ blocked: name }); throw new Error('the test blocks node:' + name); };
for (const [mod, name] of [[http, 'http'], [https, 'https']]) { mod.request = refuse(name); mod.get = refuse(name); }
syncBuiltinESMExports();
let tweets = 0;
const start = Number(process.env.FAKE_X_START_ID || 1000);
const failAt = Number(process.env.FAKE_X_FAIL_TWEET || 0);
const bodyText = async (b) => {
  if (b == null) return '';
  if (typeof b === 'string') return b;
  if (b instanceof URLSearchParams) return b.toString();
  if (b instanceof FormData) { const p = []; for (const [k, v] of b.entries()) p.push(k + '=' + (typeof v === 'string' ? v : '[blob ' + (v.type || '') + ']')); return p.join('&'); }
  if (b instanceof Blob) return Buffer.from(await b.arrayBuffer()).toString('latin1');
  if (b instanceof ArrayBuffer) return Buffer.from(b).toString('latin1');
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
  return String(b);
};
const reply = (status, obj) => new Response(obj === undefined ? null : JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  let url, method, headers, body;
  if (input instanceof Request) { url = input.url; method = input.method; headers = new Headers(input.headers); body = await input.clone().text(); }
  else { url = String(input instanceof URL ? input.href : input); method = String(init.method || 'GET').toUpperCase(); headers = new Headers(init.headers || {}); body = await bodyText(init.body); }
  const u = new URL(url);
  rec({ method, url, auth: headers.get('authorization') || '', body: body.slice(0, 4000) });
  if (!/(^|\.)(x|twitter)\.com$/.test(u.hostname)) throw new TypeError('fetch failed: the test blocks ' + u.hostname);
  const p = u.pathname;
  if (p === '/2/tweets' && method === 'POST') {
    tweets++;
    if (tweets === failAt) return reply(503, { title: 'Service Unavailable', detail: 'fake outage', type: 'about:blank', status: 503 });
    let text = ''; try { text = JSON.parse(body).text; } catch {}
    return reply(201, { data: { id: String(start + tweets), text } });
  }
  if (p === '/2/users/me') return reply(200, { data: { id: '42', name: 'Example', username: 'example_user' } });
  if (p.includes('media/upload')) {
    const m = u.searchParams.get('command') || (body.match(/name="command"\r?\n\r?\n([A-Z]+)/) || body.match(/command=([A-Z]+)/) || body.match(/"command"\s*:\s*"([A-Z]+)"/) || [])[1] || '';
    const cmd = m.toUpperCase();
    const media = { id: '777', media_key: '3_777', expires_after_secs: 86400 };
    if (method === 'GET' || cmd === 'STATUS') { const pi = { state: 'succeeded', progress_percent: 100 }; return reply(200, { data: { ...media, processing_info: pi }, media_id_string: '777', media_id: 777, processing_info: pi }); }
    if (/\/append$/.test(p) || cmd === 'APPEND') return reply(200, { data: { expires_at: 1 } });
    if (/\/finalize$/.test(p) || cmd === 'FINALIZE') {
      const pi = process.env.FAKE_X_VIDEO_PENDING === '1' ? { state: 'pending', check_after_secs: 1 } : null;
      return reply(200, { data: { ...media, ...(pi ? { processing_info: pi } : {}) }, media_id_string: '777', media_id: 777, ...(pi ? { processing_info: pi } : {}) });
    }
    return reply(200, { data: media, media_id_string: '777', media_id: 777 });
  }
  return reply(404, { title: 'Not Found Error', detail: 'the fake X has no ' + p });
};
`;

type Req = { method?: string; url?: string; auth?: string; body?: string; blocked?: string };

let tmp: string;
let home: string;
let qdir: string;
let vdir: string;
let preload: string;
let logFile: string;

const writeKeys = () => {
  fs.mkdirSync(path.join(home, ".shippost"), { recursive: true });
  const f = path.join(home, ".shippost", "x-keys.json");
  fs.writeFileSync(f, JSON.stringify(KEYS), { mode: 0o600 });
  fs.chmodSync(f, 0o600);
};
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  channel: "x",
  draft: DRAFT,
  option: 1,
  topic: "the x queue",
  mode: "personal",
  text: "Main post: the X queue now posts through the API.",
  thread: ["Thread one: images are rendered at 16:9.", "Thread two: a failed chain resumes."],
  comment: "Link reply https://example.com/x-queue",
  repost: "",
  status: "queued",
  asset: null,
  createdAt: "2031-03-01T12:00:00.000Z",
  ...extra,
});
const writeItem = (o: Record<string, unknown>) => fs.writeFileSync(path.join(qdir, `${o.id}.json`), JSON.stringify(o, null, 2));
const readItem = (id: string) => JSON.parse(fs.readFileSync(path.join(qdir, `${id}.json`), "utf8"));
const requests = (): Req[] =>
  fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const tweetsOf = (rs: Req[]) => rs.filter((r) => r.method === "POST" && r.url && new URL(r.url).pathname === "/2/tweets");
const bodyOf = (r: Req) => JSON.parse(r.body || "{}");
const isMedia = (r: Req) => Boolean(r.url && r.url.includes("media/upload"));

function run(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", pathToFileURL(preload).href, script, ...args],
    {
      env: {
        ...process.env,
        HOME: home,
        SHIPPOST_CONFIG: path.join(tmp, "config.json"),
        FAKE_X_LOG: logFile,
        NODE_USE_ENV_PROXY: "1",
        HTTPS_PROXY: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "",
        ...extra,
      },
      encoding: "utf8",
      timeout: 60_000,
    }
  );
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

// RFC 5849 HMAC-SHA1, written independently of the app. Sanity-checked below against X's documented
// "Creating a signature" example, so a wrong reference can never make a right poster fail.
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function signature(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret: string) {
  const pairs = Object.entries(params)
    .map(([k, v]) => [enc(k), enc(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(pairs)].join("&");
  return crypto.createHmac("sha1", `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest("base64");
}
function expectSignedByKeys(r: Req) {
  const auth = r.auth ?? "";
  expect(auth.startsWith("OAuth "), `X-OAUTH: the request to ${r.url} carries an OAuth 1.0a header, got "${auth.slice(0, 40)}"`).toBe(true);
  const fields: Record<string, string> = {};
  for (const m of auth.slice(6).matchAll(/([A-Za-z_]+)="([^"]*)"/g)) fields[m[1]] = decodeURIComponent(m[2]);
  expect(fields.oauth_consumer_key, "X-OAUTH consumer key").toBe(KEYS.apiKey);
  expect(fields.oauth_token, "X-OAUTH token").toBe(KEYS.accessToken);
  expect(fields.oauth_signature_method, "X-OAUTH method").toBe("HMAC-SHA1");
  expect(fields.oauth_nonce, "X-OAUTH nonce").toBeTruthy();
  expect(fields.oauth_timestamp, "X-OAUTH timestamp").toMatch(/^\d{9,11}$/);
  const u = new URL(r.url!);
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (k.startsWith("oauth_") && k !== "oauth_signature") params[k] = v;
  for (const [k, v] of u.searchParams) params[k] = v; // query params sign; a JSON body never does
  const want = signature(r.method!, `${u.origin}${u.pathname}`, params, KEYS.apiSecret, KEYS.accessSecret);
  expect(fields.oauth_signature, `X-OAUTH: the signature of ${r.method} ${u.pathname} verifies with the keys`).toBe(want);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-x-post-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  const drafts = path.join(tmp, "drafts");
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: drafts, picksLogFile: ".picks.jsonl" }, app: {} })
  );
  qdir = path.join(drafts, "x", ".queue");
  vdir = path.join(drafts, "x", ".visuals");
  fs.mkdirSync(qdir, { recursive: true });
  fs.mkdirSync(vdir, { recursive: true });
  preload = path.join(tmp, "fake-x.mjs");
  fs.writeFileSync(preload, FAKE_X);
  logFile = path.join(tmp, "fetch.jsonl");
});

afterEach(() => {
  // Not one request may have escaped to a real host, in any test.
  const leaked = requests().filter((r) => r.blocked || (r.url && !/^https:\/\/([a-z0-9-]+\.)*(x|twitter)\.com\//.test(r.url)));
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(leaked, "a request went somewhere other than the fake X").toEqual([]);
});

describe("the reference signer", () => {
  it("reproduces X's documented signature example", () => {
    const sig = signature(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        oauth_version: "1.0",
      },
      "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"
    );
    expect(sig).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });
});

describe("x-post.mjs --job", () => {
  it("uploads the image, posts the chain in order (post, thread replies, link reply), saves every id, signs every post", () => {
    writeKeys();
    const png = path.join(vdir, "x1-v1.png");
    fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082", "hex"));
    writeItem(item("x1", { asset: png }));
    const r = run(["--job", "x1"]);
    const rs = requests();
    const tweets = tweetsOf(rs);
    const want = item("x1");
    expect(tweets.map((t) => bodyOf(t).text), `X-CHAIN-ORDER (exit ${r.code}: ${r.out.slice(0, 400)})`).toEqual([want.text, ...want.thread, want.comment]);
    const ids = ["1001", "1002", "1003", "1004"];
    expect(bodyOf(tweets[0]).media?.media_ids, "the first post carries the uploaded media id").toEqual(["777"]);
    expect(bodyOf(tweets[0]).reply, "the first post is not a reply").toBeUndefined();
    for (let i = 1; i < tweets.length; i++)
      expect(bodyOf(tweets[i]).reply?.in_reply_to_tweet_id, `post ${i + 1} replies to post ${i}`).toBe(ids[i - 1]);
    const firstMedia = rs.findIndex(isMedia);
    expect(firstMedia, "the media is uploaded").toBeGreaterThanOrEqual(0);
    expect(firstMedia, "the media is uploaded before the first post").toBeLessThan(rs.indexOf(tweets[0]));
    for (const t of tweets) expectSignedByKeys(t);
    expect(r.code).toBe(0);
    const after = readItem("x1");
    expect(after.status).toBe("posted");
    expect(after.xIds).toEqual(ids);
    expect(String(after.url)).toMatch(/^https:\/\/x\.com\/.*status\/1001$/);
    expect(after.postedAt).toBeTruthy();
    for (const secret of [KEYS.apiSecret, KEYS.accessSecret]) {
      expect(r.out.includes(secret), "a secret is printed").toBe(false);
      expect(JSON.stringify(after).includes(secret), "a secret is written into the item").toBe(false);
    }
  }, 90_000);

  it("a failure on reply 2 leaves the item failed with the 2 ids; a retry posts only the rest of the chain", () => {
    writeKeys();
    writeItem(item("x2"));
    const r1 = run(["--job", "x2"], { FAKE_X_FAIL_TWEET: "3" });
    const failed = readItem("x2");
    expect(
      { status: failed.status, xIds: failed.xIds },
      `X-RESUME: the chain stopped at reply 2 (exit ${r1.code}: ${r1.out.slice(0, 400)})`
    ).toEqual({ status: "failed", xIds: ["1001", "1002"] });
    expect(tweetsOf(requests())).toHaveLength(3);
    expect(String(failed.error), "the error quotes X's HTTP status").toContain("503");
    for (const secret of [KEYS.apiSecret, KEYS.accessSecret]) expect(String(failed.error).includes(secret)).toBe(false);

    // "Retry": the item back to queued with its ids kept, then the same --job.
    fs.rmSync(logFile, { force: true });
    writeItem({ ...failed, status: "queued" });
    const r2 = run(["--job", "x2"], { FAKE_X_START_ID: "2000" });
    const tweets = tweetsOf(requests());
    const want = item("x2");
    expect(tweets.map((t) => bodyOf(t).text), `X-RESUME: only the unposted rest (exit ${r2.code}: ${r2.out.slice(0, 300)})`).toEqual([want.thread[1], want.comment]);
    expect(bodyOf(tweets[0]).reply?.in_reply_to_tweet_id).toBe("1002");
    expect(bodyOf(tweets[1]).reply?.in_reply_to_tweet_id).toBe("2001");
    const done = readItem("x2");
    expect(done.status).toBe("posted");
    expect(done.xIds).toEqual(["1001", "1002", "2001", "2002"]);
    expect(String(done.url)).toMatch(/status\/1001$/);
  }, 90_000);

  it("a failure before the first post goes back to queued, with no id", () => {
    writeKeys();
    writeItem(item("x3"));
    const r = run(["--job", "x3"], { FAKE_X_FAIL_TWEET: "1" });
    expect(tweetsOf(requests()), `X-FIRST-FAIL: one attempt (exit ${r.code}: ${r.out.slice(0, 300)})`).toHaveLength(1);
    const after = readItem("x3");
    expect(after.status, "X-FIRST-FAIL: nothing went out, so the item is postable again").toBe("queued");
    expect(after.xIds ?? []).toEqual([]);
  }, 90_000);

  it("a video is uploaded as tweet_video and its processing STATUS is polled before the post", () => {
    writeKeys();
    const mp4 = path.join(vdir, "x4-v4.mp4");
    fs.writeFileSync(mp4, Buffer.alloc(64 * 1024, 7));
    writeItem(item("x4", { asset: mp4, thread: [], comment: "" }));
    const r = run(["--job", "x4"], { FAKE_X_VIDEO_PENDING: "1" });
    const rs = requests();
    const tweets = tweetsOf(rs);
    expect(tweets.map((t) => bodyOf(t).text), `X-VIDEO: one post (exit ${r.code}: ${r.out.slice(0, 300)})`).toEqual([item("x4").text]);
    expect(rs.some((q) => isMedia(q) && `${q.url} ${q.body}`.includes("tweet_video")), "X-VIDEO: uploaded as tweet_video").toBe(true);
    const statusAt = rs.findIndex((q) => isMedia(q) && (q.method === "GET" || /STATUS/.test(`${q.url} ${q.body}`)));
    expect(statusAt, "X-VIDEO: STATUS is polled").toBeGreaterThanOrEqual(0);
    expect(statusAt, "X-VIDEO: STATUS is polled before the post").toBeLessThan(rs.indexOf(tweets[0]));
    expect(bodyOf(tweets[0]).media?.media_ids).toEqual(["777"]);
    expect(readItem("x4").status).toBe("posted");
  }, 90_000);

  it("missing keys: exit 2 with the README hint and no request at all; with keys the same item posts", () => {
    writeItem(item("x5", { thread: [], comment: "" }));
    const r = run(["--job", "x5"]);
    expect(`${r.code} ${r.out}`, "X-NO-KEYS").toMatch(/^2 [\s\S]*X keys not set/);
    expect(requests(), "no request without keys").toEqual([]);
    expect(readItem("x5").status).toBe("queued");
    // Positive control, same path: with keys the fake X does see the post.
    writeKeys();
    run(["--job", "x5"]);
    expect(tweetsOf(requests())).toHaveLength(1);
  }, 90_000);
});

describe("x-post.mjs --check and --dry-run", () => {
  it("--check reads the account (prints its username) and posts nothing", () => {
    writeKeys();
    const r = run(["--check"]);
    const rs = requests();
    expect(rs.some((q) => q.method === "GET" && q.url && new URL(q.url).pathname === "/2/users/me"), `X-CHECK (exit ${r.code}: ${r.out.slice(0, 300)})`).toBe(true);
    expect(r.out).toContain("example_user");
    expect(r.code).toBe(0);
    expect(tweetsOf(rs)).toEqual([]);
    expectSignedByKeys(rs.find((q) => q.url && q.url.includes("/2/users/me"))!);
  }, 90_000);

  it("--dry-run prints the chain in order and sends nothing", () => {
    writeKeys();
    writeItem(item("x6"));
    const r = run(["--job", "x6", "--dry-run"]);
    const want = item("x6");
    const at = [want.text, ...want.thread, want.comment].map((t) => r.out.indexOf(t));
    expect(at.every((p, i) => p >= 0 && (i === 0 || p > at[i - 1])), `X-DRY-RUN: the chain printed in order (exit ${r.code}: ${r.out.slice(0, 300)})`).toBe(true);
    expect(r.code).toBe(0);
    expect(requests(), "a dry run sends nothing").toEqual([]);
    const after = readItem("x6");
    expect(after.status).toBe("queued");
    expect(after.xIds ?? []).toEqual([]);
  }, 90_000);
});
