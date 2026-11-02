import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Acceptance check (loopit starry-scribbling-bear-2): the X post queue route, /api/x-queue.
// Items live in <draftsDir>/x/.queue/, candidates in <draftsDir>/x/.visuals/; the LinkedIn queue
// (<draftsDir>/.linkedin/) and the X queue never list each other's items. Enqueue validates X's
// 280 limit the X way and starts the renderer for the X channel; trigger starts the X poster;
// requeue keeps the ids already posted; GET says whether the keys file exists, never what is in it.
// Child processes are stubbed: nothing renders, nothing posts, no network.

type Handler = (req: Request) => Promise<Response>;
type Mod = { GET?: Handler; POST?: Handler; DELETE?: Handler };

const spawned: string[] = [];
const fakeChild = () => ({ unref() {}, on() { return this; }, once() { return this; }, pid: 0, stdout: null, stderr: null });
vi.mock("node:child_process", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const stub = (name: string) => (...args: unknown[]) => {
    spawned.push(`${name} ${JSON.stringify(args.slice(0, 2))}`);
    return fakeChild();
  };
  const over = { spawn: stub("spawn"), fork: stub("fork"), exec: stub("exec"), execFile: stub("execFile") };
  return { ...actual, ...over, default: { ...(actual.default as object), ...over } };
});

const X_ID = "2031-03-02_120000";
const LI_ID = "2031-03-02_090000";
const X_MD = `# X drafts - 2031-03-02 · 1 option

## ⭐ Option 1 - build-in-public - the x queue   (9.0/10)
**A. Company post**
The X queue renders 16:9 images and posts through the API.

**B. Thread**
2/ A failed chain resumes where it stopped.

**C. First comment**
https://example.com/x-queue

_Why it works:_ test.
_Suggested visuals:_
1. a wide desk - AI prompt: "a wide desk with two monitors at dusk, cinematic 16:9"

---
`;
const LI_MD = `# LinkedIn drafts - 2031-03-02 · 1 option

## ⭐ Option 1 - build-in-public - the linkedin one   (9.0/10)
**A. Company post**
LinkedIn body.

_Why it works:_ test.
_Suggested visuals:_
1. screenshot (screenshot - no AI)

---
`;
const SECRET_A = "route-test-consumer-secret-NEVER-IN-A-RESPONSE";
const SECRET_B = "route-test-access-secret-NEVER-IN-A-RESPONSE";

let tmp: string;
let home: string;
let xq: string;
let xv: string;
let liq: string;
const savedHome = process.env.HOME;

const req = (method: string, body?: unknown, site = "same-origin", qs = "") =>
  new Request(`http://localhost:3030/api/x-queue${qs}`, {
    method,
    headers: { "content-type": "application/json", "sec-fetch-site": site },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function xRoute(): Promise<Mod> {
  try {
    return (await import("@/app/api/x-queue/route")) as unknown as Mod;
  } catch {
    return {}; // no route yet: every call answers 404, like a missing endpoint
  }
}
const call = async (h: Handler | undefined, r: Request) => (h ? h(r) : new Response(JSON.stringify({ error: "no such route" }), { status: 404 }));
const jsonFiles = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f)) : []);
const xItem = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  channel: "x",
  draft: X_ID,
  option: 1,
  topic: "the x queue",
  mode: "personal",
  text: `x post ${id}`,
  thread: [],
  comment: "",
  repost: "",
  status: "queued",
  createdAt: "2031-03-02T12:00:00.000Z",
  ...extra,
});
const put = (dir: string, o: Record<string, unknown>) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${o.id}.json`), JSON.stringify(o, null, 2));
};
const read = (dir: string, id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8"));
const enqueue = (over: Record<string, unknown> = {}) => ({
  date: X_ID,
  option: 1,
  text: "The X queue renders 16:9 images and posts through the API.",
  thread: ["2/ A failed chain resumes where it stopped."],
  reply: "https://example.com/x-queue",
  ...over,
});

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-x-queue-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home; // the keys file is looked up under ~/.shippost: never the real one here
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({
      author: { name: "T" },
      brand: { name: "B" },
      output: { draftsDir: tmp, recentPostsFile: "recent-posts.md", voiceSampleFile: "voice-sample.md", picksLogFile: ".picks.jsonl" },
      app: {},
    })
  );
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  fs.mkdirSync(path.join(tmp, "x"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "x", `${X_ID}.md`), X_MD);
  fs.writeFileSync(path.join(tmp, `${LI_ID}.md`), LI_MD);
  xq = path.join(tmp, "x", ".queue");
  xv = path.join(tmp, "x", ".visuals");
  liq = path.join(tmp, ".linkedin");
});

beforeEach(() => {
  for (const d of [xq, xv, liq, path.join(home, ".shippost")]) fs.rmSync(d, { recursive: true, force: true });
  spawned.length = 0;
});

afterAll(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/x-queue (enqueue)", () => {
  it("writes the item into x/.queue and starts the renderer for that job on the X channel", async () => {
    const { POST } = await xRoute();
    const res = await call(POST, req("POST", enqueue()));
    const files = jsonFiles(xq);
    expect({ status: res.status, files: files.length }, "X-ENQUEUE: 200 and one item file in x/.queue").toEqual({ status: 200, files: 1 });
    const item = read(xq, files[0].slice(0, -5));
    expect(item).toMatchObject({
      channel: "x",
      draft: X_ID,
      option: 1,
      status: "queued",
      text: enqueue().text,
      thread: enqueue().thread,
      comment: enqueue().reply,
    });
    expect(jsonFiles(liq), "nothing lands in the LinkedIn queue").toEqual([]);
    expect(spawned, "exactly one child: the renderer").toHaveLength(1);
    const s = spawned[0];
    expect(s).toContain("render-variants.mjs");
    expect(s).toMatch(new RegExp(`"--job","${item.id}"`));
    expect(s).toMatch(/"--channel","x"/);
  });

  it("refuses an over-long post or thread, a thread over 5, a draft that is not in x/, and a cross-site call; X's own count decides", async () => {
    const { POST } = await xRoute();
    // Positive controls first: exactly 280, and a long URL that X counts as 23.
    const at280 = await call(POST, req("POST", enqueue({ text: "a".repeat(280), thread: [] })));
    const longUrl = await call(POST, req("POST", enqueue({ text: `${"a".repeat(250)} https://example.com/${"p".repeat(100)}`, thread: [] })));
    expect([at280.status, longUrl.status], "X-LIMIT: 280 and a long link (counted 23) are accepted").toEqual([200, 200]);
    const okFiles = jsonFiles(xq).length;
    const okSpawns = spawned.length;
    expect(okFiles).toBe(2);
    expect(okSpawns).toBe(2);

    const refused = [
      await call(POST, req("POST", enqueue({ text: "a".repeat(281) }))),
      await call(POST, req("POST", enqueue({ thread: ["ok", "b".repeat(281)] }))),
      await call(POST, req("POST", enqueue({ thread: ["1", "2", "3", "4", "5", "6"] }))),
      await call(POST, req("POST", enqueue({ date: LI_ID }))),
    ].map((r) => r.status);
    expect(refused.slice(0, 3), "X-LIMIT: over 280 or a thread over 5 is a 400").toEqual([400, 400, 400]);
    expect(refused[3], "a draft that is only a LinkedIn draft is refused").toBeGreaterThanOrEqual(400);
    const cross = await call(POST, req("POST", enqueue(), "cross-site"));
    expect(cross.status, "cross-site is refused").toBe(403);
    expect(jsonFiles(xq).length, "a refusal writes nothing").toBe(okFiles);
    expect(spawned.length, "a refusal starts nothing").toBe(okSpawns);
  });
});

