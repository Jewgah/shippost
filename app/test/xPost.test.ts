import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// app/scripts/x-post.mjs run in-process (its `main`), against a fake `fetch`: nothing reaches X.
// HOME points at a temp dir, so the keys file is a fixture and the real ~/.shippost is never read.

const KEYS = { apiKey: "test-consumer-key", apiSecret: "test-consumer-SECRET-value", accessToken: "test-access-token", accessSecret: "test-access-SECRET-value" };
const ID = "2026-11-02_120000-o1-abc123";

let tmp: string;
let home: string;
let queueDir: string;
let calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }>;
let out: string;
const savedHome = process.env.HOME;
const savedConfig = process.env.SHIPPOST_CONFIG;

type Answer = { status?: number; json?: unknown };
/** The fake X: `route(url, method, n)` answers each call; every call is recorded. */
function fakeX(route: (url: string, method: string, body: unknown) => Answer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      let body: unknown = init.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          /* form-encoded: kept as text */
        }
      }
      calls.push({ url: String(url), method, headers: (init.headers ?? {}) as Record<string, string>, body });
      const a = route(String(url), method, body);
      return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status ?? 200 });
    })
  );
}

/** X's tweet endpoint handing out ids 1001, 1002... with the n-th post call (1-based) failing when asked. */
function tweets(failOn?: number, failStatus = 503) {
  let n = 0;
  return (url: string): Answer | null => {
    if (url !== "https://api.x.com/2/tweets") return null;
    n++;
    if (n === failOn) return { status: failStatus, json: { title: "Service Unavailable", detail: "try later" } };
    return { status: 201, json: { data: { id: String(1000 + n), text: "ok" } } };
  };
}

const item = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  channel: "x",
  draft: "2026-11-02_120000",
  option: 1,
  topic: "t",
  mode: "personal",
  text: "the post",
  repost: "",
  thread: ["thread two", "thread three"],
  comment: "https://example.com/a-long-link",
  status: "queued",
  createdAt: "2026-11-02T12:00:00.000Z",
  ...extra,
});
const writeItem = (o: Record<string, unknown>) => fs.writeFileSync(path.join(queueDir, `${ID}.json`), JSON.stringify(o));
const readItem = () => JSON.parse(fs.readFileSync(path.join(queueDir, `${ID}.json`), "utf8"));
const writeKeys = () => {
  fs.mkdirSync(path.join(home, ".shippost"), { recursive: true });
  fs.writeFileSync(path.join(home, ".shippost", "x-keys.json"), JSON.stringify(KEYS), { mode: 0o600 });
};
const tweetCalls = () => calls.filter((c) => c.url === "https://api.x.com/2/tweets");

