import { describe, it, expect } from "vitest";
import { computeCadence } from "@/lib/voice";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

describe("computeCadence", () => {
  it("empty log: due, no streak, nothing posted", () => {
    expect(computeCadence([], NOW)).toEqual({
      lastPostedAt: null,
      daysSince: null,
      due: true,
      streak: 0,
      total: 0,
    });
  });

  it("posted a couple hours ago: not due, 0 days since, streak 1", () => {
    const c = computeCadence([NOW - 2 * 3_600_000], NOW);
    expect(c.due).toBe(false);
    expect(c.daysSince).toBe(0);
    expect(c.streak).toBe(1);
    expect(c.total).toBe(1);
  });

  it("becomes due once it has been >= 2 days", () => {
    expect(computeCadence([NOW - 2 * DAY], NOW).due).toBe(true);
    expect(computeCadence([NOW - 1 * DAY], NOW).due).toBe(false);
  });

  it("counts a consecutive on-cadence streak (gaps <= 3 days)", () => {
    const ts = [NOW, NOW - 2 * DAY, NOW - 4 * DAY, NOW - 6 * DAY];
    expect(computeCadence(ts, NOW).streak).toBe(4);
  });

  it("breaks the streak on a gap > 3 days", () => {
    const ts = [NOW, NOW - 2 * DAY, NOW - 7 * DAY, NOW - 9 * DAY];
    expect(computeCadence(ts, NOW).streak).toBe(2);
  });

  it("dedupes multiple posts on the same day for the streak (but not the total)", () => {
    const ts = [NOW, NOW - 3_600_000, NOW - 2 * DAY]; // two today + one 2 days ago
    const c = computeCadence(ts, NOW);
    expect(c.total).toBe(3);
    expect(c.streak).toBe(2);
  });
});
