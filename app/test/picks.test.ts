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

  it("cadence dedupes the same (date, option) logged twice, keeping the EARLIEST ts", async () => {
    // Regression: one pick was logged on 06-10 and again on 06-19; the cadence counted two
    // posts and reported the 19th as the last posting day.
    const { cadenceFromPicks, pickData } = await import("@/lib/voice");
    const first = "2026-06-10T23:54:46.194Z";
    const again = "2026-06-19T15:14:17.595Z";
    const picks = [
      { date: "2026-06-11_015716", option: 1, ts: first },
      { date: "2026-06-19_120000", option: 2, ts: again }, // a different pick on the 19th stays counted
      { date: "2026-06-11_015716", option: 1, ts: again }, // the duplicate
    ];
    const now = Date.parse("2026-06-21T00:00:00.000Z");
    const c = cadenceFromPicks(picks, now);
    expect(c.total).toBe(2);
    expect(c.lastPostedAt).toBe(again);
    // the duplicate alone must not move "last posted" to the re-log day
    const dupOnly = cadenceFromPicks([picks[0], picks[2]], now);
    expect(dupOnly.total).toBe(1);
    expect(dupOnly.lastPostedAt).toBe(first);
    // same through the file-backed path the home page uses
    fs.writeFileSync(picksPath, picks.map((p) => JSON.stringify({ ...p, pillar: "x", topic: "y" })).join("\n") + "\n");
    expect(pickData().cadence.total).toBe(2);
    expect(pickData().pickedByDraftId).toEqual({ "2026-06-11_015716": [1], "2026-06-19_120000": [2] });
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
