import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The route spawns detached children (the renderer, the LinkedIn runner). Here every spawn is
// recorded and nothing runs, so the tests can say exactly when a process WOULD have started.
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

let tmp: string;
let queueDir: string;
let picksPath: string;

const DRAFT = "2026-10-13_104948";
const DRAFT_MD = `# LinkedIn drafts - 2026-10-13

## Option 1 - build-in-public - the queue   (9.0/10)
**A. Company post**
I built a queue.

**B. Repost caption (your profile)**
Proud.

_Why it works:_ concrete.
_Suggested visuals:_
1. Hook - AI prompt: "a queue of postcards"
2. The diff (screenshot - no AI)
`;

const writeItem = (o: Record<string, unknown>) =>
  fs.writeFileSync(path.join(queueDir, `${o.id}.json`), JSON.stringify(o, null, 2));
const readItem = (id: string) => JSON.parse(fs.readFileSync(path.join(queueDir, `${id}.json`), "utf8"));
const item = (id: string, createdAt: string, status = "queued", extra: Record<string, unknown> = {}) => ({
  id,
  draft: DRAFT,
  option: 1,
  topic: "the queue",
  mode: "personal",
  text: `post ${id}`,
  repost: "",
  status,
  createdAt,
  ...extra,
});
const picks = () =>
  fs.existsSync(picksPath) ? fs.readFileSync(picksPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const post = (body: unknown) =>
  new Request("http://localhost/api/linkedin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-queue-"));
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
  fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), DRAFT_MD);
  queueDir = path.join(tmp, ".linkedin");
  picksPath = path.join(tmp, ".picks.jsonl");
});

beforeEach(() => {
  fs.rmSync(queueDir, { recursive: true, force: true });
  fs.mkdirSync(queueDir, { recursive: true });
  fs.rmSync(picksPath, { force: true });
  fs.rmSync(path.join(tmp, ".rendering"), { force: true });
  spawned.length = 0;
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("linkedinQueue lib", () => {
  it("lists items oldest first, skips render-state side files, and picks the oldest queued as next", async () => {
    const { listQueue, nextQueued } = await import("@/lib/linkedinQueue");
    writeItem(item("b", "2026-10-14T10:00:00.000Z"));
    writeItem(item("a", "2026-10-14T09:00:00.000Z", "posted"));
    writeItem(item("c", "2026-10-14T11:00:00.000Z"));
    fs.writeFileSync(path.join(queueDir, "b.render.json"), JSON.stringify({ state: "done", done: 3 }));
    expect(listQueue().map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(nextQueued()?.id).toBe("b");
  });

  it("finds the candidate images on disk, never trusting a malformed id", async () => {
    const { imagesFor } = await import("@/lib/linkedinQueue");
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".visuals", "x1-v1.png"), "");
    fs.writeFileSync(path.join(tmp, ".visuals", "x1-v3.png"), "");
    expect(imagesFor("x1")).toEqual([1, 3]);
    expect(imagesFor("../x1")).toEqual([]);
  });

  it("the 4th candidate is the video: an mp4, listed once it exists", async () => {
    const { imagesFor, variantImagePath, VIDEO } = await import("@/lib/linkedinQueue");
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".visuals", "x2-v1.png"), "");
    expect(imagesFor("x2")).toEqual([1]);
    fs.writeFileSync(path.join(tmp, ".visuals", "x2-v4.tmp.mp4"), ""); // half-written: not a candidate
    expect(imagesFor("x2")).toEqual([1]);
    fs.writeFileSync(path.join(tmp, ".visuals", "x2-v4.mp4"), "");
    expect(imagesFor("x2")).toEqual([1, VIDEO]);
    expect(variantImagePath("x2", VIDEO)).toBe(path.join(tmp, ".visuals", "x2-v4.mp4"));
    expect(variantImagePath("x2", 2)).toBe(path.join(tmp, ".visuals", "x2-v2.png"));
  });
});

