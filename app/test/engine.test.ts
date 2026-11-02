import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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

describe("engine/edit.sh (Generate for company)", () => {
  // The stub "AI" adds a section D to option 2 only, whatever option it was asked about.
  const draftBody = "# LinkedIn drafts\n\n## Option 1 \u2014 p \u2014 one   (8/10)\n**A. Company post**\nA1\n\n## Option 2 \u2014 p \u2014 two   (7/10)\n**A. Company post**\nA2\n";
  let dir: string;
  let cfg: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-edit-"));
    const stub = path.join(dir, "claude-stub.sh");
    fs.writeFileSync(stub, `#!/bin/bash\nprintf '**D. Company page post**\\nD2\\n' >> "$SHIPPOST_EDIT_FILE"\n`);
    fs.chmodSync(stub, 0o755);
    cfg = path.join(dir, "config.json");
    fs.writeFileSync(cfg, JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: dir }, engine: { claudeBin: stub } }));
  });
  const edit = (opt: string) => {
    const file = path.join(dir, `d${opt}.md`);
    fs.writeFileSync(file, draftBody);
    try {
      execFileSync("bash", [path.join(repoRoot, "engine", "edit.sh")], {
        env: { ...process.env, SHIPPOST_CONFIG: cfg, SHIPPOST_EDIT_FILE: file, SHIPPOST_EDIT_OPTION: opt, SHIPPOST_EDIT_PROMPT: "company", SHIPPOST_EDIT_MODE: "company" },
      });
      return 0;
    } catch (e) {
      return (e as { status: number }).status;
    }
  };
  it("succeeds when the asked option got its section D", () => expect(edit("2")).toBe(0));
  it("exits 3 when only ANOTHER option has a section D", () => expect(edit("1")).toBe(3));
});

describe("generate.sh with SHIPPOST_CHANNEL=x (stub claude)", () => {
  let xDir: string;
  let xCfg: string;
  let argvLog: string;
  const run = (stamp: string, env: Record<string, string> = {}) =>
    sh("generate.sh", { SHIPPOST_CONFIG: xCfg, SHIPPOST_STAMP: stamp, SHIPPOST_FORCE: "1", ...env });

  beforeAll(() => {
    xDir = path.join(tmp, "drafts-x");
    fs.mkdirSync(xDir, { recursive: true });
    argvLog = path.join(tmp, "x-argv.txt");
    const stub = path.join(tmp, "claude-x-stub.sh");
    // The stub writes the draft where the PROMPT says (the path after "this exact path: "), as the model would.
    fs.writeFileSync(
      stub,
      `#!/bin/bash\nprintf '%s' "$2" > "${argvLog}"\nout="$(printf '%s' "$2" | sed -n 's/.*this exact path: \\([^ ]*\\) \\. .*/\\1/p')"\nprintf '# X drafts\\n' > "$out"\n`
    );
    fs.chmodSync(stub, 0o755);
    xCfg = path.join(tmp, "config-x.json");
    fs.writeFileSync(
      xCfg,
      JSON.stringify({
        author: { name: "Test Author" },
        brand: { name: "TestBrand" },
        harvest: { repoAllowlistFile: "does-not-matter.txt", skillsRoot: path.join(tmp, "skills") },
        output: { draftsDir: xDir },
        engine: { claudeBin: stub, minGapHours: 46 },
      })
    );
  });

  it("writes into x/, names SKILL-x.md, skips the company-mode block, and leaves the root untouched", () => {
    const stamp = "2031-02-01_000000";
    run(stamp, { SHIPPOST_CHANNEL: "x", SHIPPOST_COMPANY_MODE: "1" });
    expect(fs.existsSync(path.join(xDir, "x", `${stamp}.md`))).toBe(true);
    const prompt = fs.readFileSync(argvLog, "utf8");
    const skill = /(\S*SKILL-x\.md)/.exec(prompt)?.[1];
    expect(skill && fs.existsSync(skill)).toBe(true);
    expect(prompt).not.toMatch(/SKILL\.md/);
    expect(prompt).not.toContain("Mode: COMPANY");
    expect(prompt).not.toContain("PERSONAL-ONLY");
    const result = JSON.parse(fs.readFileSync(path.join(xDir, "x", ".last_generate.json"), "utf8"));
    expect(result).toMatchObject({ ok: true, date: stamp, code: 0 });
    expect(fs.readFileSync(path.join(xDir, "x", ".run.log"), "utf8")).toContain("5 X drafts ready");
    expect(fs.readdirSync(xDir).filter((f) => f.endsWith(".md"))).toHaveLength(0);
    expect(fs.existsSync(path.join(xDir, ".last_generate.json"))).toBe(false);
  }, 20_000);

  it("with the channel unset the prompt and paths are the LinkedIn ones", () => {
    const stamp = "2031-02-02_000000";
    run(stamp, { SHIPPOST_COMPANY_MODE: "0" });
    expect(fs.existsSync(path.join(xDir, `${stamp}.md`))).toBe(true);
    const prompt = fs.readFileSync(argvLog, "utf8");
    expect(prompt).toContain("PERSONAL-ONLY");
    expect(prompt).not.toContain("SKILL-x.md");
    expect(fs.readFileSync(path.join(xDir, ".run.log"), "utf8")).toContain("notify: 5 drafts ready");
  }, 20_000);

  it("harvest on the X channel prints the X corpus first and labels the LinkedIn one", () => {
    fs.writeFileSync(path.join(xDir, "recent-posts.md"), "A long form linkedin post about queues.\n");
    fs.writeFileSync(path.join(xDir, "x", "recent-posts.md"), "short x post about queues\n");
    const out = sh("harvest.sh", { SHIPPOST_CONFIG: xCfg, SHIPPOST_CHANNEL: "x" });
    expect(out.indexOf("YOUR RECENT X POSTS")).toBeGreaterThan(-1);
    expect(out.indexOf("YOUR RECENT X POSTS")).toBeLessThan(out.indexOf("long-form, match the voice, not the length"));
    expect(out).toContain("short x post about queues");
  }, 20_000);
});

describe("harvest.sh RECENT DRAFTS on the X channel", () => {
  it("lists X drafts and the latest LinkedIn ones, and stays quiet on stderr", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-xh-"));
    fs.mkdirSync(path.join(d, "x"), { recursive: true });
    fs.writeFileSync(path.join(d, "2031-03-01_000000.md"), "# t\n## Option 1 - lesson - linkedin topic   (7/10)\n");
    fs.writeFileSync(path.join(d, "x", "2031-03-02_000000.md"), "# t\n## Option 1 - lesson - x topic   (7/10)\n");
    const cfg = path.join(d, "config.json");
    fs.writeFileSync(cfg, JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, harvest: { repoAllowlistFile: "none.txt", skillsRoot: path.join(d, "s") }, output: { draftsDir: d } }));
    const res = spawnSync("bash", [path.join(repoRoot, "engine", "harvest.sh")], { env: { ...process.env, SHIPPOST_CONFIG: cfg, SHIPPOST_CHANNEL: "x" }, encoding: "utf8" });
    expect(res.stderr).not.toContain("bad substitution");
    expect(res.stdout).toContain("x topic");
    expect(res.stdout).toContain("linkedin topic");
    fs.rmSync(d, { recursive: true, force: true });
  }, 20_000);
});
