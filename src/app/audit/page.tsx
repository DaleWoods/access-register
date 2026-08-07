import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { HistoryTable } from "@/components/history-table";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The whole append-only trail, filterable. Visible to every role. */
export default async function AuditPage({ searchParams }: Props) {
  const params = await searchParams;
  await requireUser();

  const entityType = one(params, "entityType");
  const source = one(params, "changeSource");
  const q = one(params, "q");
  const page = Math.max(1, Number.parseInt(one(params, "page") || "1", 10) || 1);
  const pageSize = 100;

  const where = {
    ...(entityType ? { entityType } : {}),
    ...(source ? { changeSource: source as "MANUAL" | "IMPORT" | "LEAVER_PROCESS" | "REVIEW" | "SYSTEM" } : {}),
    ...(q
      ? {
          OR: [
            { changedByLabel: { contains: q, mode: "insensitive" as const } },
            { field: { contains: q, mode: "insensitive" as const } },
            { oldValue: { contains: q, mode: "insensitive" as const } },
            { newValue: { contains: q, mode: "insensitive" as const } },
            { entityId: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { changedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle={`${total.toLocaleString()} recorded changes. Append-only — nothing here can be edited or deleted.`}
        actions={
          <a className="btn-secondary" href={`/api/export/audit?format=csv&${new URLSearchParams(
            Object.entries(params).flatMap(([k, v]) =>
              v ? [[k, Array.isArray(v) ? v[0] : v] as [string, string]] : [],
            ),
          ).toString()}`}>
            Export CSV
          </a>
        }
      />

      <div className="mb-4">
        <Alert tone="info">
          Every create, update, removal, import commit and leaver action writes a row here. The
          table is protected by a database trigger that rejects updates and deletes outright, so
          the trail holds even against direct database access.
        </Alert>
      </div>

      <form method="get" className="card mb-4">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Search</label>
            <input
              name="q"
              defaultValue={q}
              className="input w-72"
              placeholder="Value, field, person or record id"
            />
          </div>
          <div>
            <label className="label">Entity</label>
            <select name="entityType" defaultValue={entityType} className="input w-48">
              <option value="">Any</option>
              <option value="AccessRecord">Access record</option>
              <option value="Person">Person</option>
              <option value="Vendor">Vendor</option>
              <option value="VendorInstance">Vendor instance</option>
              <option value="ImportBatch">Import batch</option>
              <option value="LeaverCase">Leaver case</option>
              <option value="ReviewCycle">Review cycle</option>
              <option value="AppUser">App user</option>
            </select>
          </div>
          <div>
            <label className="label">Via</label>
            <select name="changeSource" defaultValue={source} className="input w-48">
              <option value="">Any</option>
              <option value="MANUAL">Manual edit</option>
              <option value="IMPORT">Import</option>
              <option value="LEAVER_PROCESS">Leaver process</option>
              <option value="REVIEW">Review</option>
              <option value="SYSTEM">System</option>
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Filter
          </button>
          <Link href="/audit" className="btn-secondary">
            Reset
          </Link>
        </div>
      </form>

      <Card className="overflow-hidden">
        {events.length === 0 ? (
          <EmptyState>No audit events match those filters.</EmptyState>
        ) : (
          <HistoryTable events={events} showEntity />
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  className="btn-secondary btn-sm"
                  href={`/audit?${new URLSearchParams({ q, entityType, changeSource: source, page: String(page - 1) })}`}
                >
                  Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link
                  className="btn-secondary btn-sm"
                  href={`/audit?${new URLSearchParams({ q, entityType, changeSource: source, page: String(page + 1) })}`}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
