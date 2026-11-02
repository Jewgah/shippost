import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Acceptance check (loopit starry-scribbling-bear): engine/generate.sh with SHIPPOST_CHANNEL=x.
// A stub "claude" records its arguments and writes a draft at whatever <stamp>.md path the prompt
// names, so the test sees exactly where the engine TOLD the model to write. The X run must keep
// every file inside <draftsDir>/x/ and point the model at SKILL-x.md; the unset run (positive
// control) must stay today's LinkedIn behaviour.

const repoRoot = path.resolve(__dirname, "..", "..");
let tmp: string;
let draftsDir: string;
let cfg: string;
let argsLog: string;

const run = (stamp: string, env: Record<string, string>) =>
  execFileSync("bash", [path.join(repoRoot, "engine", "generate.sh"), "--force"], {
    env: { ...process.env, SHIPPOST_CONFIG: cfg, SHIPPOST_NO_NOTIFY: "1", SHIPPOST_STAMP: stamp, SHIPPOST_FORCE: "1", ...env },
    encoding: "utf8",
  });

const topLevelMd = () => fs.readdirSync(draftsDir).filter((f) => f.endsWith(".md"));

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-x-engine-"));
  draftsDir = path.join(tmp, "drafts");
  fs.mkdirSync(draftsDir, { recursive: true });
  argsLog = path.join(tmp, "claude-args.txt");
  const stub = path.join(tmp, "claude-stub.sh");
  fs.writeFileSync(
    stub,
    [
      "#!/bin/bash",
      `printf '%s\\n' "$*" > "${argsLog}"`,
      `out="$(printf '%s' "$*" | grep -oE "[^ \\"']*\${SHIPPOST_STAMP}\\.md" | head -n 1)"`,
      `[ -n "$out" ] || exit 9`,
      `mkdir -p "$(dirname "$out")"`,
      `printf '# drafts\\n' > "$out"`,
      "",
    ].join("\n")
  );
  fs.chmodSync(stub, 0o755);
  cfg = path.join(tmp, "config.json");
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      author: { name: "Test Author" },
      brand: { name: "TestBrand" },
      harvest: { repoAllowlistFile: "does-not-matter.txt", skillsRoot: path.join(tmp, "skills") },
      output: { draftsDir },
      engine: { claudeBin: stub, minGapHours: 46 },
    })
  );
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("generate.sh SHIPPOST_CHANNEL=x", () => {
  it("writes the X batch and its run files into <draftsDir>/x/ and points the model at SKILL-x.md", () => {
    const stamp = "2031-03-01_100000";
    run(stamp, { SHIPPOST_CHANNEL: "x", SHIPPOST_COMPANY_MODE: "1" });
    const xDir = path.join(draftsDir, "x");
    const args = fs.readFileSync(argsLog, "utf8");

    expect(fs.existsSync(path.join(xDir, `${stamp}.md`)), "X-DRAFT-NOT-IN-X-DIR: the X draft must land in <draftsDir>/x/<stamp>.md").toBe(true);
    expect(topLevelMd(), "an X run must leave no .md at the top of <draftsDir>").toEqual([]);

    const skill = args.match(/[^\s"']*SKILL-x\.md/);
    expect(skill, "the X prompt must name SKILL-x.md").not.toBeNull();
    expect(fs.existsSync(skill![0]), `the SKILL-x.md the prompt names must exist: ${skill![0]}`).toBe(true);
    expect(args, "the company-mode block is skipped for X").not.toContain("Mode: COMPANY");

    const result = JSON.parse(fs.readFileSync(path.join(xDir, ".last_generate.json"), "utf8"));
    expect(result).toMatchObject({ ok: true, date: stamp, code: 0 });
    expect(fs.existsSync(path.join(draftsDir, ".last_generate.json")), "the X result file lives in x/, not the root").toBe(false);
    expect(fs.readFileSync(path.join(xDir, ".run.log"), "utf8")).toContain("5 X drafts ready");
  }, 30_000);

  it("unset channel keeps the LinkedIn behaviour (positive control)", () => {
    const stamp = "2031-03-02_100000";
    run(stamp, {});
    const args = fs.readFileSync(argsLog, "utf8");
    expect(fs.existsSync(path.join(draftsDir, `${stamp}.md`))).toBe(true);
    expect(topLevelMd()).toContain(`${stamp}.md`);
    expect(args).toMatch(/[\\/]SKILL\.md/);
    expect(args).not.toContain("SKILL-x.md");
    expect(args).toContain("Mode: PERSONAL-ONLY");
    const result = JSON.parse(fs.readFileSync(path.join(draftsDir, ".last_generate.json"), "utf8"));
    expect(result).toMatchObject({ ok: true, date: stamp, code: 0 });
    const log = fs.readFileSync(path.join(draftsDir, ".run.log"), "utf8");
    expect(log).toContain("notify: 5 drafts ready");
    expect(log).not.toContain("5 X drafts ready");
  }, 30_000);
});
