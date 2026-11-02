import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
const ID = "2031-04-01_100000";
const XID = "2031-04-02_100000";
const X_MD = `# X drafts

## ⭐ Option 1 - lesson - short one   (8/10)
**A. Company post**
Short post, no link.

**B. Thread**
2/ Second.

3/ Third.

**C. First comment**
https://example.com/p
`;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-xroutes-"));
  fs.mkdirSync(path.join(tmp, "x"));
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: tmp } }));
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  fs.writeFileSync(path.join(tmp, `${ID}.md`), "# d\n\n## Option 1 - lesson - li   (7/10)\n**A. Company post**\nLI\n");
  fs.writeFileSync(path.join(tmp, "x", `${XID}.md`), X_MD);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const get = (url: string) => new Request(`http://localhost${url}`);
const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("GET /api/drafts", () => {
  it("lists per channel", async () => {
    const { GET } = await import("@/app/api/drafts/route");
    const ids = async (q: string) => ((await (await GET(get(`/api/drafts${q}`))).json()) as { drafts: { date: string }[] }).drafts.map((d) => d.date);
    expect(await ids("")).toEqual([ID]);
    expect(await ids("?channel=linkedin")).toEqual([ID]);
    expect(await ids("?channel=x")).toEqual([XID]);
  });
  it("400 on an unknown channel", async () => {
    const { GET } = await import("@/app/api/drafts/route");
    expect((await GET(get("/api/drafts?channel=threads"))).status).toBe(400);
  });
});

describe("GET /api/drafts/[date]", () => {
  const call = async (id: string, q: string) => {
    const { GET } = await import("@/app/api/drafts/[date]/route");
    return GET(get(`/api/drafts/${id}${q}`), { params: Promise.resolve({ date: id }) });
  };
  it("reads x/ with the channel, 404 without it, parses the thread", async () => {
    expect((await call(XID, "")).status).toBe(404);
    const res = await call(XID, "?channel=x");
    expect(res.status).toBe(200);
    const o = ((await res.json()) as { draft: { options: { companyPost: string; repostCaption: string; firstComment: string }[] } }).draft.options[0];
    expect(o.companyPost).toBe("Short post, no link.");
    expect(o.repostCaption).toContain("2/ Second.");
    expect(o.firstComment).toBe("https://example.com/p");
  });
  it("400 on an unknown channel", async () => {
    expect((await call(XID, "?channel=threads")).status).toBe(400);
  });
});

describe("POST /api/pick", () => {
  it("channel x logs inside x/ and leaves the root files alone; LinkedIn never lands in x/", async () => {
    const { POST } = await import("@/app/api/pick/route");
    const xPost = "A 75-char post about shipping the queue fix, short and concrete here.";
    expect(xPost.length).toBeGreaterThan(40);
    expect(xPost.length).toBeLessThan(150);
    const r1 = await POST(post("/api/pick", { date: XID, option: 1, companyPost: xPost, channel: "x" }));
    expect(r1.status).toBe(200);
    expect(fs.readFileSync(path.join(tmp, "x", ".picks.jsonl"), "utf8")).toContain(XID);
    expect(fs.readFileSync(path.join(tmp, "x", "recent-posts.md"), "utf8")).toContain(xPost);
    expect(fs.existsSync(path.join(tmp, ".picks.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "recent-posts.md"))).toBe(false);

    const long = "L".repeat(200);
    await POST(post("/api/pick", { date: ID, option: 1, companyPost: long }));
    expect(fs.readFileSync(path.join(tmp, ".picks.jsonl"), "utf8")).toContain(ID);
    expect(fs.readFileSync(path.join(tmp, "x", ".picks.jsonl"), "utf8")).not.toContain(ID);
    expect(fs.readFileSync(path.join(tmp, "x", "recent-posts.md"), "utf8")).not.toContain(long);
  });
  it("400 on an unknown channel", async () => {
    const { POST } = await import("@/app/api/pick/route");
    expect((await POST(post("/api/pick", { date: XID, option: 1, companyPost: "x".repeat(60), channel: "threads" }))).status).toBe(400);
  });
});
