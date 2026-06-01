import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let allowFile: string;
let clientsRoot: string;
let myRepo: string; // a git repo (has .git)
let noGit: string; // a folder with no .git
let clientRepo: string; // under the client repos root → sensitive

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-projects-"));
  allowFile = path.join(tmp, "postable-projects.txt");
  clientsRoot = path.join(tmp, "clients");

  // config drives clientSignals(): a client repos root + a scrubbed name.
  const cfg = {
    author: { name: "T" },
    brand: { name: "B" },
    scrub: { clientNames: ["acme"] },
    dayJob: { clientReposRoot: clientsRoot },
    output: { draftsDir: tmp },
    app: {},
  };
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify(cfg));
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  process.env.SHIPPOST_ALLOWLIST = allowFile; // never touch the real allowlist

  myRepo = path.join(tmp, "projects", "myapp");
  fs.mkdirSync(path.join(myRepo, ".git"), { recursive: true });
  noGit = path.join(tmp, "projects", "scratch");
  fs.mkdirSync(noGit, { recursive: true });
  clientRepo = path.join(clientsRoot, "bigco");
  fs.mkdirSync(path.join(clientRepo, ".git"), { recursive: true });
});

beforeEach(() => {
  if (fs.existsSync(allowFile)) fs.unlinkSync(allowFile);
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("tildeCollapse", () => {
  it("collapses paths under home, leaves others and edge cases intact", async () => {
    const { tildeCollapse } = await import("@/lib/projects");
    expect(tildeCollapse("/Users/j/Desktop/x", "/Users/j")).toBe("~/Desktop/x");
    expect(tildeCollapse("/Users/j", "/Users/j")).toBe("~");
    expect(tildeCollapse("/opt/elsewhere", "/Users/j")).toBe("/opt/elsewhere");
    // a sibling-prefix dir must NOT be collapsed (no false "under home" match)
    expect(tildeCollapse("/Users/jordan-archive/x", "/Users/j")).toBe("/Users/jordan-archive/x");
  });
});

describe("addProjectToAllowlist", () => {
  it("adds a real git repo and writes one trailing-newline-terminated line", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    const r = addProjectToAllowlist(myRepo);
    expect(r.ok).toBe(true);
    expect(r.alreadyListed).toBeFalsy();
    expect(r.warning).toBeUndefined(); // it IS a git repo
    expect(r.name).toBe("myapp");
    expect(fs.readFileSync(allowFile, "utf8")).toBe(myRepo + "\n");
  });

  it("is idempotent — re-adding reports alreadyListed and doesn't duplicate the line", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    addProjectToAllowlist(myRepo);
    const again = addProjectToAllowlist(myRepo);
    expect(again.ok).toBe(true);
    expect(again.alreadyListed).toBe(true);
    expect(fs.readFileSync(allowFile, "utf8")).toBe(myRepo + "\n"); // still one line
  });

  it("appends after existing entries without clobbering them", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    fs.writeFileSync(allowFile, "# header\n~/Desktop/Projects/existing\n");
    addProjectToAllowlist(myRepo);
    const out = fs.readFileSync(allowFile, "utf8");
    expect(out).toBe(`# header\n~/Desktop/Projects/existing\n${myRepo}\n`);
  });

  it("adds a non-git folder but warns there's nothing to mine yet", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    const r = addProjectToAllowlist(noGit);
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/git repo/i);
  });

  it("refuses client/day-job work (under the client repos root)", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    const r = addProjectToAllowlist(clientRepo);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/client/i);
    expect(fs.existsSync(allowFile)).toBe(false); // nothing written
  });

  it("refuses a path matching a scrubbed client name", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    const acme = path.join(tmp, "projects", "acme-tools");
    fs.mkdirSync(acme, { recursive: true });
    const r = addProjectToAllowlist(acme);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/client/i);
  });

  it("rejects a missing folder and a non-folder path", async () => {
    const { addProjectToAllowlist } = await import("@/lib/projects");
    expect(addProjectToAllowlist(path.join(tmp, "nope")).ok).toBe(false);
    const aFile = path.join(tmp, "afile.txt");
    fs.writeFileSync(aFile, "x");
    const r = addProjectToAllowlist(aFile);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/folder/i);
  });
});
