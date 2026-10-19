import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// loadConfig re-reads config.json when its mtime changes, and only remembers the mtime once the
// file parsed: a broken edit throws on every call until it is fixed, never silently ignored.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-cfg-"));
const file = path.join(tmp, "config.json");
const write = (body: string, secondsAgo: number) => {
  fs.writeFileSync(file, body);
  const t = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(file, t, t); // distinct mtimes without sleeping
};
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("loadConfig reload", () => {
  it("picks up an edit, keeps throwing on a broken file, recovers once fixed", async () => {
    process.env.SHIPPOST_CONFIG = file;
    const { loadConfig } = await import("@/lib/config");
    write(JSON.stringify({ brand: { name: "One" } }), 30);
    expect(loadConfig().brand.name).toBe("One");

    write(JSON.stringify({ brand: { name: "Two" } }), 20);
    expect(loadConfig().brand.name).toBe("Two");

    write("{ broken", 10);
    expect(() => loadConfig()).toThrow();
    expect(() => loadConfig()).toThrow(); // not served stale after the first failure

    write(JSON.stringify({ brand: { name: "Three" } }), 0);
    expect(loadConfig().brand.name).toBe("Three");
  });
});
