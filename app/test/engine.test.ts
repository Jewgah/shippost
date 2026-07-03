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
});