describe("POST /api/linkedin", () => {
  it("adds an item and starts its renderer, and only that", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    const res = await POST(post({ date: DRAFT, option: 1, mode: "personal", text: "hello", repost: "ignored" }));
    expect(res.status).toBe(200);
    const { item: created } = await res.json();
    expect(readItem(created.id)).toMatchObject({ status: "queued", mode: "personal", text: "hello", repost: "", topic: "the queue" });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].join(" ")).toContain("render-variants.mjs");
    expect(spawned[0]).toContain(created.id);
  });

  it("keeps the first comment, and refuses one over LinkedIn's 1250 characters", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    const ok = await POST(post({ date: DRAFT, option: 1, mode: "personal", text: "hello", comment: "  more here  " }));
    expect(ok.status).toBe(200);
    expect(readItem((await ok.json()).item.id)).toMatchObject({ comment: "more here" });
    spawned.length = 0;
    const res = await POST(post({ date: DRAFT, option: 1, mode: "personal", text: "hello", comment: "x".repeat(1251) }));
    expect(res.status).toBe(400);
    expect(spawned).toHaveLength(0);
  });

  it("refuses company mode while no company page is configured", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    const res = await POST(post({ date: DRAFT, option: 1, mode: "company", text: "hello" }));
    expect(res.status).toBe(400);
    expect(spawned).toHaveLength(0);
  });

  it("trigger: any queued post can go out, not only the oldest", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    writeItem(item("first", "2026-10-14T09:00:00.000Z"));
    writeItem(item("second", "2026-10-14T10:00:00.000Z"));
    const res = await POST(post({ action: "trigger", id: "second", image: null }));
    expect(res.status).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain("second");
    expect(readItem("first").status).toBe("queued");
  });

  it("trigger: a render never blocks it, a not-yet-rendered image does, and so does another post going out", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    writeItem(item("first", "2026-10-14T09:00:00.000Z"));
    fs.writeFileSync(path.join(queueDir, "first.render.json"), JSON.stringify({ state: "rendering", done: 0, total: 3 }));
    fs.writeFileSync(path.join(tmp, ".rendering"), "a render is running");
    // the chosen image is not there yet: refused, nothing started
    expect((await POST(post({ action: "trigger", id: "first", image: 2 }))).status).toBe(400);
    expect(spawned).toHaveLength(0);
    // "No image" goes out even while renders run
    expect((await POST(post({ action: "trigger", id: "first", image: null }))).status).toBe(200);
    expect(spawned).toHaveLength(1);
    fs.rmSync(path.join(tmp, ".rendering"));
    spawned.length = 0;
    writeItem(item("first", "2026-10-14T09:00:00.000Z"));
    writeItem(item("zero", "2026-10-14T08:00:00.000Z", "posting"));
    fs.writeFileSync(path.join(queueDir, ".lock"), "123"); // the runner is alive
    expect((await POST(post({ action: "trigger", id: "first", image: null }))).status).toBe(409);
    expect(spawned).toHaveLength(0);
    expect(readItem("zero").status).toBe("posting");
  });

  it("a 'posting' item whose runner is gone is settled as failed, so it no longer blocks the queue", async () => {
    const { GET } = await import("@/app/api/linkedin/route");
    writeItem(item("zero", "2026-10-14T08:00:00.000Z", "posting"));
    await GET(new Request("http://localhost/api/linkedin"));
    expect(readItem("zero")).toMatchObject({ status: "failed" });
    expect(readItem("zero").error).toMatch(/check LinkedIn/);
  });

  it("trigger: posts the next item with the chosen image, the path built server-side", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    writeItem(item("first", "2026-10-14T09:00:00.000Z"));
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".visuals", "first-v2.png"), "");
    expect((await POST(post({ action: "trigger", id: "first", image: 3 }))).status).toBe(400); // not rendered
    const res = await POST(post({ action: "trigger", id: "first", image: 2 }));
    expect(res.status).toBe(200);
    expect(readItem("first").asset).toBe(path.join(tmp, ".visuals", "first-v2.png"));
    expect(spawned).toHaveLength(1);
    expect(spawned[0].join(" ")).toContain("linkedin-post.mjs");
  });
});

