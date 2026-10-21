import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDraft } from "@/lib/draftParser";
import { ATTACHED as BOARD_ATTACHED, VIDEO as BOARD_VIDEO, candidateName, chosenCandidate, defaultCandidate } from "../components/QueueBoard";

// The author's own video as a queue candidate (5), next to the generated clip (4).
// Spawns are recorded, never run: queueing must not start a real renderer here.
const spawned: string[][] = [];
vi.mock("node:child_process", async (orig) => {
  const actual = (await orig()) as typeof import("node:child_process");
  return { ...actual, spawn: vi.fn((_cmd: string, args: string[]) => (spawned.push(args), { unref() {} })) };
});

let tmp: string;
let src: string;
const DRAFT = "2026-10-21_120000";

const option = (n: number, extra = "") => `## Option ${n} - build-in-public - topic ${n}   (8.${n}/10)
**A. Company post**
Post ${n} body.
Video: this sentence is part of the post, not a declaration.

**B. Repost caption (your profile)**
Caption ${n}.
${extra}
_Why it works:_ concrete.
_Suggested visuals:_
1. Hook - AI prompt: "a tailor's dummy"

---
`;

const md = (preamble: string, ...opts: string[]) => `# LinkedIn drafts - 2026-10-21

> Post section A.
${preamble}

${opts.join("\n")}
pillars used: build-in-public
`;

const post = (body: unknown) =>
  new Request("http://localhost/api/linkedin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-attach-"));
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
  src = path.join(tmp, "src", "demo.mp4");
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, "fake mp4 bytes");
});

beforeEach(() => {
  spawned.length = 0;
  fs.rmSync(path.join(tmp, ".linkedin"), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, ".visuals"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the _Video:_ declaration", () => {
  it("an option's own line attaches to that option only, and never reaches the post text", () => {
    const d = parseDraft(md("", option(1, "_Video:_ /abs/demo.mp4"), option(2)));
    expect(d.video).toBe("");
    expect(d.options.map((o) => o.video)).toEqual(["/abs/demo.mp4", ""]);
    const o = d.options[0];
    expect(o.parsed).toBe(true);
    expect(o.repostCaption).toBe("Caption 1.");
    expect(o.why).toBe("concrete.");
    for (const field of [o.companyPost, o.repostCaption, o.firstComment, o.visual]) expect(field).not.toMatch(/_Video:_/);
    // A post sentence that starts with "Video:" is text, not a declaration.
    expect(o.companyPost).toContain("Video: this sentence is part of the post");
  });

  it("a batch line before the first option attaches to every option without its own", () => {
    const d = parseDraft(md("> _Video:_ /abs/batch.mp4", option(1), option(2, "_Video:_ /abs/own.mp4")));
    expect(d.video).toBe("/abs/batch.mp4");
    expect(d.instruction).not.toMatch(/Video/);
    expect(d.options.map((o) => o.video)).toEqual(["/abs/batch.mp4", "/abs/own.mp4"]);
  });

  it("no line, no video", () => {
    expect(parseDraft(md("", option(1))).options[0].video).toBe("");
  });
});

describe("attachVideoError / attachVideo", () => {
  it("accepts an absolute, existing .mp4 under the cap", async () => {
    const { attachVideoError } = await import("@/lib/linkedinQueue");
    expect(attachVideoError(src)).toBeNull();
  });

  it("refuses a relative path, a wrong extension, a missing file, a directory, an empty file and one over the cap", async () => {
    const { attachVideoError, ATTACH_MAX_BYTES } = await import("@/lib/linkedinQueue");
    expect(attachVideoError("src/demo.mp4")).toMatch(/absolute/);
    const mov = path.join(tmp, "src", "demo.mov");
    fs.writeFileSync(mov, "x");
    expect(attachVideoError(mov)).toMatch(/\.mp4/);
    expect(attachVideoError(path.join(tmp, "src", "gone.mp4"))).toMatch(/does not exist/);
    const dir = path.join(tmp, "src", "folder.mp4");
    fs.mkdirSync(dir, { recursive: true });
    expect(attachVideoError(dir)).toMatch(/not a file/);
    const empty = path.join(tmp, "src", "empty.mp4");
    fs.writeFileSync(empty, "");
    expect(attachVideoError(empty)).toMatch(/empty/);
    // A sparse file: the size is real to stat, the disk cost is nil.
    const big = path.join(tmp, "src", "big.mp4");
    const fd = fs.openSync(big, "w");
    fs.ftruncateSync(fd, ATTACH_MAX_BYTES + 1);
    fs.closeSync(fd);
    expect(attachVideoError(big)).toMatch(/over the 200 MB limit/);
    fs.rmSync(big);
  });

  it("copies (never moves) the file to candidate 5, listed next to the clip", async () => {
    const { attachVideo, imagesFor, variantImagePath, ATTACHED, VIDEO } = await import("@/lib/linkedinQueue");
    fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".visuals", "a1-v1.png"), "");
    fs.writeFileSync(path.join(tmp, ".visuals", "a1-v4.mp4"), "clip");
    expect(imagesFor("a1")).toEqual([1, VIDEO]);
    const dest = attachVideo("a1", src);
    expect(dest).toBe(variantImagePath("a1", ATTACHED));
    expect(dest).toBe(path.join(tmp, ".visuals", "a1-v5.mp4"));
    expect(fs.readFileSync(dest, "utf8")).toBe("fake mp4 bytes");
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.readFileSync(path.join(tmp, ".visuals", "a1-v4.mp4"), "utf8")).toBe("clip"); // the clip is untouched
    expect(imagesFor("a1")).toEqual([1, VIDEO, ATTACHED]);
    expect(fs.readdirSync(path.join(tmp, ".visuals")).filter((f) => f.includes("tmp"))).toEqual([]);
    expect(() => attachVideo("a2", "relative.mp4")).toThrow(/absolute/);
    expect(imagesFor("a2")).toEqual([]);
  });

  it("the board mirrors the server's candidate numbers", async () => {
    const { ATTACHED, VIDEO } = await import("@/lib/linkedinQueue");
    expect([BOARD_VIDEO, BOARD_ATTACHED]).toEqual([VIDEO, ATTACHED]);
  });
});

