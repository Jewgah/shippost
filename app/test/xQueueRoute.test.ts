import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// POST/GET /api/x-queue with every spawn recorded and nothing run (the same mock as linkedinQueue.test.ts).
const spawned: string[][] = [];
vi.mock("node:child_process", async (orig) => {
  const actual = (await orig()) as typeof import("node:child_process");
  return {
    ...actual,
    spawn: vi.fn((_cmd: string, args: string[]) => {
      spawned.push(args);
      return { unref() {} };
    }),
  };
});

const DRAFT = "2026-11-02_120000";
const X_MD = `# X drafts - 2026-11-02

## Option 1 - build-in-public - the queue   (9.0/10)
**A. Company post**
A post.

_Why it works:_ test.
`;
let tmp: string;
let xQueue: string;
const savedHome = process.env.HOME;

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x-queue", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const itemFiles = () => (fs.existsSync(xQueue) ? fs.readdirSync(xQueue).filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f)) : []);
const enqueue = (extra: Record<string, unknown> = {}) => ({ date: DRAFT, option: 1, text: "A post.", thread: ["two"], reply: "https://example.com", ...extra });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-xqueue-"));
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: tmp, picksLogFile: ".picks.jsonl" }, app: {} })
  );
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  process.env.HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "x"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "x", `${DRAFT}.md`), X_MD);
  // A LinkedIn draft of the same id: it must not count as an X draft.
  fs.writeFileSync(path.join(tmp, "2026-11-01_120000.md"), X_MD);
  xQueue = path.join(tmp, "x", ".queue");
});
afterAll(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  spawned.length = 0;
  for (const d of [xQueue, path.join(tmp, ".linkedin"), path.join(tmp, "x", ".visuals"), path.join(tmp, "home")]) fs.rmSync(d, { recursive: true, force: true });
});

