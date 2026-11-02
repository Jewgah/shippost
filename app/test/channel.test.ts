import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-channel-"));
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: tmp } })
  );
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("channel", () => {
  it("resolveChannel: absent is linkedin, known passes, unknown is refused", async () => {
    const { resolveChannel, isChannel } = await import("@/lib/channel");
    expect(resolveChannel(undefined)).toBe("linkedin");
    expect(resolveChannel(null)).toBe("linkedin");
    expect(resolveChannel("")).toBe("linkedin");
    expect(resolveChannel("x")).toBe("x");
    expect(resolveChannel("linkedin")).toBe("linkedin");
    expect(resolveChannel("threads")).toBeNull();
    expect(isChannel("threads")).toBe(false);
  });

  it("channelPaths keeps X files in x/ and LinkedIn files in the root", async () => {
    const { channelPaths } = await import("@/lib/channel");
    const li = channelPaths("linkedin");
    const x = channelPaths("x");
    expect(li.dir).toBe(tmp);
    expect(x.dir).toBe(path.join(tmp, "x"));
    for (const k of ["picks", "rejects", "corpus", "result"] as const) {
      expect(path.dirname(li[k])).toBe(tmp);
      expect(path.dirname(x[k])).toBe(path.join(tmp, "x"));
    }
  });

  it("an X pick lands in the X corpus and picks log; LinkedIn files stay untouched", async () => {
    const { recordPick, pickedOptionsByDraftId } = await import("@/lib/voice");
    const post = "Shipped a small thing today: the queue now survives a restart."; // ~65 chars
    recordPick({ date: "2026-11-01_120000", option: 2, pillar: "lesson", topic: "queue", companyPost: post, channel: "x" });
    expect(fs.readFileSync(path.join(tmp, "x", "recent-posts.md"), "utf8")).toContain(post);
    expect(pickedOptionsByDraftId("x")).toEqual({ "2026-11-01_120000": [2] });
    expect(pickedOptionsByDraftId()).toEqual({});
    expect(fs.existsSync(path.join(tmp, "recent-posts.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".picks.jsonl"))).toBe(false);
  });

  it("listDrafts is per channel", async () => {
    const { listDrafts, readDraft } = await import("@/lib/drafts");
    fs.writeFileSync(path.join(tmp, "2026-11-01_130000.md"), "# d\n\n## Option 1 - lesson - li topic   (7/10)\n**A. Company post**\nLI body\n");
    fs.writeFileSync(path.join(tmp, "x", "2026-11-01_140000.md"), "# d\n\n## Option 1 - lesson - x topic   (7/10)\n**A. Company post**\nX body\n");
    expect(listDrafts().map((d) => d.date)).toEqual(["2026-11-01_130000"]);
    expect(listDrafts(undefined, "x").map((d) => d.date)).toEqual(["2026-11-01_140000"]);
    expect(readDraft("2026-11-01_140000")).toBeNull();
    expect(readDraft("2026-11-01_140000", "x")?.options[0].companyPost).toBe("X body");
  });
});
