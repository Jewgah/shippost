import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Acceptance check (loopit gentle-twirling-oasis): the /api/linkedin queue route.
// - Trigger posts ONLY the next item in the queue (FIFO by createdAt): a stale page asking for any
//   other id is refused with 409, and nothing is spawned.
// - GET records a `posted` item's pick (cadence bar + voice corpus) exactly once, the first time the
//   app sees it, and marks the item `picked: true`.
// Child processes are stubbed: this test must never start a browser or a renderer.

const spawned: string[] = [];
const fakeChild = () => ({ unref() {}, on() { return this; }, once() { return this; }, pid: 0, stdout: null, stderr: null });
vi.mock("node:child_process", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const stub = (name: string) => (...args: unknown[]) => {
    spawned.push(`${name} ${JSON.stringify(args).slice(0, 200)}`);
    return fakeChild();
  };
  const over = { spawn: stub("spawn"), fork: stub("fork"), exec: stub("exec"), execFile: stub("execFile") };
  return { ...actual, ...over, default: { ...(actual.default as object), ...over } };
});
vi.mock("child_process", async () => await import("node:child_process"));

const DRAFT = "2026-10-01_120000";
const DRAFT_MD = `# LinkedIn drafts - 2026-10-01 · 3 options

## ⭐ Option 1 - build-in-public - first queued post   (9.0/10)
**A. Company post**
First post body.

_Why it works:_ test.
_Suggested visuals:_
1. screenshot (screenshot - no AI)

---
## Option 2 - build-in-public - second queued post   (8.0/10)
**A. Company post**
Second post body.

_Why it works:_ test.
_Suggested visuals:_
1. screenshot (screenshot - no AI)

---
## Option 3 - smart-ai-workflow - already posted   (7.0/10)
**A. Company post**
Posted body.

_Why it works:_ test.
_Suggested visuals:_
1. screenshot (screenshot - no AI)

---
`;

let tmp: string;
let qdir: string;

const item = (id: string, option: number, status: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  draft: DRAFT,
  option,
  topic: `topic ${option}`,
  mode: "personal",
  text: `Post body ${option}`,
  repost: "",
  status,
  createdAt,
  ...extra,
});
const writeItem = (o: ReturnType<typeof item>) => fs.writeFileSync(path.join(qdir, `${o.id}.json`), JSON.stringify(o));
const readItem = (id: string) => JSON.parse(fs.readFileSync(path.join(qdir, `${id}.json`), "utf8"));
const picks = () => {
  const p = path.join(tmp, ".picks.jsonl");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

type Handler = (req: Request) => Promise<Response>;
const loadRoute = async (): Promise<{ GET?: Handler; POST?: Handler }> => {
  try {
    return (await import("@/app/api/linkedin/route")) as { GET?: Handler; POST?: Handler };
  } catch (e) {
    console.error("linkedin route did not load:", String(e).slice(0, 300));
    return {};
  }
};
const URL_BASE = "http://localhost:3030/api/linkedin";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-lqueue-"));
  qdir = path.join(tmp, ".linkedin");
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({
      author: { name: "T" },
      brand: { name: "B", linkedinPageUrl: "https://www.linkedin.com/company/example-test/" },
      scrub: {},
      output: {
        draftsDir: tmp,
        recentPostsFile: "recent-posts.md",
        voiceSampleFile: "voice-sample.md",
        picksLogFile: ".picks.jsonl",
      },
      app: {},
    })
  );
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  // Belt and braces, in case a child slips past the stub: no engine to start, nothing local.
  process.env.SHIPPOST_COMFY_URL = "http://comfy.invalid:8188";
  process.env.SHIPPOST_COMFY_DIR = path.join(tmp, "no-comfy-here");
  fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), DRAFT_MD);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  spawned.length = 0;
  fs.rmSync(qdir, { recursive: true, force: true });
  fs.mkdirSync(qdir, { recursive: true });
  fs.rmSync(path.join(tmp, ".picks.jsonl"), { force: true });
});

describe("/api/linkedin queue route", () => {
  it("refuses to trigger an item that is not next in the queue (409), and spawns nothing", async () => {
    writeItem(item("qfirst01", 1, "queued", "2026-10-01T10:00:00.000Z"));
    writeItem(item("qsecond02", 2, "queued", "2026-10-01T11:00:00.000Z"));
    const { POST } = await loadRoute();
    const req = new Request(URL_BASE, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ action: "trigger", id: "qsecond02", image: null }),
    });
    const res = POST ? await POST(req) : null;
    expect(res?.status, "an out-of-order trigger must be refused with 409").toBe(409);
    expect(spawned, "an out-of-order trigger must not spawn the poster").toEqual([]);
    expect(readItem("qsecond02").status).toBe("queued");
    expect(readItem("qfirst01").status).toBe("queued");
  });

  it("GET records a posted item's pick exactly once and marks it picked", async () => {
    writeItem(item("qposted03", 3, "posted", "2026-10-01T09:00:00.000Z", { postedAt: "2026-10-01T09:05:00.000Z" }));
    writeItem(item("qfirst01", 1, "queued", "2026-10-01T10:00:00.000Z"));
    const { GET } = await loadRoute();
    const get = () => (GET ? GET(new Request(URL_BASE)) : Promise.resolve(null));

    const r1 = await get();
    expect(r1?.status, "GET /api/linkedin must answer 200 with the queue").toBe(200);
    const after1 = picks();
    expect(
      after1.map((p) => `${p.date}#${p.option}`),
      "GET must record the posted item's pick in the picks log"
    ).toEqual([`${DRAFT}#3`]);
    expect(readItem("qposted03").picked, "the posted item must be marked picked: true").toBe(true);

    await get();
    expect(picks().length, "a second GET must not record the same pick again").toBe(1);
    // a queued item is never recorded as a pick
    expect(readItem("qfirst01").picked ?? false).toBe(false);
    expect(spawned, "GET must not spawn anything").toEqual([]);
  });
});
