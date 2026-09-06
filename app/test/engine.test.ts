import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Smoke tests for the bash engine — the actual product core, previously untested.
// Runs harvest.sh/generate.sh against a throwaway git repo + config (SHIPPOST_CONFIG),
// never Jordan's real config, skills, or drafts. Needs bash, git, jq (all present on
// dev machines and GitHub runners).

const repoRoot = path.resolve(__dirname, "..", "..");
let tmp: string;
let cfgPath: string;
let draftsDir: string;

const sh = (script: string, env: Record<string, string> = {}) =>
  execFileSync("bash", [path.join(repoRoot, "engine", script)], {
    env: { ...process.env, SHIPPOST_CONFIG: cfgPath, SHIPPOST_NO_NOTIFY: "1", ...env },
    encoding: "utf8",
  });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-engine-"));
  draftsDir = path.join(tmp, "drafts");
  const fixtureRepo = path.join(tmp, "repo");
  const skillsRoot = path.join(tmp, "skills");
  fs.mkdirSync(fixtureRepo, { recursive: true });
  fs.mkdirSync(skillsRoot, { recursive: true });

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", fixtureRepo, "-c", "user.email=t@t.t", "-c", "user.name=T", ...args]);
  git("init", "-q");
  fs.writeFileSync(path.join(fixtureRepo, "a.txt"), "hello\n");
  git("add", "a.txt");
  git("commit", "-qm", "add flux capacitor to the harvester");

  // The allowlist path is resolved relative to the repo root, so point it at the temp
  // file via a relative path — the repo itself stays untouched.
  const allowlist = path.join(tmp, "allow.txt");
  fs.writeFileSync(allowlist, fixtureRepo + "\n");

  cfgPath = path.join(tmp, "config.json");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      author: { name: "Test Author", bio: "Tester bio." },
      brand: { name: "TestBrand", siteUrl: "https://example.test" },
      scrub: { clientNames: ["SecretClient"] },
      harvest: {
        repoAllowlistFile: path.relative(repoRoot, allowlist),
        windowDays: 4,
        skillsRoot,
      },
      output: { draftsDir },
      engine: { claudeBin: "/usr/bin/false", minGapHours: 46 },
    })
  );
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("harvest.sh", () => {
  it("digest includes the brand, site URL, scrub list, and the allowlisted repo's commits", () => {
    const out = sh("harvest.sh");
    expect(out).toContain("SHIPPOST HARVEST");
    expect(out).toContain("TestBrand");
    expect(out).toContain("https://example.test");
    expect(out).toContain("SecretClient"); // surfaced under SCRUB so the model redacts it
    expect(out).toContain("add flux capacitor to the harvester");
  }, 20_000);
});

describe("generate.sh", () => {
  it("2-day guard skips a fresh run without touching claude, exit 0", () => {
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(path.join(draftsDir, ".last_run"), String(Math.floor(Date.now() / 1000)));
    sh("generate.sh"); // throws on non-zero exit
    const log = fs.readFileSync(path.join(draftsDir, ".run.log"), "utf8");
    expect(log).toContain("guard:");
    expect(fs.readdirSync(draftsDir).filter((f) => f.endsWith(".md"))).toHaveLength(0);
  }, 20_000);

  it("a corrupt .last_run doesn't break the guard arithmetic", () => {
    fs.writeFileSync(path.join(draftsDir, ".last_run"), "garbage\n");
    // guard treats it as 0 → proceeds to the (stubbed, /usr/bin/false) engine and logs a start
    try {
      sh("generate.sh");
    } catch {
      /* claudeBin is /usr/bin/false — the run itself fails, only the guard math is under test */
    }
    const log = fs.readFileSync(path.join(draftsDir, ".run.log"), "utf8");
    expect(log).toContain("starting generation");
  }, 20_000);

  it("a failed run leaves .last_generate.json (ok=false, app shape) and a .failures.log entry", () => {
    fs.writeFileSync(path.join(draftsDir, ".last_run"), "0\n");
    const stamp = "2031-01-01_000000";
    try {
      sh("generate.sh", { SHIPPOST_STAMP: stamp });
    } catch {
      /* claudeBin is /usr/bin/false: the failure branch is what's under test */
    }
    const result = JSON.parse(fs.readFileSync(path.join(draftsDir, ".last_generate.json"), "utf8"));
    expect(result).toMatchObject({ ok: false, date: stamp, code: 1 });
    expect(typeof result.finishedAt).toBe("number");
    const failures = fs.readFileSync(path.join(draftsDir, ".failures.log"), "utf8");
    expect(failures).toContain(`FAILED rc=1 draft_exists=no stamp=${stamp}`);
    const log = fs.readFileSync(path.join(draftsDir, ".run.log"), "utf8");
    expect(log).toContain("notify: draft generation FAILED (rc=1)");
  }, 20_000);
});

