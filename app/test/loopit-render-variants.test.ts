import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Acceptance check (loopit gentle-twirling-oasis): engine/render-variants.mjs --job <id> renders a
// queued post's 3 candidate images under the shared `.rendering` lock. Never against a real engine:
// the ComfyUI URL is a non-local, unresolvable host (so it must not be started from here), and the
// ComfyUI dir points at nothing as a second guard. Everything lives in a temp SHIPPOST_CONFIG.

const script = path.resolve(__dirname, "..", "..", "engine", "render-variants.mjs");
const DRAFT = "2026-10-01_120000";
const ID = "q20261001a";

const DRAFT_MD = `# LinkedIn drafts - 2026-10-01 · 1 option

## ⭐ Option 1 - build-in-public - queue test   (9.0/10)
**A. Company post**
A post body for the queue test.

**B. Repost caption (your profile)**
A caption.

_Why it works:_ test.
_Suggested visuals:_
1. a desk at night - AI prompt: "a laptop on a desk at night, 35mm"
2. before/after screenshot (screenshot - no AI)
3. an office - AI prompt: "an empty office at dawn, wide angle"

---
`;

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-variants-"));
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({
      author: { name: "T" },
      brand: { name: "B" },
      output: { draftsDir: tmp, picksLogFile: ".picks.jsonl" },
      app: {},
    })
  );
  fs.writeFileSync(path.join(tmp, `${DRAFT}.md`), DRAFT_MD);
  fs.mkdirSync(path.join(tmp, ".linkedin"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".linkedin", `${ID}.json`),
    JSON.stringify({
      id: ID,
      draft: DRAFT,
      option: 1,
      topic: "queue test",
      mode: "personal",
      text: "A post body for the queue test.",
      repost: "",
      status: "queued",
      createdAt: "2026-10-01T12:00:00.000Z",
    })
  );
  env = {
    ...process.env,
    SHIPPOST_CONFIG: path.join(tmp, "config.json"),
    SHIPPOST_COMFY_URL: "http://comfy.invalid:8188",
    SHIPPOST_COMFY_DIR: path.join(tmp, "no-comfy-here"),
  };
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Progress file: `<id>.render.json`, next to the queue item or next to the images.
const readProgress = (): { state?: string; error?: string } | null => {
  for (const dir of [".linkedin", ".visuals"]) {
    const p = path.join(tmp, dir, `${ID}.render.json`);
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        return { state: "unparseable" };
      }
    }
  }
  return null;
};

describe("render-variants.mjs --job", () => {
  it("marks the render failed and releases the lock when the engine is remote and down", () => {
    const r = spawnSync(process.execPath, [script, "--job", ID], { env, encoding: "utf8", timeout: 90_000 });
    const progress = readProgress();
    expect(progress?.state, `render-variants must mark the job failed (exit ${r.status}, stderr: ${r.stderr?.slice(0, 300)})`).toBe("failed");
    expect(String(progress?.error ?? "").length, "a failed render carries an error message").toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmp, ".rendering")), "the .rendering lock must be released").toBe(false);
    const pngs = fs.existsSync(path.join(tmp, ".visuals"))
      ? fs.readdirSync(path.join(tmp, ".visuals")).filter((f) => f.endsWith(".png"))
      : [];
    expect(pngs).toEqual([]);
    // the queue item itself is left postable (text-only)
    const item = JSON.parse(fs.readFileSync(path.join(tmp, ".linkedin", `${ID}.json`), "utf8"));
    expect(item.status).toBe("queued");
  }, 120_000);

  it("waits behind a fresh .rendering lock held by someone else, without rendering or stealing it", async () => {
    const lock = path.join(tmp, ".rendering");
    fs.writeFileSync(lock, "someone-else");
    const child = spawn(process.execPath, [script, "--job", ID], { env, stdio: "ignore" });
    let exited = false;
    child.on("exit", () => (exited = true));
    await new Promise((r) => setTimeout(r, 6000));
    const progress = readProgress();
    child.kill("SIGKILL");
    expect(progress?.state, "render-variants must report waiting while another render holds the lock").toBe("waiting");
    expect(exited, "render-variants must keep waiting, not give up, while the lock is fresh").toBe(false);
    expect(fs.readFileSync(lock, "utf8"), "the other holder's lock must not be stolen").toBe("someone-else");
  }, 30_000);
});
