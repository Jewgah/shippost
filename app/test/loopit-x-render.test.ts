import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Acceptance check (loopit starry-scribbling-bear-2): engine/render-variants.mjs --job <id>
// --channel x renders a queued X post's 3 candidate images at 16:9 (1600x900, from a landscape
// latent) out of <draftsDir>/x/, into <draftsDir>/x/.visuals/, and never touches the LinkedIn
// folders. Without --channel, a LinkedIn item renders exactly as before (1080x1350 from 1088x1360):
// that test passes today and is the positive control for the fake engine.
//
// NEVER a real ComfyUI: every node process (render-variants AND the render-visual children it
// spawns, through NODE_OPTIONS) gets a preload that replaces fetch with a fake ComfyUI answering
// only for the unresolvable host comfy.invalid, which is not local, so comfy-headless.sh can never
// be started. No `video` config, so no Remotion either.

const repo = path.resolve(__dirname, "..", "..");
const script = path.join(repo, "engine", "render-variants.mjs");
const X_ID = "2031-03-03_120000";
const LI_ID = "2031-03-03_090000";
const XJOB = `${X_ID}-o1-abc123`;
const LIJOB = `${LI_ID}-o1-def456`;

const X_MD = `# X drafts - 2031-03-03 · 1 option

## ⭐ Option 1 - build-in-public - the x render   (9.0/10)
**A. Company post**
X images are 16:9 now.

**B. Thread**
2/ The clip stays 4:5.

_Why it works:_ test.
_Suggested visuals:_
1. a wide desk - AI prompt: "a wide desk with two monitors at dusk, cinematic landscape frame"

---
`;
const LI_MD = `# LinkedIn drafts - 2031-03-03 · 1 option

## ⭐ Option 1 - build-in-public - the linkedin render   (9.0/10)
**A. Company post**
LinkedIn images stay 4:5.

_Why it works:_ test.
_Suggested visuals:_
1. a tall desk - AI prompt: "a laptop on a desk at night, 35mm, portrait frame"

---
`;

const FAKE_COMFY = String.raw`
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const LOG = process.env.FAKE_COMFY_LOG;
const rec = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
const refuse = (name) => () => { rec({ blocked: name }); throw new Error('the test blocks node:' + name); };
for (const [mod, name] of [[http, 'http'], [https, 'https']]) { mod.request = refuse(name); mod.get = refuse(name); }
syncBuiltinESMExports();
const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
  const method = String((input instanceof Request ? input.method : init.method) || 'GET').toUpperCase();
  const u = new URL(url);
  if (u.hostname !== 'comfy.invalid') { rec({ blocked: url }); throw new TypeError('fetch failed: the test blocks ' + u.hostname); }
  if (u.pathname === '/system_stats') return json(200, { system: {} });
  if (u.pathname === '/prompt' && method === 'POST') {
    const body = JSON.parse(input instanceof Request ? await input.clone().text() : String(init.body));
    const latent = Object.values(body.prompt || {}).find((n) => n && n.class_type === 'EmptySD3LatentImage');
    rec({ kind: 'prompt', argv: process.argv.slice(1), latent: latent ? latent.inputs : null });
    return json(200, { prompt_id: 'pid1', number: 1 });
  }
  if (u.pathname.startsWith('/history/')) {
    const id = u.pathname.split('/').pop();
    return json(200, { [id]: { outputs: { 7: { images: [{ filename: 'fake.png', subfolder: '', type: 'output' }] } }, status: { status_str: 'success', completed: true } } });
  }
  if (u.pathname === '/view') return new Response(fs.readFileSync(process.env.FAKE_COMFY_PNG), { status: 200, headers: { 'content-type': 'image/png' } });
  if (u.pathname === '/free') return json(200, {});
  return json(404, {});
};
`;

let tmp: string;
let logFile: string;
let env: NodeJS.ProcessEnv;

