import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { canWrite } from "@/lib/auth/policy";
import { Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { NewPersonForm } from "./new-person-form";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PeoplePage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireUser();

  const q = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";
  const status = (Array.isArray(params.status) ? params.status[0] : params.status) ?? "";

  const people = await prisma.person.findMany({
    where: {
      mergedIntoId: null,
      ...(status ? { employeeStatus: status as "ACTIVE" | "LEFT" | "UNKNOWN" } : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" as const } },
              { primaryEmail: { contains: q, mode: "insensitive" as const } },
              { department: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { fullName: "asc" },
    include: {
      _count: { select: { accessRecords: true } },
      accessRecords: {
        where: { accountStatus: { not: "REMOVED" } },
        select: { id: true, flags: true, vendorId: true },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="People"
        subtitle="One record per real human. Open anyone to see their whole access footprint."
        actions={
          <a className="btn-secondary" href="/api/export/people?format=csv">
            Export CSV
          </a>
        }
      />

      <form method="get" className="card mb-4">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Search</label>
            <input name="q" defaultValue={q} className="input w-72" placeholder="Name, email or department" />
          </div>
          <div>
            <label className="label">Employee status</label>
            <select name="status" defaultValue={status} className="input w-48">
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="LEFT">Left</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Search
          </button>
          <Link href="/people" className="btn-secondary">
            Reset
          </Link>
        </div>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`${people.length} people`} className="overflow-hidden">
            {people.length === 0 ? (
              <EmptyState>No people match that search.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Department</th>
                      <th>Live accounts</th>
                      <th>Vendors</th>
                      <th>Flagged</th>
                      <th>Leave date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => {
                      const live = person.accessRecords.length;
                      const vendors = new Set(person.accessRecords.map((r) => r.vendorId)).size;
                      const flagged = person.accessRecords.filter((r) => r.flags.length).length;
                      const leaverRisk = person.employeeStatus === "LEFT" && live > 0;
                      return (
                        <tr key={person.id} className={leaverRisk ? "bg-red-50" : ""}>
                          <td>
                            <Link href={`/people/${person.id}`} className="link font-medium">
                              {person.fullName}
                            </Link>
                          </td>
                          <td className="font-mono text-xs">{person.primaryEmail ?? "—"}</td>
                          <td className="text-xs">{person.personType.replace("_", " ").toLowerCase()}</td>
                          <td>
                            {person.employeeStatus === "LEFT" ? (
                              <span className="badge bg-red-100 text-red-800">Left</span>
                            ) : person.employeeStatus === "ACTIVE" ? (
                              <span className="badge bg-emerald-100 text-emerald-800">Active</span>
                            ) : (
                              <span className="badge bg-slate-200 text-slate-700">Unknown</span>
                            )}
                          </td>
                          <td className="text-xs">{person.department ?? "—"}</td>
                          <td className="tabular-nums">{live}</td>
                          <td className="tabular-nums">{vendors}</td>
                          <td className="tabular-nums">
                            {flagged ? <span className="text-amber-700">{flagged}</span> : "—"}
                          </td>
                          <td className="text-xs">{formatDate(person.leaveDate) || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {canWrite(user.role) ? (
          <div>
            <NewPersonForm />
          </div>
        ) : null}
      </div>
    </>
  );
}