// Success path against a stub "claude" that writes the draft where the engine expects it.
// Separate drafts dir so the failure tests above can't leak a .failures.log into it.
describe("generate.sh (success path, stub claude)", () => {
  let okDir: string;
  let okCfg: string;
  const DAY_MS = 86_400_000;
  const run = (stamp: string) =>
    sh("generate.sh", { SHIPPOST_CONFIG: okCfg, SHIPPOST_STAMP: stamp, SHIPPOST_FORCE: "1" });
  const pick = (date: string, ts: number) =>
    JSON.stringify({ ts: new Date(ts).toISOString(), date, option: 1, pillar: "lesson", topic: "t" }) + "\n";

  beforeAll(() => {
    okDir = path.join(tmp, "drafts-ok");
    fs.mkdirSync(okDir, { recursive: true });
    const stub = path.join(tmp, "claude-stub.sh");
    fs.writeFileSync(stub, `#!/bin/bash\nprintf '# LinkedIn drafts\\n' > "${okDir}/\${SHIPPOST_STAMP}.md"\n`);
    fs.chmodSync(stub, 0o755);
    okCfg = path.join(tmp, "config-ok.json");
    fs.writeFileSync(
      okCfg,
      JSON.stringify({
        author: { name: "Test Author" },
        brand: { name: "TestBrand" },
        harvest: { repoAllowlistFile: "does-not-matter.txt", skillsRoot: path.join(tmp, "skills") },
        output: { draftsDir: okDir },
        engine: { claudeBin: stub, minGapHours: 46 },
      })
    );
  });

  it("writes .last_generate.json ok=true, no .failures.log, and the plain notification when the author posted recently", () => {
    fs.writeFileSync(path.join(okDir, ".picks.jsonl"), pick("2030-12-31_000000", Date.now() - 3_600_000));
    const stamp = "2031-01-01_000000";
    run(stamp);
    expect(fs.existsSync(path.join(okDir, `${stamp}.md`))).toBe(true);
    const result = JSON.parse(fs.readFileSync(path.join(okDir, ".last_generate.json"), "utf8"));
    expect(result).toMatchObject({ ok: true, date: stamp, code: 0 });
    expect(fs.existsSync(path.join(okDir, ".failures.log"))).toBe(false);
    const log = fs.readFileSync(path.join(okDir, ".run.log"), "utf8");
    expect(log).toContain("notify: 5 drafts ready");
    expect(log).not.toContain("you have not posted");
  }, 20_000);

  it("nudges with days since the last pick and the unpicked drafts newer than it (ms timestamps, like the app writes)", () => {
    // Newest pick 30 days (+1h) ago, of the draft the previous test generated; a second
    // duplicate line of the same pick must not change anything.
    const stale = pick("2031-01-01_000000", Date.now() - 30 * DAY_MS - 3_600_000);
    fs.writeFileSync(path.join(okDir, ".picks.jsonl"), stale + stale);
    fs.writeFileSync(path.join(okDir, "2031-01-02_000000.md"), "# LinkedIn drafts\n"); // unpicked, newer
    fs.writeFileSync(path.join(okDir, "2030-06-01_000000.md"), "# LinkedIn drafts\n"); // unpicked, OLDER: not counted
    run("2031-01-03_000000"); // this run's own draft counts too
    const log = fs.readFileSync(path.join(okDir, ".run.log"), "utf8");
    expect(log).toContain("notify: you have not posted in 30 days, 2 drafts waiting");
  }, 20_000);
});