type Rec = { kind?: string; blocked?: string; argv?: string[]; latent?: { width: number; height: number } | null };
const records = (): Rec[] =>
  fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const pngSize = (f: string) => {
  const b = fs.readFileSync(f);
  return b.length >= 24 && b.readUInt32BE(12) === 0x49484452 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : "not a png";
};
const filesIn = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
const run = (args: string[]) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], { env, encoding: "utf8", timeout: 150_000 });
const queueItem = (id: string, draft: string, extra: Record<string, unknown> = {}) => ({
  id,
  draft,
  option: 1,
  topic: "render",
  mode: "personal",
  text: "post",
  repost: "",
  status: "queued",
  createdAt: "2031-03-03T12:00:00.000Z",
  ...extra,
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-x-render-"));
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: tmp, picksLogFile: ".picks.jsonl" }, app: {} })
  );
  fs.mkdirSync(path.join(tmp, "x", ".queue"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".linkedin"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "x", `${X_ID}.md`), X_MD); // the X draft is ONLY in x/
  fs.writeFileSync(path.join(tmp, `${LI_ID}.md`), LI_MD);
  fs.writeFileSync(
    path.join(tmp, "x", ".queue", `${XJOB}.json`),
    JSON.stringify(queueItem(XJOB, X_ID, { channel: "x", thread: ["2/ The clip stays 4:5."], comment: "" }))
  );
  fs.writeFileSync(path.join(tmp, ".linkedin", `${LIJOB}.json`), JSON.stringify(queueItem(LIJOB, LI_ID)));

  const sharp = createRequire(path.join(repo, "app", "package.json"))("sharp");
  const png = path.join(tmp, "engine-out.png");
  fs.writeFileSync(png, await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } }).png().toBuffer());
  const preload = path.join(tmp, "fake-comfy.mjs");
  fs.writeFileSync(preload, FAKE_COMFY);
  logFile = path.join(tmp, "comfy.jsonl");
  env = {
    ...process.env,
    SHIPPOST_CONFIG: path.join(tmp, "config.json"),
    SHIPPOST_COMFY_URL: "http://comfy.invalid:8188",
    SHIPPOST_COMFY_DIR: path.join(tmp, "no-comfy-here"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`.trim(),
    FAKE_COMFY_LOG: logFile,
    FAKE_COMFY_PNG: png,
  };
});

afterEach(() => {
  const leaked = records().filter((r) => r.blocked);
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(leaked, "a request went somewhere other than the fake engine").toEqual([]);
});

describe("render-variants.mjs --channel x", () => {
  it("renders 3 images at 1600x900 from a landscape latent into x/.visuals, out of the x/ draft, nothing in the LinkedIn folders", () => {
    const r = run(["--job", XJOB, "--channel", "x"]);
    const xv = path.join(tmp, "x", ".visuals");
    const sizes = [1, 2, 3].map((v) => {
      const f = path.join(xv, `${XJOB}-v${v}.png`);
      return fs.existsSync(f) ? pngSize(f) : "missing";
    });
    expect(sizes, `X-RENDER-16x9 (exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 400)})`).toEqual(["1600x900", "1600x900", "1600x900"]);
    expect(r.status).toBe(0);

    const prompts = records().filter((x) => x.kind === "prompt");
    expect(prompts, "three renders reached the engine").toHaveLength(3);
    for (const p of prompts) {
      const { width, height } = p.latent ?? { width: 0, height: 0 };
      expect(width > height && Math.abs(width / height - 16 / 9) < 0.06, `a 16:9 landscape latent, got ${width}x${height}`).toBe(true);
      expect(width % 16 === 0 && height % 16 === 0, `latent ${width}x${height} in multiples of 16`).toBe(true);
    }

    const state = [path.join(tmp, "x", ".queue"), xv]
      .map((d) => path.join(d, `${XJOB}.render.json`))
      .filter((f) => fs.existsSync(f))
      .map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    expect(state[0], "the render progress lives under x/ and ends done").toMatchObject({ state: "done", done: 3 });
    expect(filesIn(path.join(tmp, ".visuals")), "nothing is written to the LinkedIn visuals").toEqual([]);
    expect(filesIn(path.join(tmp, ".linkedin")), "nothing is written to the LinkedIn queue").toEqual([`${LIJOB}.json`]);
  }, 170_000);
});

describe("render-variants.mjs without --channel (LinkedIn, unchanged)", () => {
  it("renders the LinkedIn item at 1080x1350 from 1088x1360 into .visuals, nothing under x/", () => {
    const r = run(["--job", LIJOB]);
    const sizes = [1, 2, 3].map((v) => {
      const f = path.join(tmp, ".visuals", `${LIJOB}-v${v}.png`);
      return fs.existsSync(f) ? pngSize(f) : "missing";
    });
    expect(sizes, `LinkedIn render (exit ${r.status}: ${(r.stderr || "").slice(0, 300)})`).toEqual(["1080x1350", "1080x1350", "1080x1350"]);
    const prompts = records().filter((x) => x.kind === "prompt");
    expect(prompts.map((p) => `${p.latent?.width}x${p.latent?.height}`)).toEqual(["1088x1360", "1088x1360", "1088x1360"]);
    expect(filesIn(path.join(tmp, "x", ".visuals"))).toEqual([]);
  }, 170_000);
});
