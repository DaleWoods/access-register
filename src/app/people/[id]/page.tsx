import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { canWrite } from "@/lib/auth/policy";
import {
  Alert,
  Card,
  FlagList,
  PageHeader,
  StatefulValue,
  Stat,
  StatusBadge,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import { HistoryTable } from "@/components/history-table";
import { PersonForm } from "./person-form";
import { MergePanel } from "./merge-panel";

export const dynamic = "force-dynamic";

/**
 * The cross-vendor view: one human, every account they hold, everywhere.
 *
 * This is the screen the requirements call the single most important one, and
 * the one the leaver process runs from. It deliberately shows *all* accounts —
 * including removed ones — because "what did they used to have" is an audit
 * question too.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      mergedInto: { select: { id: true, fullName: true } },
      mergedFrom: { select: { id: true, fullName: true } },
    },
  });
  if (!person) notFound();

  // Following a merged person straight through to the survivor keeps old
  // links and bookmarks working.
  if (person.mergedIntoId) redirect(`/people/${person.mergedIntoId}`);

  const [accounts, history, otherPeople, openCase] = await Promise.all([
    prisma.accessRecord.findMany({
      where: { personId: id },
      include: { vendor: true, instance: true },
      orderBy: [{ accountStatus: "asc" }, { vendor: { name: "asc" } }],
    }),
    prisma.auditEvent.findMany({
      where: {
        OR: [
          { entityType: "Person", entityId: id },
          {
            entityType: "AccessRecord",
            entityId: { in: (await prisma.accessRecord.findMany({
              where: { personId: id },
              select: { id: true },
            })).map((r) => r.id) },
          },
        ],
      },
      orderBy: { changedAt: "desc" },
      take: 200,
    }),
    prisma.person.findMany({
      where: { mergedIntoId: null, id: { not: id } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, primaryEmail: true },
    }),
    prisma.leaverCase.findFirst({ where: { personId: id, status: "OPEN" } }),
  ]);

  const live = accounts.filter((a) => a.accountStatus !== "REMOVED");
  const removed = accounts.filter((a) => a.accountStatus === "REMOVED");
  const vendorCount = new Set(live.map((a) => a.vendorId)).size;
  const flagged = live.filter((a) => a.flags.length > 0).length;
  const editable = canWrite(user.role);

  return (
    <>
      <PageHeader
        title={person.fullName}
        subtitle={
          <>
            {person.primaryEmail ?? "no primary email"}
            {person.department ? ` · ${person.department}` : ""}
            {person.lineManager ? ` · reports to ${person.lineManager}` : ""}
          </>
        }
        actions={
          <>
            {person.employeeStatus === "LEFT" ? (
              <span className="badge bg-red-100 text-red-800">Left</span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-800">
                {person.employeeStatus === "ACTIVE" ? "Active" : "Status unknown"}
              </span>
            )}
            <a className="btn-secondary" href={`/api/export/person?personId=${id}&format=csv`}>
              Export CSV
            </a>
            {editable ? (
              openCase ? (
                <Link className="btn-primary" href={`/leavers/${openCase.id}`}>
                  Continue leaver process
                </Link>
              ) : (
                <Link className="btn-danger" href={`/people/${id}/leaver`}>
                  Start leaver process
                </Link>
              )
            ) : null}
          </>
        }
      />

      {person.employeeStatus === "LEFT" && live.length > 0 ? (
        <div className="mb-4">
          <Alert tone="error" title="Leaver with access">
            This person has left the business but still holds {live.length} live account
            {live.length === 1 ? "" : "s"}. Work the leaver process to close them off with evidence.
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live accounts" value={live.length} tone={live.length ? "default" : "good"} />
        <Stat label="Vendors" value={vendorCount} />
        <Stat label="Flagged" value={flagged} tone={flagged ? "warn" : "good"} />
        <Stat label="Removed" value={removed.length} />
      </div>

      <Card
        title={`Accounts across all vendors (${accounts.length})`}
        className="overflow-hidden"
      >
        {accounts.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            No accounts are linked to this person yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Instance</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Permission</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th>Account expiry</th>
                  <th>Last confirmed</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={account.accountStatus === "REMOVED" ? "opacity-60" : ""}>
                    <td>
                      <Link href={`/register/${account.id}`} className="link font-medium">
                        {account.vendor.name}
                      </Link>
                    </td>
                    <td className="text-xs text-slate-500">{account.instance?.name ?? "—"}</td>
                    <td className="font-mono text-xs">
                      {account.rawUsername || account.rawEmail || "—"}
                    </td>
                    <td>{account.role || "—"}</td>
                    <td className="text-xs text-slate-600">{account.permissionLevel || "—"}</td>
                    <td>
                      <StatusBadge status={account.accountStatus} />
                    </td>
                    <td className="whitespace-nowrap">
                      <StatefulValue value={account.lastLogin} state={account.lastLoginState} />
                    </td>
                    <td className="whitespace-nowrap">
                      <StatefulValue value={account.accountExpiry} state={account.accountExpiryState} />
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(account.lastConfirmed) || <span className="blank-cell">Never</span>}
                    </td>
                    <td>
                      <FlagList flags={account.flags} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PersonForm person={person} editable={editable} />
        </div>
        <div className="space-y-4">
          <Card title="Identity">
            <div className="card-body space-y-2 text-sm">
              <div>
                <span className="text-slate-500">Alternate emails</span>
                <div className="mt-1 space-y-1">
                  {person.alternateEmails.length ? (
                    person.alternateEmails.map((email) => (
                      <div key={email} className="font-mono text-xs">
                        {email}
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">None recorded</span>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">HR reference</span>
                <span>{person.hrReference || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Start date</span>
                <span>{formatDate(person.startDate) || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Leave date</span>
                <span>{formatDate(person.leaveDate) || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Created</span>
                <span>{formatDateTime(person.createdAt)}</span>
              </div>
            </div>
          </Card>

          {person.mergedFrom.length ? (
            <Card title="Merged records">
              <div className="card-body space-y-1 text-sm text-slate-600">
                {person.mergedFrom.map((merged) => (
                  <div key={merged.id}>{merged.fullName} was merged into this person</div>
                ))}
              </div>
            </Card>
          ) : null}

          <MergePanel personId={id} people={otherPeople} editable={editable} />
        </div>
      </div>

      <div className="mt-4">
        <Card title={`History (${history.length})`}>
          {history.length === 0 ? (
            <div className="card-body">
              <Alert tone="info">Nothing recorded against this person yet.</Alert>
            </div>
          ) : (
            <HistoryTable events={history} showEntity />
          )}
        </Card>
      </div>
    </>
  );
}
