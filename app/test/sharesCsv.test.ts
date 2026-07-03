import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { parseShares } from "@/lib/sharesCsv";

const CSV = `Date,ShareLink,ShareCommentary,SharedUrl,Visibility
2025-01-01,http://a,"First post, has a comma and
a newline inside quotes.",,MEMBER_NETWORK
2025-02-01,http://b,"Second real post here.",,MEMBER_NETWORK
2025-03-01,http://c,,https://reshared.example,MEMBER_NETWORK
2025-04-01,http://d,"https://only-a-url.example",,MEMBER_NETWORK
`;

describe("parseShares — CSV", () => {
  it("auto-detects ShareCommentary and strips empty reshares + url-only rows", () => {
    const r = parseShares(Buffer.from(CSV), "Shares.csv");
    expect(r.column).toBe("ShareCommentary");
    expect(r.posts).toHaveLength(2);
    expect(r.posts[0]).toContain("First post");
    expect(r.posts.some((p) => p.includes("only-a-url"))).toBe(false);
  });

  it("detects a spaced/renamed commentary column (locale drift)", () => {
    const csv = `Date,Share Commentary\n2025-01-01,"Hello world."\n`;
    const r = parseShares(Buffer.from(csv), "Shares.csv");
    expect(r.column).toBe("Share Commentary");
    expect(r.posts).toEqual(["Hello world."]);
  });

  it("caps to the most-recent 30 posts (oldest dropped)", () => {
    let csv = "Date,ShareCommentary\n";
    for (let i = 1; i <= 35; i++) {
      const day = String(i).padStart(2, "0");
      csv += `2025-01-${day},"post number ${i}"\n`;
    }
    const r = parseShares(Buffer.from(csv), "Shares.csv");
    expect(r.posts).toHaveLength(30);
    // newest (35) kept, oldest (1) dropped
    expect(r.posts.some((p) => p === "post number 35")).toBe(true);
    expect(r.posts.some((p) => p === "post number 1")).toBe(false);
  });

  it("orders non-ISO (US M/D/YYYY) dates chronologically, not lexically", () => {
    // lexically "9/..." > "10/...", so a string sort would call September the newest
    const csv = `Date,ShareCommentary\n10/01/2025,"october post"\n9/01/2025,"september post"\n`;
    const r = parseShares(Buffer.from(csv), "Shares.csv");
    expect(r.posts).toEqual(["september post", "october post"]);
  });

  it("throws a clear error when no commentary column exists", () => {
    const csv = `Date,ShareLink\n2025-01-01,http://x\n`;
    expect(() => parseShares(Buffer.from(csv), "Shares.csv")).toThrow(/column/i);
  });
});

describe("parseShares — ZIP", () => {
  it("finds Shares.csv inside a .zip", () => {
    const zip = new AdmZip();
    zip.addFile("LinkedInExport/Shares.csv", Buffer.from(CSV, "utf8"));
    zip.addFile("LinkedInExport/Other.csv", Buffer.from("a,b\n1,2\n", "utf8"));
    const buf = zip.toBuffer();
    const r = parseShares(buf, "export.zip");
    expect(r.column).toBe("ShareCommentary");
    expect(r.posts).toHaveLength(2);
  });
});
