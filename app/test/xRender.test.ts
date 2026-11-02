import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

// engine/render-variants.mjs with a real spawn and the real render-visual.mjs, against a fake
// ComfyUI on 127.0.0.1 that records each graph it is sent and answers with a tiny PNG.
const sharp = createRequire(__filename)("sharp");
const script = path.resolve(__dirname, "..", "..", "engine", "render-variants.mjs");
const DRAFT = "2026-11-02_120000";
const ID = "2026-11-02_120000-o1-abc123";
const DRAFT_MD = `# X drafts - 2026-11-02 · 1 option

## ⭐ Option 1 - build-in-public - wide shot   (9.0/10)
**A. Company post**
A post for X.

_Why it works:_ test.
_Suggested visuals:_
1. a lighthouse keeper watching agents - AI prompt: "a lighthouse keeper at dusk, wide 16:9 landscape composition"

---
`;

let server: http.Server;
let base: string;
let png: Buffer;
let latents: Array<[number, number]>;
let tmp: string;

beforeAll(async () => {
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  let n = 0;
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/system_stats") return res.end("{}");
    if (url === "/prompt" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const g = JSON.parse(body).prompt;
        latents.push([g["3"].inputs.width, g["3"].inputs.height]);
        res.end(JSON.stringify({ prompt_id: `p${++n}` }));
      });
      return;
    }
    if (url.startsWith("/history/")) {
      const id = url.slice("/history/".length);
      return res.end(JSON.stringify({ [id]: { outputs: { "7": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } } } }));
    }
    if (url.startsWith("/view")) {
      res.setHeader("content-type", "image/png");
      return res.end(png);
    }
    if (url === "/free") return res.end("{}");
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  latents = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-xrender-"));
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ output: { draftsDir: tmp } }));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const runJob = (...extra: string[]) =>
  new Promise<number | null>((res) => {
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--job", ID, ...extra], {
      env: { ...process.env, SHIPPOST_CONFIG: path.join(tmp, "config.json"), SHIPPOST_COMFY_URL: base },
      stdio: "ignore",
    });
    child.on("close", res);
  });

const item = { id: ID, draft: DRAFT, option: 1, topic: "wide shot", mode: "personal", text: "A post for X.", repost: "", status: "queued", createdAt: "2026-11-02T12:00:00.000Z" };
const size = async (f: string) => {
  const m = await sharp(f).metadata();
  return [m.width, m.height];
};

describe("render-variants.mjs --channel x", () => {
  it("renders the 3 candidates at 1600x900 from a 16:9 latent into x/.visuals, and nothing outside x/", async () => {
    fs.mkdirSync(path.join(tmp, "x", ".queue"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "x", `${DRAFT}.md`), DRAFT_MD);
    fs.writeFileSync(path.join(tmp, "x", ".queue", `${ID}.json`), JSON.stringify({ ...item, channel: "x", thread: [], comment: "" }));

    expect(await runJob("--channel", "x")).toBe(0);
    expect(latents).toEqual([[1536, 864], [1536, 864], [1536, 864]]);
    for (const v of [1, 2, 3]) expect(await size(path.join(tmp, "x", ".visuals", `${ID}-v${v}.png`))).toEqual([1600, 900]);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, "x", ".queue", `${ID}.render.json`), "utf8"))).toEqual({ state: "done", done: 3, total: 3 });
    expect(fs.readdirSync(path.join(tmp, "x", ".visuals")).filter((f) => f.includes("card"))).toEqual([]);
    expect(fs.existsSync(path.join(tmp, ".visuals"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".linkedin"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".rendering"))).toBe(false);
  }, 60_000);

  it("without --channel, LinkedIn still renders 1080x1350 from the 1088x1360 latent, in the root folders", async () => {
    fs.mkdirSync(path.join(tmp, ".linkedin"), { recursive: true });
    fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), DRAFT_MD);
    fs.writeFileSync(path.join(tmp, ".linkedin", `${ID}.json`), JSON.stringify(item));

    expect(await runJob()).toBe(0);
    expect(latents).toEqual([[1088, 1360], [1088, 1360], [1088, 1360]]);
    expect(await size(path.join(tmp, ".visuals", `${ID}-v1.png`))).toEqual([1080, 1350]);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, ".linkedin", `${ID}.render.json`), "utf8"))).toMatchObject({ state: "done", done: 3 });
    expect(fs.existsSync(path.join(tmp, "x"))).toBe(false);
  }, 60_000);

  it("refuses an unknown channel", async () => {
    expect(await runJob("--channel", "mastodon")).toBe(1);
  });
});