describe("GET /api/linkedin", () => {
  it("records each posted item as a pick exactly once, never a queued one, and starts nothing", async () => {
    const { GET } = await import("@/app/api/linkedin/route");
    writeItem(item("p1", "2026-10-14T09:00:00.000Z", "posted"));
    writeItem(item("q1", "2026-10-14T10:00:00.000Z"));
    writeItem(item("p0", "2026-10-14T08:00:00.000Z", "posted", { picked: true }));

    const res = await GET(new Request("http://localhost/api/linkedin"));
    expect(res.status).toBe(200);
    expect(picks().map((p) => [p.date, p.option])).toEqual([[DRAFT, 1]]);
    expect(readItem("p1").picked).toBe(true);
    expect(readItem("q1").picked).toBeUndefined();

    await GET(new Request("http://localhost/api/linkedin"));
    expect(picks()).toHaveLength(1);
    expect(spawned).toHaveLength(0);
  });

  it("narrows to one option with its queue position", async () => {
    const { GET } = await import("@/app/api/linkedin/route");
    writeItem(item("q1", "2026-10-14T09:00:00.000Z"));
    writeItem(item("q2", "2026-10-14T10:00:00.000Z", "queued", { option: 2 }));
    const j = await (await GET(new Request(`http://localhost/api/linkedin?date=${DRAFT}&option=2`))).json();
    expect(j.items.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([["q2", 2]]);
  });
});

describe("DELETE /api/linkedin", () => {
  it("removes a queued item but never a posted one", async () => {
    const { DELETE } = await import("@/app/api/linkedin/route");
    writeItem(item("q1", "2026-10-14T09:00:00.000Z"));
    writeItem(item("p1", "2026-10-14T08:00:00.000Z", "posted"));
    expect((await DELETE(new Request("http://localhost/api/linkedin?id=p1", { method: "DELETE" }))).status).toBe(409);
    expect((await DELETE(new Request("http://localhost/api/linkedin?id=q1", { method: "DELETE" }))).status).toBe(200);
    expect(fs.existsSync(path.join(queueDir, "q1.json"))).toBe(false);
    expect(fs.existsSync(path.join(queueDir, "p1.json"))).toBe(true);
  });
});

// The renderer runs for real here (no ComfyUI involved): an unreachable REMOTE engine must fail
// cleanly, and a render lock someone else holds must be waited for, never touched.
describe("POST /api/linkedin mode switch", () => {
  it("rewrites a queued item from the draft, refuses company without a page version, keeps candidates", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    writeItem(item("sw", "2026-10-14T09:00:00.000Z", "queued", { text: "edited by hand", comment: "c" }));
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".visuals", "sw-v1.png"), "");
    // The fixture draft has no section D and no company page configured.
    expect((await POST(post({ action: "mode", id: "sw", mode: "company" }))).status).toBe(400);
    expect(readItem("sw").text).toBe("edited by hand");
    const r = await POST(post({ action: "mode", id: "sw", mode: "personal" }));
    expect(r.status).toBe(200);
    expect(readItem("sw")).toMatchObject({ mode: "personal", text: "I built a queue.", repost: "", pageComment: "" });
    expect(fs.existsSync(path.join(tmp, ".visuals", "sw-v1.png"))).toBe(true);
    writeItem(item("done", "2026-10-14T09:00:00.000Z", "posted"));
    expect((await POST(post({ action: "mode", id: "done", mode: "personal" }))).status).toBe(409);
    expect((await POST(post({ action: "mode", id: "sw", mode: "sideways" }))).status).toBe(400);
  });
});

describe("POST /api/linkedin trigger with the video", () => {
  it("the video (4) is a valid pick once rendered, 5 only once attached, anything past it is not", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    writeItem(item("vid", "2026-10-14T09:00:00.000Z"));
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    expect((await POST(post({ action: "trigger", id: "vid", image: 6 }))).status).toBe(400);
    expect((await POST(post({ action: "trigger", id: "vid", image: 5 }))).status).toBe(400); // nothing attached
    expect((await POST(post({ action: "trigger", id: "vid", image: 4 }))).status).toBe(400); // not rendered yet
    fs.writeFileSync(path.join(tmp, ".visuals", "vid-v4.mp4"), "");
    expect((await POST(post({ action: "trigger", id: "vid", image: 4 }))).status).toBe(200);
    expect(readItem("vid").asset).toBe(path.join(tmp, ".visuals", "vid-v4.mp4"));
  });
});

