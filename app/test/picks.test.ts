import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let picksPath: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-picks-"));
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
  picksPath = path.join(tmp, ".picks.jsonl");
});

beforeEach(() => {
  if (fs.existsSync(picksPath)) fs.unlinkSync(picksPath);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const entry = (date: string, option: number) =>
  JSON.stringify({ ts: "2026-06-01T00:00:00.000Z", date, option, pillar: "x", topic: "y" });

describe("voice.pickedOptionsByDraftId", () => {
  it("returns {} when the log doesn't exist", async () => {
    const { pickedOptionsByDraftId } = await import("@/lib/voice");
    expect(pickedOptionsByDraftId()).toEqual({});
  });

  it("groups option numbers under their EXACT draft id (same-day runs stay separate)", async () => {
    fs.writeFileSync(
      picksPath,
      [entry("2026-05-31_185437", 1), entry("2026-05-31_190218", 3), entry("2026-05-31", 2)].join("\n") + "\n"
    );
    const { pickedOptionsByDraftId } = await import("@/lib/voice");
    expect(pickedOptionsByDraftId()).toEqual({
      "2026-05-31_185437": [1],
      "2026-05-31_190218": [3],
      "2026-05-31": [2],
    });
  });

  it("dedupes repeated picks of the same option", async () => {
    fs.writeFileSync(picksPath, [entry("2026-06-01_094222", 2), entry("2026-06-01_094222", 2)].join("\n") + "\n");
    const { pickedOptionsByDraftId } = await import("@/lib/voice");
    expect(pickedOptionsByDraftId()).toEqual({ "2026-06-01_094222": [2] });
  });

  it("tolerates blank and malformed/partial lines", async () => {
    fs.writeFileSync(
      picksPath,
      ["", entry("2026-06-01_094222", 1), "not json", '{"date":"2026-06-02","option":', "  "].join("\n")
    );
    const { pickedOptionsByDraftId } = await import("@/lib/voice");
    expect(pickedOptionsByDraftId()).toEqual({ "2026-06-01_094222": [1] });
  });

  it("tolerates valid-JSON-but-non-object lines (null, scalar, array) without throwing", async () => {
    // JSON.parse succeeds on these, so they get past the try/catch — the reader must still
    // not crash when it reaches the property checks.
    fs.writeFileSync(
      picksPath,
      ["null", "123", '"a string"', "[1,2,3]", entry("2026-06-01_094222", 4)].join("\n")
    );
    const { pickedOptionsByDraftId } = await import("@/lib/voice");
    expect(() => pickedOptionsByDraftId()).not.toThrow();
    expect(pickedOptionsByDraftId()).toEqual({ "2026-06-01_094222": [4] });
  });

  it("caps the picks log at PICKS_CAP so it can't grow unbounded", async () => {
    const { recordPick, PICKS_CAP } = await import("@/lib/voice");
    for (let i = 0; i < PICKS_CAP + 10; i++) {
      // companyPost "" skips the voice-corpus write so this exercises only the picks-log cap
      recordPick({ date: "2026-06-01_000000", option: i, pillar: "x", topic: "y", companyPost: "" });
    }
    const lines = fs.readFileSync(picksPath, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(PICKS_CAP);
  });
});
