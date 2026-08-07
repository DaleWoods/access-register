import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canEditVendor, isAdmin, vendorScope } from "@/lib/auth/policy";
import {
  Alert,
  Card,
  EmptyState,
  FlagList,
  PageHeader,
  Stat,
  StatefulValue,
  StatusBadge,
  formatDate,
} from "@/components/ui";
import { closeReviewCycle, recordReviewOutcome } from "@/app/actions/reviews";

export const dynamic = "force-dynamic";

const OUTCOME_STYLES: Record<string, string> = {
  KEEP: "bg-emerald-100 text-emerald-800",
  DOWNGRADE: "bg-amber-100 text-amber-800",
  REMOVE: "bg-red-100 text-red-800",
};

export default async function ReviewCyclePage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const user = await requireUser();
  const actor = toActor(user);
  const scope = vendorScope(actor);

  const cycle = await prisma.reviewCycle.findUnique({
    where: { id: cycleId },
    include: { openedBy: true },
  });
  if (!cycle) notFound();

  const [items, allItems] = await Promise.all([
    prisma.reviewItem.findMany({
      where: {
        cycleId,
        ...(scope ? { accessRecord: { vendorId: { in: scope } } } : {}),
      },
      include: {
        accessRecord: { include: { vendor: true, instance: true, person: true } },
        reviewer: true,
      },
      orderBy: [{ outcome: { sort: "asc", nulls: "first" } }, { accessRecord: { vendor: { name: "asc" } } }],
    }),
    prisma.reviewItem.findMany({
      where: { cycleId },
      select: { outcome: true, accessRecord: { select: { vendorId: true, vendor: { select: { name: true } } } } },
    }),
  ]);

  const done = allItems.filter((i) => i.outcome).length;
  const byVendor = new Map<string, { name: string; total: number; done: number }>();
  for (const item of allItems) {
    const key = item.accessRecord.vendorId;
    const entry = byVendor.get(key) ?? { name: item.accessRecord.vendor.name, total: 0, done: 0 };
    entry.total += 1;
    if (item.outcome) entry.done += 1;
    byVendor.set(key, entry);
  }

  const overdue = cycle.status === "OPEN" && cycle.dueAt < new Date();

  return (
    <>
      <PageHeader
        title={cycle.name}
        subtitle={`${cycle.type.toLowerCase()} review · due ${formatDate(cycle.dueAt)}${
          cycle.openedBy ? ` · opened by ${cycle.openedBy.fullName}` : ""
        }`}
        actions={
          <>
            <Link href="/reviews" className="btn-secondary">
              All cycles
            </Link>
            {isAdmin(user.role) && cycle.status === "OPEN" ? (
              <form action={closeReviewCycle}>
                <input type="hidden" name="cycleId" value={cycleId} />
                <button type="submit" className="btn-primary">
                  Close cycle
                </button>
              </form>
            ) : null}
          </>
        }
      />

      {cycle.status === "CLOSED" ? (
        <div className="mb-4">
          <Alert tone="success" title="Cycle closed">
            Closed {formatDate(cycle.closedAt)}. This page and its export are the audit record for
            this review.
          </Alert>
        </div>
      ) : overdue ? (
        <div className="mb-4">
          <Alert tone="error" title="Overdue">
            This cycle passed its due date of {formatDate(cycle.dueAt)} with {allItems.length - done}{" "}
            account{allItems.length - done === 1 ? "" : "s"} still unreviewed.
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accounts in cycle" value={allItems.length} />
        <Stat label="Reviewed" value={done} tone={done === allItems.length ? "good" : "default"} />
        <Stat
          label="Outstanding"
          value={allItems.length - done}
          tone={allItems.length - done ? "warn" : "good"}
        />
        <Stat label="Vendors" value={byVendor.size} />
      </div>

      <Card title="Progress by vendor" className="mb-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Reviewed</th>
                <th>Total</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {[...byVendor.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((entry) => (
                  <tr key={entry.name}>
                    <td className="font-medium">{entry.name}</td>
                    <td className="tabular-nums">{entry.done}</td>
                    <td className="tabular-nums">{entry.total}</td>
                    <td>
                      <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${entry.total ? (entry.done / entry.total) * 100 : 0}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        Your accounts to review ({items.length})
      </h2>

      {items.length === 0 ? (
        <Card>
          <EmptyState>Nothing in this cycle is assigned to the vendors you can act on.</EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const editable =
              cycle.status === "OPEN" && canEditVendor(actor, item.accessRecord.vendorId);
            return (
              <Card key={item.id}>
                <div className="card-header">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {item.accessRecord.vendor.name}
                      {item.accessRecord.instance ? ` — ${item.accessRecord.instance.name}` : ""}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <Link href={`/register/${item.accessRecordId}`} className="link font-mono">
                        {item.accessRecord.rawUsername || item.accessRecord.rawEmail}
                      </Link>
                      {item.accessRecord.person ? (
                        <>
                          {" · "}
                          <Link href={`/people/${item.accessRecord.person.id}`} className="link">
                            {item.accessRecord.person.fullName}
                          </Link>
                        </>
                      ) : (
                        " · unmatched"
                      )}
                      {item.accessRecord.role ? ` · ${item.accessRecord.role}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.accessRecord.accountStatus} />
                    {item.outcome ? (
                      <span className={`badge ${OUTCOME_STYLES[item.outcome]}`}>
                        {item.outcome.toLowerCase()}
                      </span>
                    ) : (
                      <span className="badge bg-slate-200 text-slate-700">not reviewed</span>
                    )}
                  </div>
                </div>

                <div className="card-body space-y-3">
                  <div className="grid gap-3 text-xs md:grid-cols-4">
                    <div>
                      <span className="text-slate-500">Last login: </span>
                      <StatefulValue
                        value={item.accessRecord.lastLogin}
                        state={item.accessRecord.lastLoginState}
                      />
                    </div>
                    <div>
                      <span className="text-slate-500">Permission: </span>
                      {item.accessRecord.permissionLevel || "—"}
                    </div>
                    <div>
                      <span className="text-slate-500">Justification: </span>
                      {item.accessRecord.justification || (
                        <span className="italic text-amber-600">none recorded</span>
                      )}
                    </div>
                    <div>
                      <FlagList flags={item.accessRecord.flags} />
                    </div>
                  </div>

                  {item.challenges.length ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-900">Worth challenging</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900">
                        {item.challenges.map((challenge) => (
                          <li key={challenge}>{challenge}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {item.reviewedAt ? (
                    <p className="text-xs text-slate-500">
                      {item.outcome?.toLowerCase()} by {item.reviewer?.fullName ?? "unknown"} on{" "}
                      {formatDate(item.reviewedAt)}
                      {item.notes ? ` — ${item.notes}` : ""}
                    </p>
                  ) : null}

                  {editable ? (
                    <form action={recordReviewOutcome} className="grid gap-3 md:grid-cols-4">
                      <input type="hidden" name="itemId" value={item.id} />
                      <div>
                        <label className="label">Outcome</label>
                        <select name="outcome" defaultValue={item.outcome ?? "KEEP"} className="input">
                          <option value="KEEP">Keep</option>
                          <option value="DOWNGRADE">Downgrade</option>
                          <option value="REMOVE">Remove</option>
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="label">Notes</label>
                        <input name="notes" defaultValue={item.notes} className="input" />
                      </div>
                      <div className="flex items-end">
                        <button type="submit" className="btn-primary btn-sm">
                          Record
                        </button>
                      </div>
                      <p className="md:col-span-4 text-[11px] text-slate-500">
                        Choosing &ldquo;Remove&rdquo; sets the account to Removed in the register.
                        &ldquo;Downgrade&rdquo; records the decision — apply the new permission on
                        the account itself once the vendor has actioned it.
                      </p>
                    </form>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
