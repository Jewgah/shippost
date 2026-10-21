import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// GET /api/asset?which=queue&v=4 streams a queued post's video. Safari only plays a <video> whose
// server answers byte ranges, so the route serves 206 slices; everything else stays a plain 200.
let tmp: string;
const get = (q: string, range?: string) =>
  new Request(`http://localhost/api/asset?${q}`, { headers: range ? { range } : {} });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-asset-"));
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ output: { draftsDir: tmp } }));
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
  fs.mkdirSync(path.join(tmp, ".visuals"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".visuals", "q1-v4.mp4"), "0123456789");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("GET /api/asset?which=queue (video)", () => {
  it("serves the whole file with Accept-Ranges, and a 206 slice for a Range", async () => {
    const { GET } = await import("@/app/api/asset/route");
    const full = await GET(get("which=queue&id=q1&v=4"));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(await full.text()).toBe("0123456789");

    const part = await GET(get("which=queue&id=q1&v=4", "bytes=2-5"));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");

    const tail = await GET(get("which=queue&id=q1&v=4", "bytes=8-"));
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("89");
  });

  it("refuses a range past the end, and any candidate number past your video (5)", async () => {
    const { GET } = await import("@/app/api/asset/route");
    const past = await GET(get("which=queue&id=q1&v=4", "bytes=10-"));
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");
    expect((await GET(get("which=queue&id=q1&v=5"))).status).toBe(404); // a valid number, no file
    expect((await GET(get("which=queue&id=q1&v=6"))).status).toBe(400);
    expect((await GET(get("which=queue&id=../q1&v=4"))).status).toBe(400);
  });
});