async function run(...argv: string[]) {
  const { main } = await import("../scripts/x-post.mjs");
  return main(argv) as Promise<number>;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-xpost-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(home);
  queueDir = path.join(tmp, "x", ".queue");
  fs.mkdirSync(queueDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, "x", ".visuals"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ output: { draftsDir: tmp } }));
  process.env.HOME = home;
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  calls = [];
  out = "";
  const grab = (...a: unknown[]) => void (out += a.map(String).join(" ") + "\n");
  vi.spyOn(console, "log").mockImplementation(grab);
  vi.spyOn(console, "error").mockImplementation(grab);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env.HOME = savedHome;
  process.env.SHIPPOST_CONFIG = savedConfig;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("x-post.mjs --job", () => {
  it("uploads the image, then posts the post with it, the thread and the link reply, each replying to the previous id", async () => {
    writeKeys();
    const png = path.join(tmp, "x", ".visuals", `${ID}-v1.png`);
    fs.writeFileSync(png, "png-bytes");
    writeItem(item({ asset: png }));
    const t = tweets();
    fakeX((url) => {
      if (url.endsWith("/media/upload/initialize")) return { json: { data: { id: "m77" } } };
      if (url.endsWith("/append")) return { status: 204 };
      if (url.endsWith("/finalize")) return { json: { data: { id: "m77" } } };
      return t(url) ?? { status: 500 };
    });
    expect(await run("--job", ID)).toBe(0);

    expect(calls.map((c) => c.url.replace("https://api.x.com/2", ""))).toEqual([
      "/media/upload/initialize",
      "/media/upload/m77/append",
      "/media/upload/m77/finalize",
      "/tweets",
      "/tweets",
      "/tweets",
      "/tweets",
    ]);
    expect((calls[0].body as Record<string, unknown>).media_category).toBe("tweet_image");
    expect(tweetCalls().map((c) => c.body)).toEqual([
      { text: "the post", media: { media_ids: ["m77"] } },
      { text: "thread two", reply: { in_reply_to_tweet_id: "1001" } },
      { text: "thread three", reply: { in_reply_to_tweet_id: "1002" } },
      { text: "https://example.com/a-long-link", reply: { in_reply_to_tweet_id: "1003" } },
    ]);
    for (const c of calls) expect(c.headers.authorization).toMatch(/^OAuth .*oauth_signature="[^"]+"/);
    const done = readItem();
    expect(done).toMatchObject({ status: "posted", xIds: ["1001", "1002", "1003", "1004"], url: "https://x.com/i/status/1001" });
    expect(typeof done.postedAt).toBe("string");
    const written = fs.readFileSync(path.join(queueDir, `${ID}.json`), "utf8");
    for (const secret of [KEYS.apiSecret, KEYS.accessSecret]) {
      expect(written).not.toContain(secret);
      expect(out).not.toContain(secret);
      for (const c of calls) expect(c.headers.authorization).not.toContain(secret);
    }
    expect(fs.existsSync(path.join(queueDir, ".lock"))).toBe(false);
  });

  it("a failure on reply 2 leaves the item failed with 2 ids; a retry posts only the rest of the chain", async () => {
    writeKeys();
    writeItem(item());
    const first = tweets(3);
    fakeX((url) => first(url) ?? { status: 500 });
    expect(await run("--job", ID)).toBe(1);
    const failed = readItem();
    expect(failed.status).toBe("failed");
    expect(failed.xIds).toEqual(["1001", "1002"]);
    expect(failed.error).toMatch(/503/);

    // Retry: back to queued with the ids kept (what POST /api/x-queue requeue does), then --job again.
    writeItem({ ...failed, status: "queued", error: undefined });
    calls = [];
    let n = 0;
    fakeX(() => ({ status: 201, json: { data: { id: String(2001 + n++) } } }));
    expect(await run("--job", ID)).toBe(0);
    expect(tweetCalls().map((c) => c.body)).toEqual([
      { text: "thread three", reply: { in_reply_to_tweet_id: "1002" } },
      { text: "https://example.com/a-long-link", reply: { in_reply_to_tweet_id: "2001" } },
    ]);
    expect(readItem()).toMatchObject({ status: "posted", xIds: ["1001", "1002", "2001", "2002"], url: "https://x.com/i/status/1001" });
  });

  it("an X refusal before the first id puts the item back in the queue with no ids", async () => {
    writeKeys();
    writeItem(item());
    const t = tweets(1, 403);
    fakeX((url) => t(url) ?? { status: 500 });
    expect(await run("--job", ID)).toBe(1);
    const back = readItem();
    expect(back.status).toBe("queued");
    expect(back.xIds ?? []).toEqual([]);
    expect(back.error).toMatch(/403/);
    expect(tweetCalls()).toHaveLength(1);
  });

  it("a 5xx on the first post marks the item failed, never queued: X may have created it", async () => {
    writeKeys();
    writeItem(item());
    const t = tweets(1, 503);
    fakeX((url) => t(url) ?? { status: 500 });
    expect(await run("--job", ID)).toBe(1);
    const after = readItem();
    expect(after.status).toBe("failed");
    expect(after.xIds ?? []).toEqual([]);
    expect(after.error).toMatch(/503.*check x\.com before retrying/);
  });

  it("a video is uploaded as tweet_video and STATUS is polled until processing succeeds, before the post", async () => {
    writeKeys();
    const mp4 = path.join(tmp, "x", ".visuals", `${ID}-v4.mp4`);
    fs.writeFileSync(mp4, "mp4-bytes");
    writeItem(item({ asset: mp4, thread: [], comment: "" }));
    let polls = 0;
    const t = tweets();
    fakeX((url) => {
      if (url.endsWith("/media/upload/initialize")) return { json: { data: { id: "v9" } } };
      if (url.endsWith("/append")) return { status: 204 };
      if (url.endsWith("/finalize")) return { json: { data: { id: "v9", processing_info: { state: "pending", check_after_secs: 0 } } } };
      if (url.includes("command=STATUS")) {
        polls++;
        return { json: { data: { id: "v9", processing_info: polls < 2 ? { state: "in_progress", check_after_secs: 0 } : { state: "succeeded" } } } };
      }
      return t(url) ?? { status: 500 };
    });
    expect(await run("--job", ID)).toBe(0);
    expect((calls[0].body as Record<string, unknown>).media_category).toBe("tweet_video");
    const statusAt = calls.map((c) => c.url).filter((u) => u.includes("command=STATUS"));
    expect(statusAt).toHaveLength(2);
    expect(statusAt[0]).toBe("https://api.x.com/2/media/upload?command=STATUS&media_id=v9");
    const lastStatus = calls.map((c) => c.url).lastIndexOf(statusAt[1]);
    const firstTweet = calls.findIndex((c) => c.url.endsWith("/tweets"));
    expect(firstTweet).toBeGreaterThan(lastStatus);
    expect(tweetCalls()[0].body).toEqual({ text: "the post", media: { media_ids: ["v9"] } });
  });

  it("with no keys file: exit 2, says so, sends nothing, leaves the item queued", async () => {
    writeItem(item());
    fakeX(() => ({ status: 500 }));
    expect(await run("--job", ID)).toBe(2);
    expect(out).toMatch(/X keys not set/);
    expect(calls).toHaveLength(0);
    expect(readItem().status).toBe("queued");
  });
});

describe("x-post.mjs --dry-run and --check", () => {
  it("--dry-run prints the chain in order and sends nothing", async () => {
    writeKeys();
    writeItem(item());
    fakeX(() => ({ status: 500 }));
    expect(await run("--job", ID, "--dry-run")).toBe(0);
    expect(calls).toHaveLength(0);
    const order = ["the post", "thread two", "thread three", "https://example.com/a-long-link"].map((t) => out.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(readItem().status).toBe("queued");
  });

  it("--check reads the account with GET /2/users/me and prints the username", async () => {
    writeKeys();
    fakeX((url, method) => (url === "https://api.x.com/2/users/me" && method === "GET" ? { json: { data: { id: "1", username: "someone" } } } : { status: 500 }));
    expect(await run("--check")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(out).toMatch(/@someone/);
    expect(out).not.toContain(KEYS.apiSecret);
  });
});
