import { describe, it, expect } from "vitest";

// Acceptance check (loopit starry-scribbling-bear): lib/xText, the client-safe X helpers.
// Only behaviour that X's published counting is certain about: a URL weighs 23 whatever its
// length, ASCII and Latin-1 weigh 1 per character, CJK and an emoji weigh 2, and 280 is a plain
// count, not a cap. The compose URL must round-trip the exact text through X's intent endpoint.

type XText = { xLength?: (t: string) => number; xComposeUrl?: (t: string) => string };

async function load(): Promise<XText> {
  const spec = "@/lib/xText";
  try {
    return (await import(/* @vite-ignore */ spec)) as XText;
  } catch {
    return {};
  }
}

describe("xLength (X's weighted count)", () => {
  it("counts plain ASCII 1 per character, up to and past the 280 boundary", async () => {
    const { xLength } = await load();
    expect(typeof xLength, "XTEXT-MISSING: lib/xText must export xLength").toBe("function");
    expect(xLength!("")).toBe(0);
    expect(xLength!("hello world")).toBe(11);
    expect(xLength!("a".repeat(280))).toBe(280);
    expect(xLength!("a".repeat(281))).toBe(281);
    expect(xLength!("line one\nline two")).toBe(17);
    expect(xLength!("café")).toBe(4);
  });

  it("weighs every URL as 23, short or long", async () => {
    const { xLength } = await load();
    expect(typeof xLength, "XTEXT-MISSING: lib/xText must export xLength").toBe("function");
    expect(xLength!("https://example.com/" + "a".repeat(80))).toBe(23);
    expect(xLength!("Read this: https://example.com/a/b/c")).toBe(11 + 23);
    expect(xLength!("https://example.com")).toBe(23);
    // exactly at the 280 boundary with a long URL in it: 256 letters + 1 space + URL (23) = 280
    expect(xLength!("a".repeat(256) + " https://example.com/" + "x".repeat(200))).toBe(280);
  });

  it("weighs CJK and an emoji as 2 each (code points, not UTF-16 units)", async () => {
    const { xLength } = await load();
    expect(typeof xLength, "XTEXT-MISSING: lib/xText must export xLength").toBe("function");
    expect(xLength!("日本語")).toBe(6);
    expect(xLength!("\u{1F600}")).toBe(2);
    expect(xLength!("ok \u{1F600}")).toBe(5);
    expect(xLength!("a".repeat(140) + "日".repeat(70))).toBe(280);
    expect(xLength!("a".repeat(141) + "日".repeat(70))).toBe(281);
  });
});

describe("xComposeUrl", () => {
  it("opens X's compose intent with the exact text prefilled", async () => {
    const { xComposeUrl } = await load();
    expect(typeof xComposeUrl, "XTEXT-MISSING: lib/xText must export xComposeUrl").toBe("function");
    const text = "Line one & two #ship 1+1=2 100%\nhttps://example.com/?a=1&b=2 \u{1F600}";
    const u = new URL(xComposeUrl!(text));
    expect(u.protocol).toBe("https:");
    expect(u.hostname).toMatch(/^(www\.)?(x|twitter)\.com$/);
    expect(["/intent/post", "/intent/tweet"]).toContain(u.pathname);
    expect(u.searchParams.get("text")).toBe(text);
  });
});
