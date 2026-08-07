import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/auth/policy";
import { Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { openReviewCycle } from "@/app/actions/reviews";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await requireUser();

  const cycles = await prisma.reviewCycle.findMany({
    orderBy: [{ status: "asc" }, { openedAt: "desc" }],
    include: {
      openedBy: true,
      items: { select: { outcome: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Review cycles"
        subtitle="Periodic access reviews. Each vendor owner works through their own accounts and records keep, downgrade or remove."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`Cycles (${cycles.length})`} className="overflow-hidden">
            {cycles.length === 0 ? (
              <EmptyState>No review cycles have been opened yet.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cycle</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Progress</th>
                      <th>Opened by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycles.map((cycle) => {
                      const done = cycle.items.filter((i) => i.outcome).length;
                      const total = cycle.items.length;
                      const percent = total ? Math.round((done / total) * 100) : 0;
                      const overdue = cycle.status === "OPEN" && cycle.dueAt < new Date();
                      return (
                        <tr key={cycle.id}>
                          <td>
                            <Link href={`/reviews/${cycle.id}`} className="link font-medium">
                              {cycle.name}
                            </Link>
                          </td>
                          <td className="text-xs">{cycle.type.toLowerCase()}</td>
                          <td>
                            <span
                              className={`badge ${
                                cycle.status === "OPEN"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {cycle.status.toLowerCase()}
                            </span>
                          </td>
                          <td className={`text-xs ${overdue ? "font-semibold text-red-600" : ""}`}>
                            {formatDate(cycle.dueAt)}
                            {overdue ? " (overdue)" : ""}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="text-xs tabular-nums text-slate-600">
                                {done}/{total}
                              </span>
                            </div>
                          </td>
                          <td className="text-xs">{cycle.openedBy?.fullName ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {isAdmin(user.role) ? (
          <div>
            <Card title="Open a new cycle">
              <form action={openReviewCycle} className="card-body space-y-3">
                <div>
                  <label className="label">Name</label>
                  <input name="name" className="input" placeholder="Q1 2026" required />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select name="type" className="input" defaultValue="QUARTERLY">
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>
                <div>
                  <label className="label">Due date</label>
                  <input type="date" name="dueAt" className="input" required />
                </div>
                <button type="submit" className="btn-primary w-full">
                  Open cycle
                </button>
                <p className="text-[11px] text-slate-500">
                  Every live account on a non-archived vendor is pulled into the cycle and assigned
                  to that vendor&apos;s owner.
                </p>
              </form>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
