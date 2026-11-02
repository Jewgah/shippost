import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Acceptance check (loopit starry-scribbling-bear): the channel parameter through the API.
// X drafts live in <draftsDir>/x/ and only the X channel sees them; an X draft's `**B. Thread**`
// section parses as the thread; an X "I posted this" lands in x/ (picks log and X corpus, with a
// floor low enough for a short X post) and never touches the LinkedIn files; an unknown channel
// is a 400. Every LinkedIn assertion here is a positive control: it passes today and must still.

type Handler = (req: Request, ctx?: unknown) => Promise<Response>;
const BASE = "http://localhost:3030";
const LI_ID = "2031-02-01_090000";
const X_ID = "2031-02-01_120000";

const LI_MD = `# LinkedIn drafts - 2031-02-01 · 1 option

## ⭐ Option 1 - build-in-public - the linkedin one   (9.0/10)
**A. Company post**
LinkedIn company body.

**B. Repost caption (your profile)**
LinkedIn repost caption.

_Why it works:_ test.
_Suggested visuals:_
1. screenshot (screenshot - no AI)

---
`;

const X_MD = `# X drafts - 2031-02-01 · 1 option

## ⭐ Option 1 - build-in-public - shipping the x tab   (9.0/10)
**A. Company post**
Shipped an X tab next to LinkedIn today. Same engine, short posts.

**B. Thread**
2/ The LinkedIn side did not change at all.

3/ Links go in the first reply.

**C. First comment**
https://example.com/x-tab

_Why it works:_ test.
_Suggested visuals:_
1. screenshot (screenshot - no AI)

---
`;

// 70-odd chars: above an X floor of 40, below the LinkedIn 150 floor.
const X_POSTED = "Posted on X: the X tab ships drafts that fit in one post, links in replies.";
const LI_POSTED =
  "Posted on LinkedIn: a long-form post about shipping a second channel without touching the first one, " +
  "with enough words in it to clear the voice corpus floor that LinkedIn posts have always had.";

let tmp: string;
let xDir: string;

const json = (body: unknown) =>
  ({ method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}
const anyXFileContains = (s: string) => filesUnder(xDir).some((f) => fs.readFileSync(f, "utf8").includes(s));
const rootFile = (name: string) => {
  const p = path.join(tmp, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-x-channel-"));
  xDir = path.join(tmp, "x");
  fs.mkdirSync(xDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, `${LI_ID}.md`), LI_MD);
  fs.writeFileSync(path.join(xDir, `${X_ID}.md`), X_MD);
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({
      author: { name: "T" },
      brand: { name: "B" },
      scrub: {},
      output: { draftsDir: tmp, recentPostsFile: "recent-posts.md", voiceSampleFile: "voice-sample.md", picksLogFile: ".picks.jsonl" },
      app: {},
    })
  );
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("GET /api/drafts with a channel", () => {
  it("lists only LinkedIn drafts by default and only X drafts for ?channel=x; an unknown channel is a 400", async () => {
    const { GET } = (await import("@/app/api/drafts/route")) as unknown as { GET: Handler };
    const ids = async (url: string) => {
      const res = await GET(new Request(url));
      return ((await res.json()).drafts ?? []).map((d: { date: string }) => d.date);
    };
    expect(await ids(`${BASE}/api/drafts`), "the LinkedIn list must not change").toEqual([LI_ID]);
    expect(await ids(`${BASE}/api/drafts?channel=linkedin`)).toEqual([LI_ID]);
    expect(await ids(`${BASE}/api/drafts?channel=x`), "X-LIST-WRONG: the X tab must list only X drafts").toEqual([X_ID]);
    const bad = await GET(new Request(`${BASE}/api/drafts?channel=threads`));
    expect(bad.status, "an unknown channel must be refused with 400").toBe(400);
  });
});

describe("GET /api/drafts/[date] with a channel", () => {
  it("reads an X draft from x/, its B. Thread as the thread, and LinkedIn never sees it", async () => {
    const { GET } = (await import("@/app/api/drafts/[date]/route")) as unknown as { GET: Handler };
    const get = (date: string, qs = "") =>
      GET(new Request(`${BASE}/api/drafts/${date}${qs}`), { params: Promise.resolve({ date }) });

    const li = await get(LI_ID);
    expect(li.status).toBe(200);
    const liOpt = (await li.json()).draft.options[0];
    expect(liOpt.companyPost).toContain("LinkedIn company body.");
    expect(liOpt.repostCaption).toContain("LinkedIn repost caption.");

    expect((await get(X_ID)).status, "the LinkedIn channel must not see an X draft").toBe(404);

    const x = await get(X_ID, "?channel=x");
    expect(x.status, "X-READ-WRONG: an X draft must be readable with ?channel=x").toBe(200);
    const o = (await x.json()).draft.options[0];
    expect(o.companyPost).toContain("Shipped an X tab next to LinkedIn today.");
    expect(o.companyPost, "the main post must stop at the B. Thread header").not.toContain("2/");
    expect(o.repostCaption, "B. Thread must parse as section B").toContain("2/ The LinkedIn side did not change at all.");
    expect(o.repostCaption).toContain("3/ Links go in the first reply.");
    expect(o.repostCaption).not.toContain("https://example.com/x-tab");
    expect(o.firstComment).toContain("https://example.com/x-tab");

    const bad = await get(X_ID, "?channel=threads");
    expect(bad.status, "an unknown channel must be refused with 400").toBe(400);
  });
});

describe("POST /api/pick with a channel", () => {
  it("an X pick goes to x/ (picks + X corpus), a LinkedIn pick to the root, and neither crosses over", async () => {
    const { POST } = (await import("@/app/api/pick/route")) as unknown as { POST: Handler };

    const li = await POST(new Request(`${BASE}/api/pick`, json({ date: LI_ID, option: 1, pillar: "p", topic: "t", companyPost: LI_POSTED })));
    expect(li.status).toBe(200);
    expect(rootFile(".picks.jsonl"), "positive control: a LinkedIn pick is logged in the root").toContain(LI_ID);
    expect(rootFile("recent-posts.md"), "positive control: a LinkedIn pick feeds the LinkedIn corpus").toContain("Posted on LinkedIn");

    const x = await POST(new Request(`${BASE}/api/pick`, json({ date: X_ID, option: 1, pillar: "p", topic: "t", companyPost: X_POSTED, channel: "x" })));
    expect(x.status).toBe(200);
    expect(anyXFileContains(X_ID), "X-PICK-WRONG: the X pick must be logged inside x/").toBe(true);
    expect(anyXFileContains(X_POSTED), "the X post must land in the X corpus inside x/ (floor below 150)").toBe(true);
    expect(rootFile(".picks.jsonl"), "the LinkedIn picks log must not get the X pick").not.toContain(X_ID);
    expect(rootFile("recent-posts.md"), "the LinkedIn corpus must not get the X post").not.toContain("Posted on X");
    expect(anyXFileContains("Posted on LinkedIn"), "the X files must not get the LinkedIn post").toBe(false);

    const bad = await POST(new Request(`${BASE}/api/pick`, json({ date: X_ID, option: 2, pillar: "p", topic: "t", companyPost: X_POSTED, channel: "threads" })));
    expect(bad.status, "an unknown channel must be refused with 400").toBe(400);
  });
});
