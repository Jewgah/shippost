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

  it("mixed parseable/unparseable dates fall back to one consistent lexical order", () => {
    // one garbage date would make a per-pair timestamp/lexical mix non-transitive —
    // the whole set must degrade to the deterministic lexical order instead
    const csv = `Date,ShareCommentary\n10/01/2025,"b"\nnot-a-date,"c"\n9/01/2025,"a"\n`;
    const r = parseShares(Buffer.from(csv), "Shares.csv");
    expect(r.posts).toEqual(["b", "a", "c"]); // lexical: 10/01 < 9/01 < not-a-date
  });

  it("throws a clear error when no commentary column exists", () => {
    const csv = `Date,ShareLink\n2025-01-01,http://x\n`;
    expect(() => parseShares(Buffer.from(csv), "Shares.csv")).toThrow(/column/i);
  });
});

// The shape of LinkedIn's messages.csv (DMs): a CONTENT column, no commentary column.
const MESSAGES_CSV = `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER
c1,,Someone,http://x,Me,http://y,2025-01-01 10:00:00 UTC,,"Hi %FIRSTNAME%, quick question about your team",INBOX
c2,,Me,http://y,Someone,http://x,2025-01-02 10:00:00 UTC,,"Oui",INBOX
`;

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

  it("a zip with messages.csv and no Shares.csv throws, naming the CSVs it saw (no first-.csv fallback)", () => {
    // Regression: this exact zip once imported 30 DMs as the voice corpus.
    const zip = new AdmZip();
    zip.addFile("LinkedInExport/messages.csv", Buffer.from(MESSAGES_CSV, "utf8"));
    zip.addFile("LinkedInExport/Connections.csv", Buffer.from("a,b\n1,2\n", "utf8"));
    expect(() => parseShares(zip.toBuffer(), "export.zip")).toThrow(/messages\.csv.*Connections\.csv|Connections\.csv.*messages\.csv/);
    expect(() => parseShares(zip.toBuffer(), "export.zip")).toThrow(/Shares\.csv/);
  });

  it("Shares.csv still wins when messages.csv sits next to it", () => {
    const zip = new AdmZip();
    zip.addFile("LinkedInExport/messages.csv", Buffer.from(MESSAGES_CSV, "utf8"));
    zip.addFile("LinkedInExport/Shares.csv", Buffer.from(CSV, "utf8"));
    const r = parseShares(zip.toBuffer(), "export.zip");
    expect(r.column).toBe("ShareCommentary");
    expect(r.posts).toHaveLength(2);
  });
});

describe("parseShares — messages.csv is never a voice corpus", () => {
  it("a raw file named messages.csv is rejected by name", () => {
    expect(() => parseShares(Buffer.from(MESSAGES_CSV), "messages.csv")).toThrow(/DMs, not your posts/);
  });

  it("a renamed messages export (CONTENT column, no commentary) finds no post column", () => {
    // "content" and "message" left the fallback list: the DM column shape must not import.
    expect(() => parseShares(Buffer.from(MESSAGES_CSV), "Shares.csv")).toThrow(/column/i);
  });
});