describe("POST /api/x-queue actions", () => {
  it("trigger records the chosen X candidate as the asset and starts the X poster for that job", async () => {
    const { POST } = await xRoute();
    put(xq, xItem("xq-t1"));
    fs.mkdirSync(xv, { recursive: true });
    fs.writeFileSync(path.join(xv, "xq-t1-v1.png"), "png");
    const res = await call(POST, req("POST", { action: "trigger", id: "xq-t1", image: 1 }));
    expect({ status: res.status, spawned: spawned.length }, "X-TRIGGER: 200 and one child").toEqual({ status: 200, spawned: 1 });
    expect(spawned[0]).toContain("x-post.mjs");
    expect(spawned[0]).toMatch(/"--job","xq-t1"/);
    expect(read(xq, "xq-t1").asset).toBe(path.join(xv, "xq-t1-v1.png"));
    expect(fs.existsSync(path.join(liq, "xq-t1.json")), "the LinkedIn queue is not touched").toBe(false);
  });

  it("requeue puts a failed chain back to queued and keeps the ids already posted", async () => {
    const { POST } = await xRoute();
    put(xq, xItem("xq-r1", { status: "failed", error: "X said 503", xIds: ["111", "222"] }));
    const res = await call(POST, req("POST", { action: "requeue", id: "xq-r1" }));
    const back = read(xq, "xq-r1");
    expect({ status: res.status, item: back.status }, "X-REQUEUE").toEqual({ status: 200, item: "queued" });
    expect(back.xIds, "a requeued chain keeps its posted ids, so a retry never re-posts").toEqual(["111", "222"]);
  });
});

describe("GET /api/x-queue", () => {
  it("lists only X items with their X candidates, and reports hasKeys without the keys' content", async () => {
    const { GET } = await xRoute();
    put(xq, xItem("xq-g1"));
    put(liq, { id: "li-g1", draft: LI_ID, option: 1, topic: "li", mode: "personal", text: "li post", repost: "", status: "queued", createdAt: "2031-03-02T09:00:00.000Z" });
    fs.mkdirSync(xv, { recursive: true });
    fs.writeFileSync(path.join(xv, "xq-g1-v2.png"), "png");

    const r1 = await call(GET, req("GET", undefined, "same-origin"));
    const b1 = r1.status === 200 ? await r1.json() : null;
    expect({ status: r1.status, ids: (b1?.items ?? []).map((i: { id: string }) => i.id), hasKeys: b1?.hasKeys }, "X-GET").toEqual({
      status: 200,
      ids: ["xq-g1"],
      hasKeys: false,
    });
    expect(b1.items[0].images, "candidates come from x/.visuals").toEqual([2]);

    fs.mkdirSync(path.join(home, ".shippost"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".shippost", "x-keys.json"),
      JSON.stringify({ apiKey: "k", apiSecret: SECRET_A, accessToken: "t", accessSecret: SECRET_B }),
      { mode: 0o600 }
    );
    const r2 = await call(GET, req("GET", undefined, "same-origin"));
    const text = await r2.text();
    expect(JSON.parse(text).hasKeys).toBe(true);
    expect(text.includes(SECRET_A) || text.includes(SECRET_B), "the keys never reach a response").toBe(false);

    // The LinkedIn queue, unchanged, does not list the X item (and still lists its own).
    const { GET: liGet } = (await import("@/app/api/linkedin/route")) as unknown as Mod;
    const li = await (await liGet!(new Request("http://localhost:3030/api/linkedin"))).json();
    expect(li.items.map((i: { id: string }) => i.id)).toEqual(["li-g1"]);
  });
});
