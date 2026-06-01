import { describe, it, expect } from "vitest";
import { formatDraftId, isDraftId } from "@/lib/draftId";

describe("formatDraftId", () => {
  it("formats a timestamped run id as date + HH:MM", () => {
    expect(formatDraftId("2026-05-31_143005")).toBe("2026-05-31 14:30");
  });
  it("leaves a legacy plain-date id untouched", () => {
    expect(formatDraftId("2026-05-31")).toBe("2026-05-31");
  });
  it("leaves an unrecognized id untouched", () => {
    expect(formatDraftId("not-a-date")).toBe("not-a-date");
    expect(formatDraftId("2026-05-31_1430")).toBe("2026-05-31_1430"); // 4-digit time is not a valid id
  });
});

describe("isDraftId — format + path-traversal guard", () => {
  it("accepts a plain date and a timestamped run", () => {
    expect(isDraftId("2026-05-31")).toBe(true);
    expect(isDraftId("2026-05-31_143005")).toBe(true);
  });

  it("rejects path-traversal / absolute / injection attempts", () => {
    for (const bad of [
      "../etc/passwd",
      "../../2026-05-31",
      "/etc/passwd",
      "2026-05-31/..",
      "2026-05-31/../../etc/passwd",
      "2026-05-31; rm -rf /",
      "$(whoami)",
      "..",
      ".",
    ]) {
      expect(isDraftId(bad), bad).toBe(false);
    }
  });

  it("rejects malformed ids (padding, extension, whitespace, control chars)", () => {
    expect(isDraftId("2026-5-31")).toBe(false); // unpadded
    expect(isDraftId("2026-05-31.md")).toBe(false); // includes extension
    expect(isDraftId("2026-05-31_1430")).toBe(false); // 4-digit time
    expect(isDraftId("2026-05-31_14300500")).toBe(false); // 8-digit time
    expect(isDraftId("2026-05-31 ")).toBe(false); // trailing space
    expect(isDraftId(" 2026-05-31")).toBe(false); // leading space
    expect(isDraftId(`2026-05-31${String.fromCharCode(0)}`)).toBe(false); // null byte
    expect(isDraftId("2026-05-31\n2026-05-31")).toBe(false); // newline (no multiline bypass)
    expect(isDraftId("")).toBe(false);
  });
});
