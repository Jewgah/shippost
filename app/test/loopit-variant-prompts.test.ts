import { describe, it, expect } from "vitest";

// Acceptance check (loopit gentle-twirling-oasis): adding an option to the LinkedIn queue renders
// 3 candidate images. Which prompt + seed each one uses is decided by a pure helper exported from
// the draft parser: every AI prompt of the option's "Suggested visuals" block, in idea order, then
// extra seeds of the first prompt until there are 3. No AI prompt at all means no images.

type Variant = { prompt: string; seed: number };
type VariantFn = (visual: string) => Variant[];

const loadFn = async (): Promise<VariantFn | undefined> => {
  const mod = (await import("@/lib/draftParser")) as Record<string, unknown>;
  return typeof mod.variantPrompts === "function" ? (mod.variantPrompts as VariantFn) : undefined;
};

const P1 = "a laptop on a desk at night, candid, natural light, 35mm";
const P2 = "an empty office at dawn, wide angle, subtle grain";

const TWO = `1. a desk at night - AI prompt: "${P1}"
2. before/after screenshot (screenshot - no AI)
3. an office - AI prompt: "${P2}"`;

const ONE = `1. before/after screenshot (screenshot - no AI)
2. a desk at night - AI prompt: "${P1}"
3. the brand logo`;

const ZERO = `1. before/after screenshot (screenshot - no AI)
2. the brand logo
3. a photo of the team`;

const seedsOk = (v: Variant[]) => v.every((x) => Number.isInteger(x.seed) && x.seed >= 0);

describe("variantPrompts (3 images per queued post)", () => {
  it("2 AI prompts give both prompts in idea order, then one extra seed of the first", async () => {
    const fn = await loadFn();
    const v = fn ? fn(TWO) : [];
    expect(v.map((x) => x.prompt), "variantPrompts: 2 AI prompts must give [p1, p2, p1]").toEqual([P1, P2, P1]);
    expect(seedsOk(v), "variantPrompts: every variant needs an integer seed").toBe(true);
    expect(v[2].seed, "variantPrompts: the repeated prompt must use a different seed").not.toBe(v[0].seed);
  });

  it("1 AI prompt gives that prompt three times with three different seeds", async () => {
    const fn = await loadFn();
    const v = fn ? fn(ONE) : [];
    expect(v.map((x) => x.prompt), "variantPrompts: 1 AI prompt must give [p1, p1, p1]").toEqual([P1, P1, P1]);
    expect(seedsOk(v), "variantPrompts: every variant needs an integer seed").toBe(true);
    expect(new Set(v.map((x) => x.seed)).size, "variantPrompts: the 3 seeds must differ").toBe(3);
  });

  it("no AI prompt gives no variants", async () => {
    const fn = await loadFn();
    expect(typeof fn, "variantPrompts must be exported from the draft parser").toBe("function");
    expect(fn!(ZERO)).toEqual([]);
    expect(fn!("")).toEqual([]);
  });
});