describe("POST /api/linkedin with a declared video", () => {
  it("queueing records attachVideo and copies the file in as candidate 5; posting 5 uses that copy", async () => {
    fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), md("", option(1, `_Video:_ ${src}`)));
    const { POST } = await import("@/app/api/linkedin/route");
    const res = await POST(post({ date: DRAFT, option: 1, mode: "personal", text: "hello" }));
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.attachVideo).toBe(src);
    const copy = path.join(tmp, ".visuals", `${item.id}-v5.mp4`);
    expect(fs.existsSync(copy)).toBe(true);
    expect(fs.existsSync(src)).toBe(true);

    const trig = await POST(post({ action: "trigger", id: item.id, image: 5 }));
    expect(trig.status).toBe(200);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, ".linkedin", `${item.id}.json`), "utf8"));
    expect(saved.asset).toBe(copy);
    expect((await POST(post({ action: "trigger", id: item.id, image: 6 }))).status).toBe(400);
  });

  it("a bad declared path refuses the queueing with a clear error, writing and starting nothing", async () => {
    fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), md("", option(1, "_Video:_ relative/demo.mp4")));
    const { POST } = await import("@/app/api/linkedin/route");
    const res = await POST(post({ date: DRAFT, option: 1, mode: "personal", text: "hello" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/absolute.*_Video:_/);
    expect(spawned).toHaveLength(0);
    expect(fs.existsSync(path.join(tmp, ".linkedin")) && fs.readdirSync(path.join(tmp, ".linkedin")).length).toBeFalsy();
  });

  it("an option without a declaration queues as before, with no candidate 5", async () => {
    fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), md("", option(1)));
    const { POST } = await import("@/app/api/linkedin/route");
    const res = await POST(post({ date: DRAFT, option: 1, mode: "personal", text: "hello" }));
    const { item } = await res.json();
    expect(item.attachVideo).toBeUndefined();
    expect(fs.existsSync(path.join(tmp, ".visuals", `${item.id}-v5.mp4`))).toBe(false);
  });
});

describe("the board's pick", () => {
  it("your video is never the default: the first image is, else nothing", () => {
    expect(defaultCandidate([1, 2, 3, 4, 5])).toBe(1);
    expect(defaultCandidate([4, 5])).toBeNull();
    expect(defaultCandidate([5])).toBeNull();
  });

  it("a click on Your video picks 5, and No image stays an explicit null", () => {
    const images = [1, 2, 3, 4, 5];
    expect(chosenCandidate(images, {}, "x")).toBe(1);
    expect(chosenCandidate(images, { x: 5 }, "x")).toBe(5);
    expect(chosenCandidate(images, { x: 4 }, "x")).toBe(4);
    expect(chosenCandidate(images, { x: null }, "x")).toBeNull();
    expect(chosenCandidate(images, { y: 5 }, "x")).toBe(1);
  });

  it("names each candidate in its error", () => {
    expect([candidateName(2), candidateName(4), candidateName(5)]).toEqual(["Image 2", "The video", "Your video"]);
  });
});