describe("POST /api/x-queue (enqueue)", () => {
  it("writes one X item in x/.queue and spawns render-variants --job <id> --channel x", async () => {
    const { POST } = await import("@/app/api/x-queue/route");
    const res = await POST(req(enqueue()));
    expect(res.status).toBe(200);
    const files = itemFiles();
    expect(files).toHaveLength(1);
    const item = JSON.parse(fs.readFileSync(path.join(xQueue, files[0]), "utf8"));
    expect(item).toMatchObject({ channel: "x", draft: DRAFT, option: 1, text: "A post.", thread: ["two"], comment: "https://example.com", status: "queued" });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].some((a) => a.endsWith(path.join("engine", "render-variants.mjs")))).toBe(true);
    expect(spawned[0].slice(-4)).toEqual(["--job", item.id, "--channel", "x"]);
    expect(fs.existsSync(path.join(tmp, ".linkedin"))).toBe(false);
  });

  it("refuses an over-280 post, a 6-post thread and a draft that is not in x/, writing and spawning nothing", async () => {
    const { POST } = await import("@/app/api/x-queue/route");
    for (const body of [
      enqueue({ text: "a".repeat(281) }),
      enqueue({ thread: ["ok", "b".repeat(281)] }),
      enqueue({ reply: "c".repeat(281) }),
      enqueue({ thread: ["1", "2", "3", "4", "5", "6"] }),
      enqueue({ date: "2026-11-01_120000" }),
    ]) {
      expect((await POST(req(body))).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(itemFiles()).toHaveLength(0);
    expect(spawned).toHaveLength(0);
  });

  it("accepts exactly 280, and a long URL that X counts as 23", async () => {
    const { POST } = await import("@/app/api/x-queue/route");
    expect((await POST(req(enqueue({ text: "a".repeat(280) })))).status).toBe(200);
    const longUrl = `https://example.com/${"p".repeat(400)}`;
    expect((await POST(req(enqueue({ text: `${"a".repeat(256)} ${longUrl}` })))).status).toBe(200);
    expect(itemFiles()).toHaveLength(2);
  });

  it("refuses a cross-site request", async () => {
    const { POST } = await import("@/app/api/x-queue/route");
    expect((await POST(req(enqueue(), { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(itemFiles()).toHaveLength(0);
  });
});

describe("POST /api/x-queue actions, GET", () => {
  const writeX = (id: string, extra: Record<string, unknown> = {}) => {
    fs.mkdirSync(xQueue, { recursive: true });
    fs.writeFileSync(
      path.join(xQueue, `${id}.json`),
      JSON.stringify({ id, channel: "x", draft: DRAFT, option: 1, topic: "t", mode: "personal", text: "p", repost: "", thread: [], comment: "", status: "queued", createdAt: "2026-11-02T12:00:00.000Z", ...extra })
    );
  };
  const readX = (id: string) => JSON.parse(fs.readFileSync(path.join(xQueue, `${id}.json`), "utf8"));

  it("trigger sets the asset to x/.visuals/<id>-v<n>.png and spawns x-post.mjs --job <id>", async () => {
    const { POST } = await import("@/app/api/x-queue/route");
    writeX("x1");
    expect((await POST(req({ action: "trigger", id: "x1", image: 2 })))).toHaveProperty("status", 400); // not rendered yet
    expect(spawned).toHaveLength(0);
    fs.mkdirSync(path.join(tmp, "x", ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "x", ".visuals", "x1-v2.png"), "png");
    expect((await POST(req({ action: "trigger", id: "x1", image: 2 }))).status).toBe(200);
    expect(readX("x1").asset).toBe(path.join(tmp, "x", ".visuals", "x1-v2.png"));
    expect(spawned).toHaveLength(1);
    expect(spawned[0].some((a) => a.endsWith(path.join("app", "scripts", "x-post.mjs")))).toBe(true);
    expect(spawned[0].slice(-2)).toEqual(["--job", "x1"]);
  });

  it("requeue moves a failed item back to queued and keeps its xIds; a queued one is refused", async () => {
    const { POST } = await import("@/app/api/x-queue/route");
    writeX("f1", { status: "failed", xIds: ["11", "12"], error: "X answered HTTP 503" });
    writeX("q1");
    expect((await POST(req({ action: "requeue", id: "q1" }))).status).toBe(409);
    expect((await POST(req({ action: "requeue", id: "f1" }))).status).toBe(200);
    expect(readX("f1")).toMatchObject({ status: "queued", xIds: ["11", "12"] });
    expect(readX("f1").error).toBeUndefined();
  });

  it("GET lists X items with their images and hasKeys, never the keys' content", async () => {
    const { GET } = await import("@/app/api/x-queue/route");
    writeX("g1");
    fs.mkdirSync(path.join(tmp, "x", ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "x", ".visuals", "g1-v1.png"), "png");
    let j = await (await GET()).json();
    expect(j.hasKeys).toBe(false);
    expect(j.items.map((i: { id: string }) => i.id)).toEqual(["g1"]);
    expect(j.items[0].images).toEqual([1]);

    fs.mkdirSync(path.join(tmp, "home", ".shippost"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "home", ".shippost", "x-keys.json"), JSON.stringify({ apiKey: "k", apiSecret: "SECRET-ONE", accessToken: "t", accessSecret: "SECRET-TWO" }));
    const raw = await (await GET()).text();
    j = JSON.parse(raw);
    expect(j.hasKeys).toBe(true);
    expect(raw).not.toContain("SECRET-ONE");
    expect(raw).not.toContain("SECRET-TWO");
  });

  it("/api/linkedin and /api/x-queue never list each other's items", async () => {
    const x = await import("@/app/api/x-queue/route");
    const li = await import("@/app/api/linkedin/route");
    writeX("onlyx");
    fs.mkdirSync(path.join(tmp, ".linkedin"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".linkedin", "onlyli.json"),
      JSON.stringify({ id: "onlyli", draft: "2026-11-01_120000", option: 1, topic: "t", mode: "personal", text: "p", repost: "", status: "queued", createdAt: "2026-11-02T12:00:00.000Z" })
    );
    // An X item that strayed into the LinkedIn folder is not LinkedIn's either.
    fs.writeFileSync(path.join(tmp, ".linkedin", "stray.json"), JSON.stringify({ ...readX("onlyx"), id: "stray" }));
    const xs = (await (await x.GET()).json()).items.map((i: { id: string }) => i.id);
    const lis = (await (await li.GET(new Request("http://localhost/api/linkedin"))).json()).items.map((i: { id: string }) => i.id);
    expect(xs).toEqual(["onlyx"]);
    expect(lis).toEqual(["onlyli"]);
  });
});

describe("an X item written without its channel field", () => {
  it("is still listed on X and stays in x/.queue when triggered", async () => {
    const { GET, POST } = await import("@/app/api/x-queue/route");
    fs.mkdirSync(xQueue, { recursive: true });
    fs.writeFileSync(
      path.join(xQueue, "bare.json"),
      JSON.stringify({ id: "bare", draft: DRAFT, option: 1, topic: "t", mode: "personal", text: "p", repost: "", status: "queued", createdAt: "2026-11-02T12:00:00.000Z" })
    );
    expect((await (await GET()).json()).items.map((i: { id: string }) => i.id)).toEqual(["bare"]);
    expect((await POST(req({ action: "trigger", id: "bare", image: null }))).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(xQueue, "bare.json"), "utf8"))).toMatchObject({ channel: "x", asset: null });
    expect(fs.existsSync(path.join(tmp, ".linkedin", "bare.json"))).toBe(false);
  });
});
