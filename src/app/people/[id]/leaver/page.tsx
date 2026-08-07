import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWriter } from "@/lib/auth/guards";
import { Alert, Card, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { startLeaverCase } from "@/app/actions/leavers";

export const dynamic = "force-dynamic";

/** Step one of the leaver process: confirm the scope before opening the case. */
export default async function StartLeaverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireWriter();

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      accessRecords: {
        include: { vendor: true, instance: true },
        orderBy: { vendor: { name: "asc" } },
      },
    },
  });
  if (!person) notFound();

  const open = await prisma.leaverCase.findFirst({ where: { personId: id, status: "OPEN" } });
  if (open) redirect(`/leavers/${open.id}`);

  const live = person.accessRecords.filter((r) => r.accountStatus !== "REMOVED");

  return (
    <>
      <PageHeader
        title={`Leaver process — ${person.fullName}`}
        subtitle="Opening a case snapshots every account this person holds into a checklist you work through with evidence."
        actions={
          <Link href={`/people/${id}`} className="btn-secondary">
            Back to person
          </Link>
        }
      />

      <div className="mb-4">
        <Alert tone="warn" title="What this does">
          Opening the case marks {person.fullName} as having left, and creates a checklist row for
          every one of their {person.accessRecords.length} account
          {person.accessRecords.length === 1 ? "" : "s"} across all vendors. Nothing is removed
          until you action each row.
        </Alert>
      </div>

      <Card title={`Accounts in scope (${person.accessRecords.length})`} className="mb-4 overflow-hidden">
        {person.accessRecords.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            This person holds no accounts. There is nothing to work through.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Instance</th>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last login</th>
                </tr>
              </thead>
              <tbody>
                {person.accessRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="font-medium">{record.vendor.name}</td>
                    <td className="text-xs text-slate-500">{record.instance?.name ?? "—"}</td>
                    <td className="font-mono text-xs">{record.rawUsername || record.rawEmail}</td>
                    <td className="text-sm">{record.role || "—"}</td>
                    <td>
                      <StatusBadge status={record.accountStatus} />
                    </td>
                    <td className="text-xs">
                      {record.lastLoginState === "NOT_EXPOSED"
                        ? "N/A – not exposed"
                        : formatDate(record.lastLogin) || "Not captured"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Open the case">
        <form action={startLeaverCase} className="card-body space-y-3">
          <input type="hidden" name="personId" value={id} />
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Leave date</label>
              <input
                type="date"
                name="leaveDate"
                defaultValue={formatDate(person.leaveDate)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <input name="notes" className="input" placeholder="e.g. HR ticket reference" />
            </div>
          </div>
          <button type="submit" className="btn-danger">
            Open leaver case for {live.length} live account{live.length === 1 ? "" : "s"}
          </button>
        </form>
      </Card>
    </>
  );
}
