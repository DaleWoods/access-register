import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { Alert, Card, EmptyState, PageHeader, formatDateTime } from "@/components/ui";
import { FLAGS } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function LeaversPage() {
  await requireUser();

  const [cases, leaversWithAccess] = await Promise.all([
    prisma.leaverCase.findMany({
      orderBy: [{ status: "asc" }, { openedAt: "desc" }],
      include: {
        person: true,
        openedBy: true,
        _count: { select: { actions: true } },
        actions: { select: { action: true } },
      },
    }),
    prisma.person.findMany({
      where: {
        employeeStatus: "LEFT",
        accessRecords: { some: { accountStatus: { not: "REMOVED" } } },
        leaverCases: { none: { status: "OPEN" } },
      },
      include: {
        _count: { select: { accessRecords: true } },
        accessRecords: { where: { accountStatus: { not: "REMOVED" } }, select: { id: true } },
      },
      orderBy: { fullName: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Leavers"
        subtitle="Open a case for someone who has left, work every account they hold as a checklist, and finish with an evidenced report."
      />

      {leaversWithAccess.length ? (
        <div className="mb-4">
          <Alert tone="error" title="People who have left but still hold access">
            <ul className="mt-1 space-y-1">
              {leaversWithAccess.map((person) => (
                <li key={person.id}>
                  <Link href={`/people/${person.id}`} className="link font-medium">
                    {person.fullName}
                  </Link>{" "}
                  — {person.accessRecords.length} live account
                  {person.accessRecords.length === 1 ? "" : "s"}{" "}
                  <Link href={`/people/${person.id}/leaver`} className="link">
                    start leaver process
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              See every affected account in the{" "}
              <Link href={`/register?flag=${FLAGS.leaverWithAccess}`} className="link">
                register
              </Link>
              .
            </p>
          </Alert>
        </div>
      ) : null}

      <Card title={`Leaver cases (${cases.length})`} className="overflow-hidden">
        {cases.length === 0 ? (
          <EmptyState>No leaver cases have been opened yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>By</th>
                  <th>Accounts</th>
                  <th>Outstanding</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((leaverCase) => {
                  const outstanding = leaverCase.actions.filter((a) => a.action === "PENDING").length;
                  return (
                    <tr key={leaverCase.id}>
                      <td>
                        <Link href={`/leavers/${leaverCase.id}`} className="link font-medium">
                          {leaverCase.person.fullName}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            leaverCase.status === "OPEN"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {leaverCase.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="text-xs">{formatDateTime(leaverCase.openedAt)}</td>
                      <td className="text-xs">{leaverCase.openedBy?.fullName ?? "—"}</td>
                      <td className="tabular-nums">{leaverCase._count.actions}</td>
                      <td className="tabular-nums">
                        {outstanding ? (
                          <span className="text-red-600">{outstanding}</span>
                        ) : (
                          <span className="text-emerald-600">0</span>
                        )}
                      </td>
                      <td className="text-xs">{formatDateTime(leaverCase.closedAt) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
