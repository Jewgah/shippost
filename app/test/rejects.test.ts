import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let rejectsPath: string;
let picksPath: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-rejects-"));
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
  rejectsPath = path.join(tmp, ".rejects.jsonl"); // fixed internal filename
  picksPath = path.join(tmp, ".picks.jsonl");
});

beforeEach(() => {
  for (const f of [rejectsPath, picksPath]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("voice.recordReject / rejectedOptionsByDraftId", () => {
  it("logs a rejection and reads it back grouped by exact draft id", async () => {
    const { recordReject, rejectedOptionsByDraftId } = await import("@/lib/voice");
    recordReject({ date: "2026-06-01_094222", option: 3, pillar: "lesson", topic: "reach for AI last" });
    expect(rejectedOptionsByDraftId()).toEqual({ "2026-06-01_094222": [3] });
  });

  it("dedupes repeated rejects of the same option", async () => {
    const { recordReject, rejectedOptionsByDraftId } = await import("@/lib/voice");
    recordReject({ date: "2026-06-01_094222", option: 2, pillar: "x", topic: "y" });
    recordReject({ date: "2026-06-01_094222", option: 2, pillar: "x", topic: "y" });
    expect(rejectedOptionsByDraftId()).toEqual({ "2026-06-01_094222": [2] });
  });

  it("keeps the rejects log separate from the picks log", async () => {
    const { recordReject, recordPick, rejectedOptionsByDraftId, pickedOptionsByDraftId } = await import("@/lib/voice");
    recordReject({ date: "2026-06-01", option: 1, pillar: "x", topic: "y" });
    recordPick({ date: "2026-06-01", option: 2, pillar: "x", topic: "y", companyPost: "" });
    expect(rejectedOptionsByDraftId()).toEqual({ "2026-06-01": [1] });
    expect(pickedOptionsByDraftId()).toEqual({ "2026-06-01": [2] });
  });

  it("returns {} when nothing has been rejected", async () => {
    const { rejectedOptionsByDraftId } = await import("@/lib/voice");
    expect(rejectedOptionsByDraftId()).toEqual({});
  });

  it("tolerates blank, malformed, and non-object lines in the rejects log", async () => {
    fs.writeFileSync(
      rejectsPath,
      [
        "",
        "null",
        "not json",
        '{"date":"2026-06-01_094222","option":5,"pillar":"x","topic":"y"}',
        "  ",
      ].join("\n")
    );
    const { rejectedOptionsByDraftId } = await import("@/lib/voice");
    expect(() => rejectedOptionsByDraftId()).not.toThrow();
    expect(rejectedOptionsByDraftId()).toEqual({ "2026-06-01_094222": [5] });
  });
});
