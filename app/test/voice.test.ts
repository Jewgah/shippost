import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let recentPath: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-voice-"));
  const cfg = {
    author: { name: "T" },
    brand: { name: "B" },
    scrub: {},
    output: {
      draftsDir: tmp,
      recentPostsFile: "recent-posts.md",
      voiceSampleFile: "voice-sample.md",
      picksLogFile: ".picks.jsonl",
    },
    app: {},
  };
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify(cfg));
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  recentPath = path.join(tmp, "recent-posts.md");
});

beforeEach(() => {
  if (fs.existsSync(recentPath)) fs.unlinkSync(recentPath);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("voice.addRecentPosts", () => {
  it("adds new posts and counts them", async () => {
    const { addRecentPosts, recentPostCount } = await import("@/lib/voice");
    expect(addRecentPosts(["First post", "Second post"])).toBe(2);
    expect(recentPostCount()).toBe(2);
    expect(fs.existsSync(recentPath)).toBe(true);
  });

  it("dedups exact repeats", async () => {
    const { addRecentPosts } = await import("@/lib/voice");
    addRecentPosts(["First post"]);
    expect(addRecentPosts(["First post"])).toBe(0);
  });

  it("dedups across whitespace + case differences", async () => {
    const { addRecentPosts } = await import("@/lib/voice");
    addRecentPosts(["First post"]);
    expect(addRecentPosts(["FIRST   post"])).toBe(0);
  });

  it("caps the stored file (STORE_CAP)", async () => {
    const { addRecentPosts, recentPostCount } = await import("@/lib/voice");
    const many = Array.from({ length: 120 }, (_, i) => `unique post number ${i}`);
    addRecentPosts(many);
    expect(recentPostCount()).toBeLessThanOrEqual(100);
    expect(recentPostCount()).toBeGreaterThan(0);
  });
});
