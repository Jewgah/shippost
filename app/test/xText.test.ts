import { describe, it, expect } from "vitest";
import { xLength, xComposeUrl, splitThread } from "@/lib/xText";

describe("xLength", () => {
  it("counts ASCII and Latin-1 as 1 per code point, newline included", () => {
    expect(xLength("hello")).toBe(5);
    expect(xLength("café")).toBe(4);
    expect(xLength("a\nb")).toBe(3);
    expect(xLength("\u00a9 \u00ae")).toBe(3); // pictographic but Latin-1: weight 1
    expect(xLength("")).toBe(0);
  });

  it("weighs any URL 23, short or long", () => {
    expect(xLength("https://t.co/a")).toBe(23);
    expect(xLength("http://x.io")).toBe(23);
    expect(xLength("https://example.com/a/very/long/path?with=query&and=more#frag")).toBe(23);
    expect(xLength("see https://example.com/a/b.")).toBe(4 + 23 + 1); // the final dot is prose
  });

  it("weighs CJK and a single emoji 2 each, per code point not per UTF-16 unit", () => {
    expect(xLength("你好")).toBe(4);
    expect(xLength("\u{1F680}")).toBe(2);
    expect(xLength("a\u{1F680}b")).toBe(4);
    expect(xLength("\u{1F44D}\u{1F3FD}")).toBe(2); // one emoji with a skin tone
  });

  it("is a plain count: 280 stays 280, 281 is 281, nothing is capped", () => {
    expect(xLength("a".repeat(280))).toBe(280);
    expect(xLength("a".repeat(281))).toBe(281);
    expect(xLength("a".repeat(1000))).toBe(1000);
  });
});

describe("xComposeUrl", () => {
  const roundTrip = (text: string) => {
    const u = new URL(xComposeUrl(text));
    expect(u.protocol).toBe("https:");
    expect(["x.com", "twitter.com"]).toContain(u.hostname);
    expect(["/intent/post", "/intent/tweet"]).toContain(u.pathname);
    return u.searchParams.get("text");
  };
  it("round-trips the exact text", () => {
    for (const t of [
      "plain",
      "a & b # c + d % e",
      "line one\nline two",
      "emoji \u{1F680} and 你好",
      "link https://example.com/p?a=1&b=2#x done",
      "100%25 already-encoded-looking",
    ]) {
      expect(roundTrip(t)).toBe(t);
    }
  });
});

describe("splitThread", () => {
  it("splits numbered posts and drops the numbers", () => {
    expect(splitThread("2/ second\n\n3/ third\nstill third")).toEqual(["second", "third\nstill third"]);
  });
  it("keeps un-numbered text as one post and empty as none", () => {
    expect(splitThread("just one")).toEqual(["just one"]);
    expect(splitThread("  ")).toEqual([]);
  });
});
