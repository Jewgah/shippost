import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireRunLock, releaseRunLock } from "@/lib/runLock";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-lock-"));
const lock = path.join(tmp, ".generating");

beforeEach(() => {
  fs.rmSync(lock, { force: true });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("acquireRunLock / releaseRunLock", () => {
  it("first acquire wins, second is refused while the lock is fresh", () => {
    const token = acquireRunLock(lock);
    expect(token).toBeTruthy();
    expect(acquireRunLock(lock)).toBeNull();
  });

  it("release is compare-and-delete: a stale owner cannot unlink a newer run's lock", () => {
    const a = acquireRunLock(lock)!;
    releaseRunLock(lock, "not-the-owner");
    expect(fs.existsSync(lock)).toBe(true); // survived the wrong token
    releaseRunLock(lock, a);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("steals a stale lock", () => {
    acquireRunLock(lock);
    const old = Date.now() - 16 * 60 * 1000; // past STALE_MS
    fs.utimesSync(lock, old / 1000, old / 1000);
    expect(acquireRunLock(lock)).toBeTruthy();
  });

  it("throws (not 'already running') when the lock can't be created at all", () => {
    expect(() => acquireRunLock(path.join(tmp, "no-such-dir", ".generating"))).toThrow();
  });
});
