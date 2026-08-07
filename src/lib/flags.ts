import type { AccountStatus, EmployeeStatus, FieldState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings, type AppSettings } from "@/lib/settings";

/**
 * The dormancy / expiry rule engine.
 *
 * The rule that matters most: an account can only be called dormant if we can
 * actually see its last login. Where the vendor does not expose last login the
 * account is `unverifiable` — an honest "we cannot tell" — and never dormant.
 * Where the field is exposed but nobody has captured it yet, that is
 * outstanding work (`last_login_missing`), which is a different problem again.
 */

export const FLAGS = {
  dormant: "dormant",
  unverifiable: "unverifiable",
  lastLoginMissing: "last_login_missing",
  unmatched: "unmatched",
  leaverWithAccess: "leaver_with_access",
  expiringSoon: "expiring_soon",
  expired: "expired",
  noJustification: "no_justification",
  neverReviewed: "never_reviewed",
  reviewOverdue: "review_overdue",
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

export const FLAG_LABELS: Record<FlagKey, string> = {
  dormant: "Dormant",
  unverifiable: "Unverifiable",
  last_login_missing: "Last login not captured",
  unmatched: "Unmatched to person",
  leaver_with_access: "Leaver with access",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  no_justification: "No justification",
  never_reviewed: "Never reviewed",
  review_overdue: "Review overdue",
};

export const FLAG_DESCRIPTIONS: Record<FlagKey, string> = {
  dormant: "No login recorded within the dormancy window.",
  unverifiable: "This vendor does not expose last login, so dormancy cannot be assessed.",
  last_login_missing: "The vendor exposes last login but no value has been captured yet.",
  unmatched: "Not yet linked to a person in the register.",
  leaver_with_access: "The linked person has left but the account is not removed.",
  expiring_soon: "Account or password expiry falls inside the configured window.",
  expired: "Account or password expiry has already passed.",
  no_justification: "No recorded reason for this access.",
  never_reviewed: "This account has never been confirmed or reviewed by a human.",
  review_overdue: "Not reviewed within this vendor's review frequency.",
};

export type FlagInput = {
  accountStatus: AccountStatus;
  personId: string | null;
  personEmployeeStatus: EmployeeStatus | null;
  lastLogin: Date | null;
  lastLoginState: FieldState;
  accountExpiry: Date | null;
  accountExpiryState: FieldState;
  passwordExpiry: Date | null;
  passwordExpiryState: FieldState;
  justification: string;
  lastConfirmed: Date | null;
  lastReviewedAt: Date | null;
  reviewFrequencyMonths: number;
};

function monthsAgo(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() - months);
  return d;
}

function daysAhead(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

/** Pure: given a record's state and the settings, what should it be flagged? */
export function computeFlags(
  input: FlagInput,
  settings: AppSettings,
  now: Date = new Date(),
): FlagKey[] {
  const flags = new Set<FlagKey>();

  if (!input.personId) flags.add(FLAGS.unmatched);

  // A removed account is history. Dormancy, expiry and review pressure no
  // longer apply to it, so we stop flagging beyond the matching gap above.
  if (input.accountStatus === "REMOVED") return [...flags];

  // --- Dormancy, and its honest alternatives -------------------------------
  if (input.lastLoginState === "NOT_EXPOSED") {
    flags.add(FLAGS.unverifiable);
  } else if (input.lastLogin) {
    if (input.lastLogin < monthsAgo(now, settings.dormantMonths)) flags.add(FLAGS.dormant);
  } else if (input.lastLoginState === "BLANK") {
    flags.add(FLAGS.lastLoginMissing);
  } else {
    // CAPTURED with no value: the vendor told us this account has never been
    // used. That is dormant by any reading.
    flags.add(FLAGS.dormant);
  }

  // --- Leavers -------------------------------------------------------------
  if (input.personEmployeeStatus === "LEFT") flags.add(FLAGS.leaverWithAccess);

  // --- Expiry --------------------------------------------------------------
  const horizon = daysAhead(now, settings.expiryWindowDays);
  for (const [value, state] of [
    [input.accountExpiry, input.accountExpiryState],
    [input.passwordExpiry, input.passwordExpiryState],
  ] as const) {
    if (state === "NOT_EXPOSED" || !value) continue;
    if (value < now) flags.add(FLAGS.expired);
    else if (value <= horizon) flags.add(FLAGS.expiringSoon);
  }

  // --- Review hygiene ------------------------------------------------------
  if (!input.justification.trim()) flags.add(FLAGS.noJustification);

  const lastHumanTouch = input.lastReviewedAt ?? input.lastConfirmed;
  if (!lastHumanTouch) {
    flags.add(FLAGS.neverReviewed);
  } else if (lastHumanTouch < monthsAgo(now, input.reviewFrequencyMonths)) {
    flags.add(FLAGS.reviewOverdue);
  }

  return [...flags].sort();
}

type RecordForFlags = FlagInput & { id: string; flags: string[] };

/**
 * Recompute and persist flags for a set of records.
 * Flags are derived state, so this is safe to re-run at any time; it writes
 * only where the computed set actually differs.
 */
export async function refreshFlagsForRecords(recordIds: string[]): Promise<number> {
  if (recordIds.length === 0) return 0;
  const settings = await getSettings();
  const now = new Date();

  const records = await prisma.accessRecord.findMany({
    where: { id: { in: recordIds } },
    select: {
      id: true,
      flags: true,
      accountStatus: true,
      personId: true,
      lastLogin: true,
      lastLoginState: true,
      accountExpiry: true,
      accountExpiryState: true,
      passwordExpiry: true,
      passwordExpiryState: true,
      justification: true,
      lastConfirmed: true,
      lastReviewedAt: true,
      person: { select: { employeeStatus: true } },
      vendor: { select: { reviewFrequencyMonths: true } },
    },
  });

  let updated = 0;
  for (const r of records) {
    const input: RecordForFlags = {
      id: r.id,
      flags: r.flags,
      accountStatus: r.accountStatus,
      personId: r.personId,
      personEmployeeStatus: r.person?.employeeStatus ?? null,
      lastLogin: r.lastLogin,
      lastLoginState: r.lastLoginState,
      accountExpiry: r.accountExpiry,
      accountExpiryState: r.accountExpiryState,
      passwordExpiry: r.passwordExpiry,
      passwordExpiryState: r.passwordExpiryState,
      justification: r.justification,
      lastConfirmed: r.lastConfirmed,
      lastReviewedAt: r.lastReviewedAt,
      reviewFrequencyMonths: r.vendor.reviewFrequencyMonths,
    };
    const next = computeFlags(input, settings, now);
    const same =
      next.length === r.flags.length && next.every((f, i) => f === [...r.flags].sort()[i]);
    if (same) continue;

    await prisma.accessRecord.update({
      where: { id: r.id },
      data: { flags: next, flagsSyncedAt: now },
    });
    updated += 1;
  }
  return updated;
}

/** Recompute flags across the whole register, in batches. */
export async function refreshAllFlags(): Promise<number> {
  const ids = await prisma.accessRecord.findMany({ select: { id: true } });
  let updated = 0;
  for (let i = 0; i < ids.length; i += 500) {
    updated += await refreshFlagsForRecords(ids.slice(i, i + 500).map((r) => r.id));
  }
  return updated;
}