describe("engine/render-variants.mjs", () => {
  const script = path.resolve(__dirname, "..", "..", "engine", "render-variants.mjs");
  const env = () => ({ ...process.env, SHIPPOST_CONFIG: path.join(tmp, "config.json"), SHIPPOST_COMFY_URL: "http://192.0.2.1:9" });
  // The real spawn: the module mock above replaces it for the route only.
  let realSpawn: typeof import("node:child_process").spawn;
  beforeAll(async () => {
    realSpawn = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
  });
  const run = (id: string) =>
    realSpawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--job", id], { env: env(), stdio: "ignore" });
  const state = (id: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(queueDir, `${id}.render.json`), "utf8"));
    } catch {
      return null;
    }
  };

  it("marks the render failed when a remote engine does not answer, and leaves no lock, no image, the item queued", async () => {
    writeItem(item("r1", "2026-10-14T09:00:00.000Z"));
    const code = await new Promise((res) => run("r1").on("close", res));
    expect(code).toBe(1);
    expect(state("r1")).toMatchObject({ state: "failed" });
    expect(state("r1").error).toMatch(/not answering/);
    expect(fs.existsSync(path.join(tmp, ".rendering"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".visuals", "r1-v1.png"))).toBe(false);
    expect(readItem("r1").status).toBe("queued");
  }, 20_000);

  it("is re-runnable: candidates already on disk are kept and reported, nothing is rendered again", async () => {
    writeItem(item("r3", "2026-10-14T09:00:00.000Z"));
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    for (const v of [1, 2, 3]) fs.writeFileSync(path.join(tmp, ".visuals", `r3-v${v}.png`), "keep");
    // No `video` config: 3 images is everything, so the job ends before touching the engine or the lock.
    const code = await new Promise((res) => run("r3").on("close", res));
    expect(code).toBe(0);
    expect(state("r3")).toEqual({ state: "done", done: 3, total: 3 });
    expect(fs.readFileSync(path.join(tmp, ".visuals", "r3-v2.png"), "utf8")).toBe("keep");
    expect(fs.existsSync(path.join(tmp, ".rendering"))).toBe(false);
  }, 20_000);

  it("waits for a fresh lock held by someone else without touching it", async () => {
    writeItem(item("r2", "2026-10-14T09:00:00.000Z"));
    const lock = path.join(tmp, ".rendering");
    fs.writeFileSync(lock, "someone-else");
    const child = run("r2");
    try {
      const deadline = Date.now() + 8000;
      while (state("r2")?.state !== "waiting" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      expect(state("r2")).toMatchObject({ state: "waiting" });
      expect(child.exitCode).toBeNull();
      expect(fs.readFileSync(lock, "utf8")).toBe("someone-else");
    } finally {
      child.kill();
    }
  }, 20_000);
});

describe("the LinkedIn browser lock (login window, post, repost)", () => {
  const lock = () => path.join(queueDir, ".lock");

  it("login: refused cross-site, refused while the browser is busy, started when free", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    const crossSite = new Request("http://localhost/api/linkedin", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ action: "login" }),
    });
    expect((await POST(crossSite)).status).toBe(403);

    fs.writeFileSync(lock(), "12345");
    expect((await POST(post({ action: "login" }))).status).toBe(409);
    expect(spawned).toHaveLength(0);

    fs.rmSync(lock());
    expect((await POST(post({ action: "login" }))).status).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain("--login");
  });

  it("trigger: refused while the browser is busy, without starting a runner or touching the item", async () => {
    const { POST } = await import("@/app/api/linkedin/route");
    writeItem(item("busy1", "2026-10-14T09:00:00.000Z", "queued", { error: "kept" }));
    fs.writeFileSync(lock(), "12345");
    const res = await POST(post({ action: "trigger", id: "busy1", image: null }));
    expect(res.status).toBe(409);
    expect(spawned).toHaveLength(0);
    expect(readItem("busy1")).toMatchObject({ status: "queued", error: "kept" });
  });
});
