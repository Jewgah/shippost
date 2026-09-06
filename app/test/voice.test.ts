import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let recentPath: string;

// A block has to look like a real post (>= 150 chars, no HTML, no merge tokens) to enter the
// corpus, so the fixtures carry a realistic body behind their distinguishing first line.
const BODY =
  " Shipping the thing beats planning the thing, and I keep relearning that every single week on real client work." +
  " The plan looked perfect on paper, the first user broke it in four minutes, and the fix took less time than the planning did.";
const post = (lead: string) => lead + BODY;

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
    expect(addRecentPosts([post("First post."), post("Second post.")])).toBe(2);
    expect(recentPostCount()).toBe(2);
    expect(fs.existsSync(recentPath)).toBe(true);
  });

  it("dedups exact repeats", async () => {
    const { addRecentPosts } = await import("@/lib/voice");
    addRecentPosts([post("First post.")]);
    expect(addRecentPosts([post("First post.")])).toBe(0);
  });

  it("dedups across whitespace + case differences", async () => {
    const { addRecentPosts } = await import("@/lib/voice");
    addRecentPosts([post("First post.")]);
    expect(addRecentPosts([post("FIRST   post.").toUpperCase()])).toBe(0);
  });

  it("caps the stored file (STORE_CAP)", async () => {
    const { addRecentPosts, recentPostCount } = await import("@/lib/voice");
    const many = Array.from({ length: 120 }, (_, i) => post(`unique post number ${i}.`));
    addRecentPosts(many);
    expect(recentPostCount()).toBeLessThanOrEqual(100);
    expect(recentPostCount()).toBeGreaterThan(0);
  });

  it("drops what does not look like a post: too short, HTML, merge tokens (the DM shapes)", async () => {
    const { addRecentPosts, recentPostCount } = await import("@/lib/voice");
    const dms = [
      "Oui",
      "Merci, je regarde ça et je reviens vers vous.",
      `<p class="spinmail-quill-editor__spin-break">Hi there,</p><p>${BODY}</p><p>${BODY}</p>`,
      `Hi %FIRSTNAME%, I noticed you lead the team at your company.${BODY}${BODY}`,
    ];
    expect(addRecentPosts([...dms, post("A real post.")])).toBe(1);
    expect(recentPostCount()).toBe(1);
    expect(fs.readFileSync(recentPath, "utf8")).toContain("A real post.");
  });
});

describe("voice.looksLikePost", () => {
  it("accepts a real-length post, including a 'n<m' comparison in prose", async () => {
    const { looksLikePost } = await import("@/lib/voice");
    expect(looksLikePost(post("If n<m the loop exits early."))).toBe(true);
  });

  it("rejects a real HTML tag, a merge token, and a short block", async () => {
    const { looksLikePost } = await import("@/lib/voice");
    expect(looksLikePost(post("Line<br>break."))).toBe(false);
    expect(looksLikePost(post("Hello %FIRST_NAME%,"))).toBe(false);
    expect(looksLikePost("short")).toBe(false);
  });
});
