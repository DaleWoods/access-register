import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { aggregateScope, canWrite } from "@/lib/auth/policy";
import { getSettings } from "@/lib/settings";
import { FLAGS } from "@/lib/flags";
import { Alert, Card, EmptyState, PageHeader, Stat, formatDate } from "@/components/ui";
import { refreshFlags } from "@/app/actions/records";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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
    neverReviewed,
    reviewOverdue,
    expiringSoon,
    perVendor,
    upcoming,
    openLeaverCases,
    stagedBatches,
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
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.neverReviewed } } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.reviewOverdue } } }),
    prisma.accessRecord.count({ where: { ...vendorFilter, flags: { has: FLAGS.expiringSoon } } }),
    prisma.vendor.findMany({
      where: { isArchived: false, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
      include: {
        owner: { select: { fullName: true } },
        _count: { select: { accessRecords: true } },
        accessRecords: { select: { accountStatus: true, flags: true } },
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
  ]);

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

      {leaversWithAccess > 0 ? (
        <div className="mb-4">
          <Alert tone="error" title="Leavers with access">
            {leaversWithAccess} account{leaversWithAccess === 1 ? "" : "s"} belong to people marked
            as having left.{" "}
            <Link href={`/register?flag=${FLAGS.leaverWithAccess}`} className="link">
              Review them now
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      {stagedBatches > 0 ? (
        <div className="mb-4">
          <Alert tone="warn">
            {stagedBatches} import{stagedBatches === 1 ? " is" : "s are"} staged and awaiting
            review. <Link href="/import" className="link">Go to imports</Link>.
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <Stat label="Active accounts" value={totalActive} href="/register?accountStatus=ACTIVE" />
        <Stat label="Removed" value={totalRemoved} href="/register?accountStatus=REMOVED" />
        <Stat
          label="Leavers with access"
          value={leaversWithAccess}
          tone={leaversWithAccess ? "danger" : "good"}
          href={`/register?flag=${FLAGS.leaverWithAccess}`}
        />
        <Stat
          label="Dormant"
          value={dormant}
          tone={dormant ? "warn" : "good"}
          href={`/register?flag=${FLAGS.dormant}`}
        />
        <Stat
          label="Unverifiable"
          value={unverifiable}
          href={`/register?flag=${FLAGS.unverifiable}`}
        />
        <Stat
          label="Unmatched to a person"
          value={unmatched}
          tone={unmatched ? "warn" : "good"}
          href="/register?unmatched=1"
        />
        <Stat
          label="Never reviewed"
          value={neverReviewed}
          tone={neverReviewed ? "warn" : "good"}
          href={`/register?flag=${FLAGS.neverReviewed}`}
        />
        <Stat
          label="Overdue review"
          value={reviewOverdue}
          tone={reviewOverdue ? "warn" : "good"}
          href={`/register?flag=${FLAGS.reviewOverdue}`}
        />
        <Stat
          label="Expiring soon"
          value={expiringSoon}
          tone={expiringSoon ? "warn" : "good"}
          href={`/register?flag=${FLAGS.expiringSoon}`}
        />
        <Stat label="Open leaver cases" value={openLeaverCases} href="/leavers" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Accounts per vendor" className="overflow-hidden">
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Upcoming and passed expiries (within ${settings.expiryWindowDays} days)`} className="overflow-hidden">
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
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Every figure here is a filtered view of the register — click one to see the underlying
        accounts, then export exactly what you are looking at.
      </p>
    </>
  );
}
