import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { aggregateScope, canWrite } from "@/lib/auth/policy";
import { getSettings } from "@/lib/settings";
import { FLAGS } from "@/lib/flags";
import { recentSnapshots } from "@/lib/snapshots";
import { needsRefresh, uploadFreshness } from "@/lib/freshness";
import { Alert, Card, EmptyState, PageHeader, Stat, formatDate } from "@/components/ui";
import { LastUpload } from "@/components/freshness";
import { TrendChart } from "@/components/trend-chart";
import { refreshFlags } from "@/app/actions/records";
import { SavedNotice } from "@/components/saved-notice";

export const dynamic = "force-dynamic";

/**
 * Two jobs, deliberately kept apart.
 *
 * "Needs attention" is the worklist — what to go and do, ordered by urgency.
 * "Assurance" is the view you would show an auditor — is the process running,
 * is the data current, is it getting better or worse. Muddling them produces a
 * screen that serves neither.
 */

/** ISO day string, which is what the chart plots against. */
function toDayString(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const user = await requireUser();
  const settings = await getSettings();
  const scope = aggregateScope(toActor(user), settings.vendorOwnerAggregateAccess);
  const vendorFilter = scope ? { vendorId: { in: scope } } : {};

  const [
    totalActive,
    totalRemoved,
    dormant,
    unverifiable,
    unmatched,
    leaversWithAccess,
    leaversWithAccessPeople,
    neverReviewed,
    reviewOverdue,
    expiringSoon,
    reviewedEver,
    liveAccounts,
    perVendor,
    upcoming,
    openLeaverCases,
    stagedBatches,
    snapshots,
  ] = await Promise.all([
    prisma.accessRecord.count({ where: { ...vendorFilter, accountStatus: "ACTIVE" } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, accountStatus: "REMOVED" } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.dormant } } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.unverifiable } } }),
    prisma.accessRecord.count({
      where: { ...vendorFilter, personId: null, accountStatus: { not: "REMOVED" } },
    }),
    prisma.accessRecord.count({
      where: { ...vendorFilter, flags: { has: FLAGS.leaverWithAccess } },
    }),
    // "Leavers" means people, which is what someone reading the tile expects.
    // The accounts figure sits alongside it, because that is the work.
    prisma.person.count({
      where: {
        employeeStatus: "LEFT",
        accessRecords: { some: { ...vendorFilter, accountStatus: { not: "REMOVED" } } },
      },
    }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.neverReviewed } } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.reviewOverdue } } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.expiringSoon } } }),
    // Review coverage: a human has confirmed or reviewed the row at least once.
    prisma.accessRecord.count({
      where: {
        ...vendorFilter,
        accountStatus: { not: "REMOVED" },
        NOT: { AND: [{ lastReviewedAt: null }, { lastConfirmed: null }] },
      },
    }),
    prisma.accessRecord.count({
      where: { ...vendorFilter, accountStatus: { not: "REMOVED" } },
    }),
    prisma.vendor.findMany({
      where: { isArchived: false, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
      include: {
        owner: { select: { fullName: true } },
        _count: { select: { accessRecords: true } },
        accessRecords: { select: { accountStatus: true, flags: true } },
        importBatches: {
          where: { status: "COMMITTED" },
          orderBy: { importedAt: "desc" },
          take: 1,
          select: { importedAt: true, sourceFilename: true, rowCount: true },
        },
      },
    }),
    prisma.accessRecord.findMany({
      where: {
        ...vendorFilter,
        accountStatus: { not: "REMOVED" },
        OR: [
          { flags: { has: FLAGS.expiringSoon } },
          { flags: { has: FLAGS.expired } },
        ],
      },
      include: { vendor: { select: { name: true } }, person: { select: { fullName: true } } },
      orderBy: { accountExpiry: "asc" },
      take: 12,
    }),
    prisma.leaverCase.count({ where: { status: "OPEN" } }),
    prisma.importBatch.count({
      where: { status: "STAGED", ...(scope ? { vendorId: { in: scope } } : {}) },
    }),
    // Snapshots are estate-wide, so they are only honest for a viewer whose
    // aggregate scope is unrestricted. A scoped vendor owner gets everything
    // else on this page, just not a trend that counts vendors they cannot see.
    scope === null ? recentSnapshots(90) : Promise.resolve([]),
  ]);

  // A week back where possible, else the oldest snapshot we hold.
  const previous =
    snapshots.length > 1
      ? snapshots[Math.max(0, snapshots.length - 8)]
      : null;
  const deltaSince = previous ? "vs last week" : "";
  const delta = (current: number, was: number | undefined) =>
    previous && was !== undefined ? { value: current - was, since: deltaSince } : undefined;

  const trendPoints = snapshots.map((s) => ({
    day: toDayString(s.day),
    dormant: s.dormant,
    unmatched: s.unmatched,
    reviewOverdue: s.reviewOverdue,
  }));

  const staleVendors = perVendor.filter((vendor) =>
    needsRefresh(
      uploadFreshness({
        captureMethod: vendor.captureMethod,
        lastUploadAt: vendor.importBatches[0]?.importedAt ?? null,
        reviewFrequencyMonths: vendor.reviewFrequencyMonths,
      }).state,
    ),
  ).length;

  const reviewCoverage = liveAccounts === 0 ? 0 : Math.round((reviewedEver / liveAccounts) * 100);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Who has access to what, and whether they should still have it. Dormancy threshold: ${settings.dormantMonths} months.`}
        actions={
          canWrite(user.role) ? (
            <form action={refreshFlags}>
              <button type="submit" className="btn-secondary">
                Recalculate flags
              </button>
            </form>
          ) : null
        }
      />

      <SavedNotice searchParams={query}>
        Flags recalculated across every account.
      </SavedNotice>

      {/* ---------------------------------------------------------------- */}
      {/* Needs attention — the worklist                                    */}
      {/* ---------------------------------------------------------------- */}

      <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Needs attention
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        What to work through, most urgent first. Every tile is a filtered view of the register —
        click one to see the accounts behind it.
      </p>

      {leaversWithAccess > 0 ? (
        <div className="mb-3">
          <Alert tone="error" title="Leavers with access">
            {leaversWithAccessPeople} {leaversWithAccessPeople === 1 ? "person has" : "people have"}{" "}
            left and still hold access, across {leaversWithAccess} account
            {leaversWithAccess === 1 ? "" : "s"}.{" "}
            <Link href={`/register?flag=${FLAGS.leaverWithAccess}`} className="link">
              Review them now
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      {stagedBatches > 0 ? (
        <div className="mb-3">
          <Alert tone="warn">
            {stagedBatches} import{stagedBatches === 1 ? " is" : "s are"} staged and awaiting
            review. <Link href="/import" className="link">Go to imports</Link>.
          </Alert>
        </div>
      ) : null}

      {staleVendors > 0 ? (
        <div className="mb-3">
          <Alert tone="warn">
            {staleVendors} vendor{staleVendors === 1 ? " has" : "s have"} not been refreshed within
            their review frequency — the register may be out of date for{" "}
            {staleVendors === 1 ? "it" : "them"}.{" "}
            <Link href="/vendors" className="link">
              See which
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat
          label={
            leaversWithAccess === leaversWithAccessPeople
              ? "Leavers with access"
              : `Leavers with access (${leaversWithAccess} accounts)`
          }
          value={leaversWithAccessPeople}
          tone={leaversWithAccessPeople ? "danger" : "good"}
          href={`/register?flag=${FLAGS.leaverWithAccess}`}
          delta={delta(leaversWithAccessPeople, previous?.leaverPeople)}
        />
        <Stat
          label="Overdue review"
          value={reviewOverdue}
          tone={reviewOverdue ? "warn" : "good"}
          href={`/register?flag=${FLAGS.reviewOverdue}`}
          delta={delta(reviewOverdue, previous?.reviewOverdue)}
        />
        <Stat
          label="Expiring soon"
          value={expiringSoon}
          tone={expiringSoon ? "warn" : "good"}
          href={`/register?flag=${FLAGS.expiringSoon}`}
          delta={delta(expiringSoon, previous?.expiringSoon)}
        />
        <Stat
          label="Dormant"
          value={dormant}
          tone={dormant ? "warn" : "good"}
          href={`/register?flag=${FLAGS.dormant}`}
          delta={delta(dormant, previous?.dormant)}
        />
        <Stat
          label="Unmatched to a person"
          value={unmatched}
          tone={unmatched ? "warn" : "good"}
          href="/register?unmatched=1"
          delta={delta(unmatched, previous?.unmatched)}
        />
        <Stat label="Open leaver cases" value={openLeaverCases} href="/leavers" />
      </div>

      <Card
        title={`Upcoming and passed expiries (within ${settings.expiryWindowDays} days)`}
        className="mt-4 overflow-hidden"
      >
        {upcoming.length === 0 ? (
          <EmptyState>Nothing expiring in the configured window.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Account</th>
                  <th>Person</th>
                  <th>Account expiry</th>
                  <th>Password expiry</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((record) => (
                  <tr key={record.id}>
                    <td>{record.vendor.name}</td>
                    <td>
                      <Link href={`/register/${record.id}`} className="link font-mono text-xs">
                        {record.rawUsername || record.rawEmail}
                      </Link>
                    </td>
                    <td className="text-xs">{record.person?.fullName ?? "—"}</td>
                    <td className="text-xs">{formatDate(record.accountExpiry) || "—"}</td>
                    <td className="text-xs">{formatDate(record.passwordExpiry) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Assurance — the view you would show someone else                  */}
      {/* ---------------------------------------------------------------- */}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Assurance
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Evidence the process is running: how much of the estate is covered, how current the data
        is, and which way the numbers are moving.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Accounts on record" value={liveAccounts} href="/register" />
        <Stat
          label="Reviewed at least once"
          value={`${reviewCoverage}%`}
          tone={reviewCoverage === 100 ? "good" : reviewCoverage >= 80 ? "default" : "warn"}
          href={`/register?notFlag=${FLAGS.neverReviewed}`}
        />
        <Stat
          label="Never reviewed"
          value={neverReviewed}
          tone={neverReviewed ? "warn" : "good"}
          href={`/register?flag=${FLAGS.neverReviewed}`}
          delta={delta(neverReviewed, previous?.neverReviewed)}
        />
        <Stat
          label="Unverifiable"
          value={unverifiable}
          href={`/register?flag=${FLAGS.unverifiable}`}
        />
        <Stat label="Active accounts" value={totalActive} href="/register?accountStatus=ACTIVE" />
        <Stat label="Removed" value={totalRemoved} href="/register?accountStatus=REMOVED" />
      </div>

      {scope === null ? (
        <Card title="Open issues over time" className="mt-4 overflow-hidden">
          <TrendChart points={trendPoints} />
        </Card>
      ) : null}

      <Card title="Vendor coverage" className="mt-4 overflow-hidden">
        {perVendor.length === 0 ? (
          <EmptyState>No vendors yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Owner</th>
                  <th>Active</th>
                  <th>Removed</th>
                  <th>Flagged</th>
                  <th>Last login exposed</th>
                  <th>Data freshness</th>
                </tr>
              </thead>
              <tbody>
                {perVendor.map((vendor) => {
                  const active = vendor.accessRecords.filter((r) => r.accountStatus === "ACTIVE").length;
                  const removed = vendor.accessRecords.filter((r) => r.accountStatus === "REMOVED").length;
                  const flagged = vendor.accessRecords.filter(
                    (r) => r.accountStatus !== "REMOVED" && r.flags.length > 0,
                  ).length;
                  return (
                    <tr key={vendor.id}>
                      <td>
                        <Link href={`/register?vendorId=${vendor.id}`} className="link font-medium">
                          {vendor.name}
                        </Link>
                      </td>
                      <td className="text-xs">{vendor.owner?.fullName ?? "—"}</td>
                      <td className="tabular-nums">{active}</td>
                      <td className="tabular-nums text-slate-500">{removed}</td>
                      <td className="tabular-nums">
                        {flagged ? <span className="text-amber-700">{flagged}</span> : "—"}
                      </td>
                      <td>
                        {vendor.exposesLastLogin ? (
                          <span className="badge bg-emerald-100 text-emerald-800">Yes</span>
                        ) : (
                          <span className="badge bg-slate-200 text-slate-700">No</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        <LastUpload
                          batch={vendor.importBatches[0]}
                          captureMethod={vendor.captureMethod}
                          reviewFrequencyMonths={vendor.reviewFrequencyMonths}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-6 text-xs text-slate-500">
        Every figure here is a filtered view of the register — click one to see the underlying
        accounts, then export exactly what you are looking at.
      </p>
    </>
  );
}
