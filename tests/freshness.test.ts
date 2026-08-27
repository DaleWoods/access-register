import { describe, expect, it } from "vitest";
import { needsRefresh, uploadFreshness } from "@/lib/freshness";

/**
 * Freshness is judged against each vendor's own review frequency, so the same
 * age is fine for one vendor and overdue for another. Pure, so tested directly.
 */

const NOW = new Date("2026-08-27T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("upload freshness", () => {
  it("never calls a hand-entered vendor overdue — there is no export to upload", () => {
    const result = uploadFreshness(
      { captureMethod: "MANUAL_READ", lastUploadAt: null, reviewFrequencyMonths: 3 },
      NOW,
    );
    expect(result.state).toBe("manual");
    expect(needsRefresh(result.state)).toBe(false);
  });

  it("flags a vendor that has never been uploaded to", () => {
    const result = uploadFreshness(
      { captureMethod: "CSV_EXPORT", lastUploadAt: null, reviewFrequencyMonths: 3 },
      NOW,
    );
    expect(result.state).toBe("never");
    expect(needsRefresh(result.state)).toBe(true);
  });

  it("treats an upload inside the review frequency as up to date", () => {
    const result = uploadFreshness(
      { captureMethod: "CSV_EXPORT", lastUploadAt: daysAgo(30), reviewFrequencyMonths: 3 },
      NOW,
    );
    expect(result.state).toBe("fresh");
    expect(result.days).toBe(30);
    expect(needsRefresh(result.state)).toBe(false);
  });

  it("judges the same age differently for different review frequencies", () => {
    const eightMonths = daysAgo(240);

    const quarterly = uploadFreshness(
      { captureMethod: "CSV_EXPORT", lastUploadAt: eightMonths, reviewFrequencyMonths: 3 },
      NOW,
    );
    const annual = uploadFreshness(
      { captureMethod: "CSV_EXPORT", lastUploadAt: eightMonths, reviewFrequencyMonths: 12 },
      NOW,
    );

    // 240 days is more than twice a quarterly cycle, but well inside an annual one.
    expect(quarterly.state).toBe("stale");
    expect(annual.state).toBe("fresh");
  });

  it("passes through due before it reaches stale", () => {
    // Quarterly = ~91 days. Just past it is "due"; past double is "stale".
    const due = uploadFreshness(
      { captureMethod: "CSV_EXPORT", lastUploadAt: daysAgo(100), reviewFrequencyMonths: 3 },
      NOW,
    );
    const stale = uploadFreshness(
      { captureMethod: "CSV_EXPORT", lastUploadAt: daysAgo(200), reviewFrequencyMonths: 3 },
      NOW,
    );

    expect(due.state).toBe("due");
    expect(stale.state).toBe("stale");
    expect(needsRefresh(due.state)).toBe(true);
    expect(needsRefresh(stale.state)).toBe(true);
  });
});
