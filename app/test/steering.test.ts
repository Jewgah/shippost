import { describe, it, expect } from "vitest";
import { cleanField, isUnderRoot, isSensitivePath, shouldSurfaceRecent } from "@/lib/steering";

describe("cleanField — steering input sanitizer", () => {
  it("returns undefined for non-strings and blanks", () => {
    expect(cleanField(undefined, 500)).toBeUndefined();
    expect(cleanField(123 as unknown, 500)).toBeUndefined();
    expect(cleanField("", 500)).toBeUndefined();
    expect(cleanField("    ", 500)).toBeUndefined();
  });

  it("strips control chars and collapses whitespace", () => {
    // \x00 and \x07 are control chars; \t and \n are whitespace — all normalize to single spaces.
    const ctrl = String.fromCharCode(0) + String.fromCharCode(7);
    expect(cleanField(`a${ctrl}b\tc\n\nd`, 500)).toBe("a b c d");
  });

  it("preserves hyphens and punctuation (regression — must NOT strip '-')", () => {
    expect(cleanField("build-in-public: smarter-agents!", 500)).toBe("build-in-public: smarter-agents!");
  });

  it("trims and caps to max length", () => {
    expect(cleanField("  hello  ", 500)).toBe("hello");
    expect(cleanField("x".repeat(120), 100)).toHaveLength(100);
  });
});

describe("suggestions filter — client-data boundary", () => {
  // Fictional fixtures (no real names/paths). `projectsRoot` = the safe area to surface;
  // `clientReposRoot` + `clientNames` = the confidential day-job work to always exclude.
  const HOME = "/home/dev";
  const opts = {
    projectsRoot: `${HOME}/work/projects`,
    clientReposRoot: `${HOME}/work/clients`,
    clientNames: ["acme", "globex", "initech", "umbrella", "hooli", "soylent"],
  };

  it("EXCLUDES client repos under the day-job root", () => {
    expect(shouldSurfaceRecent(`${HOME}/work/clients/acme`, opts)).toBe(false);
    expect(shouldSurfaceRecent(`${HOME}/work/clients/globex-energy`, opts)).toBe(false);
  });

  it("EXCLUDES a projects repo whose name matches a scrub client name (case-insensitive)", () => {
    expect(shouldSurfaceRecent(`${HOME}/work/projects/acme-clone`, opts)).toBe(false);
    expect(shouldSurfaceRecent(`${HOME}/work/projects/GLOBEX-tools`, opts)).toBe(false);
  });

  it("EXCLUDES anything outside the safe projects root", () => {
    expect(shouldSurfaceRecent(`${HOME}/secret/thing`, opts)).toBe(false);
    expect(shouldSurfaceRecent(HOME, opts)).toBe(false);
    // sibling-prefix must not count as "under projects"
    expect(shouldSurfaceRecent(`${HOME}/work/projects-archive/x`, opts)).toBe(false);
  });

  it("INCLUDES clean personal projects under the projects root", () => {
    expect(shouldSurfaceRecent(`${HOME}/work/projects/shippost`, opts)).toBe(true);
    expect(shouldSurfaceRecent(`${HOME}/work/projects/myapp`, opts)).toBe(true);
  });

  it("holds even if clientReposRoot is misconfigured/empty (the projects gate still excludes client work)", () => {
    const noRoot = { ...opts, clientReposRoot: "" };
    // a client path with no name match is still excluded purely by the projects-root gate
    expect(shouldSurfaceRecent(`${HOME}/work/clients/billing`, noRoot)).toBe(false);
    expect(shouldSurfaceRecent(`${HOME}/work/projects/shippost`, noRoot)).toBe(true);
  });

  it("isUnderRoot rejects sibling-prefix paths but accepts the root itself", () => {
    const root = `${HOME}/work/projects`;
    expect(isUnderRoot(`${HOME}/work/projects-archive/x`, root)).toBe(false);
    expect(isUnderRoot(root, root)).toBe(true);
    expect(isUnderRoot(`${root}/shippost`, root)).toBe(true);
  });

  it("isSensitivePath flags the client-repos root prefix and client-name substrings", () => {
    expect(isSensitivePath(`${HOME}/work/clients/x`, `${HOME}/work/clients`, [])).toBe(true);
    expect(isSensitivePath(`${HOME}/work/projects/hooli-ui`, "", ["hooli"])).toBe(true);
    expect(isSensitivePath(`${HOME}/work/projects/shippost`, `${HOME}/work/clients`, ["acme"])).toBe(false);
  });
});
