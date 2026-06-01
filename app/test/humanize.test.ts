import { describe, it, expect } from "vitest";
import { humanizeText } from "@/lib/draftParser";

describe("humanizeText — strip AI tells from post text", () => {
  it("turns em-dashes into a spaced hyphen", () => {
    expect(humanizeText("fast — clean")).toBe("fast - clean");
    expect(humanizeText("fast—clean")).toBe("fast - clean");
  });

  it("turns en-dashes into a spaced hyphen", () => {
    expect(humanizeText("5–10 minutes")).toBe("5 - 10 minutes");
  });

  it("turns arrows into the word 'to'", () => {
    expect(humanizeText("problem → solution")).toBe("problem to solution");
    expect(humanizeText("A→B")).toBe("A to B");
    expect(humanizeText("idea ⇒ ship")).toBe("idea to ship");
  });

  it("leaves plain text and ASCII hyphens untouched", () => {
    expect(humanizeText("build-in-public, smart-ai")).toBe("build-in-public, smart-ai");
    expect(humanizeText("a normal sentence.")).toBe("a normal sentence.");
  });

  it("does not collapse newlines (paragraph breaks survive)", () => {
    expect(humanizeText("line one\n\nline two")).toBe("line one\n\nline two");
    expect(humanizeText("hook\n\nbody — more")).toBe("hook\n\nbody - more");
  });

  it("is idempotent", () => {
    const once = humanizeText("ship — fast → done");
    expect(once).toBe("ship - fast to done");
    expect(humanizeText(once)).toBe(once);
  });
});
