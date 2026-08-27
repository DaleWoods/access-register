/**
 * How stale a vendor's uploaded data is, judged against that vendor's own
 * review frequency rather than one global number.
 *
 * A vendor reviewed quarterly and last uploaded eight months ago is a different
 * problem from an annually-reviewed one at the same age. Pure and unit-tested;
 * both the Vendors list and the dashboard render from this so the two screens
 * can never disagree about what "stale" means.
 */

export type FreshnessState =
  /** Captured by hand — there is no upload to be overdue. */
  | "manual"
  /** No committed import has ever run for this vendor. */
  | "never"
  /** Inside the vendor's review frequency. */
  | "fresh"
  /** Past the review frequency, but less than twice it. */
  | "due"
  /** More than twice the review frequency. */
  | "stale";

export type Freshness = {
  state: FreshnessState;
  /** Whole days since the last committed upload; null when there is none. */
  days: number | null;
  /** Days the vendor's own review frequency allows before "due". */
  expectedWithinDays: number;
};

/** Months are rendered as whole days at the usual average length. */
const DAYS_PER_MONTH = 30.44;

export function uploadFreshness(
  input: {
    captureMethod: string;
    lastUploadAt: Date | null;
    reviewFrequencyMonths: number;
  },
  now: Date = new Date(),
): Freshness {
  const expectedWithinDays = Math.round(input.reviewFrequencyMonths * DAYS_PER_MONTH);

  if (input.captureMethod === "MANUAL_READ") {
    return { state: "manual", days: null, expectedWithinDays };
  }
  if (!input.lastUploadAt) {
    return { state: "never", days: null, expectedWithinDays };
  }

  const days = Math.floor((now.getTime() - input.lastUploadAt.getTime()) / 86_400_000);
  const state: FreshnessState =
    days <= expectedWithinDays ? "fresh" : days <= expectedWithinDays * 2 ? "due" : "stale";

  return { state, days, expectedWithinDays };
}

export const FRESHNESS_LABELS: Record<FreshnessState, string> = {
  manual: "Entered by hand",
  never: "Never uploaded",
  fresh: "Up to date",
  due: "Refresh due",
  stale: "Overdue",
};

/** True where the vendor needs chasing for a new export. */
export function needsRefresh(state: FreshnessState): boolean {
  return state === "never" || state === "due" || state === "stale";
}
