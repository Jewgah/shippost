import { describe, it, expect } from "vitest";
import { clipProps, fallbackScript, moodFor, parseScript, pickTrack, sentences } from "../lib/clipProps";

const BRAND = { brandId: "hakolkal", kicker: "HakolKal", cta: "jordanperez.dev" };

describe("parseScript", () => {
  it("reads the JSON out of a chatty answer and clamps every field to its budget", () => {
    const raw = `Here you go:\n{"hook": "Your AI trusts notes that went stale \u2014 silently", "points": [{"title": "Context ages", "detail": "A fact true in June is a quiet lie by October."}, {"title": "${"x".repeat(60)}", "detail": "d"}, {"title": "c", "detail": "e"}, {"title": "fourth", "detail": "dropped"}], "takeaway": "Audit every claim before the model reads it."}`;
    const s = parseScript(raw)!;
    expect(s.hook).toBe("Your AI trusts notes that went stale, silently");
    expect(s.points).toHaveLength(3);
    expect(s.points[1].title.length).toBeLessThanOrEqual(40);
    expect(s.takeaway).toBe("Audit every claim before the model reads it.");
  });

  it("returns null for anything unusable", () => {
    expect(parseScript("")).toBeNull();
    expect(parseScript("{not json}")).toBeNull();
    expect(parseScript('{"hook": "h", "points": [], "takeaway": "t"}')).toBeNull();
    expect(parseScript('{"hook": "h", "points": [{"title": "t", "detail": ""}], "takeaway": "  "}')).toBeNull();
  });
});

describe("fallbackScript", () => {
  it("never leaves the points empty and keeps every field within budget", () => {
    const s = fallbackScript({ text: "This opening sentence keeps going well past the seventy character limit of a hook.", topic: "a topic" });
    expect(s.hook.length).toBeLessThanOrEqual(70);
    expect(s.points).toEqual([{ title: "a topic", detail: "" }]);
  });

  it("drops hashtag lines, inline hashtags and links", () => {
    expect(sentences("Read it. https://x.dev/a\n#AI #Ops")).toEqual(["Read it."]);
    expect(sentences("Ship it. #AI #DevOps")).toEqual(["Ship it."]);
  });

  it("a one or two sentence post still gets a hook, a point and a takeaway", () => {
    const one = fallbackScript({ text: "One sentence only.", topic: "topic" });
    expect(one).toEqual({ hook: "One sentence only.", points: [{ title: "topic", detail: "" }], takeaway: "One sentence only." });
    const two = fallbackScript({ text: "First. Second sentence here.", topic: "topic" });
    expect(two).toEqual({ hook: "First.", points: [{ title: "Second sentence here.", detail: "" }], takeaway: "topic" });
    const many = fallbackScript({ text: "A. B is a sentence that runs well past the forty character title budget. C. D.", topic: "t" });
    expect(many.points.map((p) => p.title)).toEqual(["B is a sentence that runs well past…", "C."]);
    expect(many.takeaway).toBe("D.");
  });
});

describe("moodFor", () => {
  it("maps the pillars the engine actually emits", () => {
    expect(["client-outcome", "lesson"].map(moodFor)).toEqual(["warm", "warm"]);
    expect(["cool-repo", "build-in-public"].map(moodFor)).toEqual(["bright", "bright"]);
    expect(["smart-ai-workflow", "new-pillar", undefined].map(moodFor)).toEqual(["focus", "focus", "focus"]);
  });
});

describe("pickTrack", () => {
  const files = ["focus-1.mp3", "focus-2.mp3", "warm-1.mp3", "notes.txt", "._bright-1.mp3"];
  it("picks from the pillar's mood, the same track every time for the same post", () => {
    const a = pickTrack(files, "smart-ai-workflow", "id-1");
    expect(a).toMatch(/^focus-/);
    expect(pickTrack(files, "smart-ai-workflow", "id-1")).toBe(a);
    expect(pickTrack(files, "lesson", "id-1")).toBe("warm-1.mp3");
  });
  it("falls back to any real track (never a macOS ._ stub), and to none", () => {
    for (const id of ["x", "y", "z", "w"]) expect(pickTrack(files, "build-in-public", id)).toMatch(/^(focus|warm)-\d\.mp3$/);
    expect(pickTrack(["notes.txt", "._focus-1.mp3"], "lesson", "x")).toBeNull();
  });
});

it("clipProps fills the PostClip contract", () => {
  const p = clipProps({ hook: "h", points: [{ title: "t", detail: "d" }], takeaway: "k" }, BRAND, "hakolkal/queue/x.png", "hakolkal/music/focus-1.mp3");
  expect(p).toEqual({
    brandId: "hakolkal",
    kicker: "HakolKal",
    hook: "h",
    image: "hakolkal/queue/x.png",
    points: [{ title: "t", detail: "d" }],
    takeaway: "k",
    cta: "jordanperez.dev",
    music: { src: "hakolkal/music/focus-1.mp3" },
    formatWidth: 1080,
    formatHeight: 1350,
  });
});
