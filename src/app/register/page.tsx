import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canWrite, vendorScope } from "@/lib/auth/policy";
import { buildRegisterQuery, SORTABLE_COLUMNS, toQueryString, withParam } from "@/lib/register-query";
import {
  Card,
  EmptyState,
  FlagList,
  PageHeader,
  StatefulValue,
  StatusBadge,
  formatDate,
} from "@/components/ui";
import { RegisterFilters } from "./filters";
import { SaveViewButton } from "./save-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireUser();
  const scope = vendorScope(toActor(user));

  const { where, orderBy, sort, dir, page, pageSize } = buildRegisterQuery(params, scope);

  const [records, total, vendors, savedViews] = await Promise.all([
    prisma.accessRecord.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        vendor: { select: { id: true, name: true } },
        instance: { select: { id: true, name: true } },
        person: { select: { id: true, fullName: true, employeeStatus: true } },
      },
    }),
    prisma.accessRecord.count({ where }),
    prisma.vendor.findMany({
      where: scope ? { id: { in: scope } } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true, instances: { select: { id: true, name: true } } },
    }),
    prisma.savedView.findMany({
      where: {
        entity: "accessRecord",
        OR: [{ ownerUserId: user.id }, { scope: "SHARED" }],
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const qs = toQueryString(params);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="Register"
        subtitle={`${total.toLocaleString()} account${total === 1 ? "" : "s"} matching the current view`}
        actions={
          <>
            <a className="btn-secondary" href={`/api/export/register?format=csv&${qs}`}>
              Export CSV
            </a>
            <a className="btn-secondary" href={`/api/export/register?format=xlsx&${qs}`}>
              Export Excel
            </a>
            {canWrite(user.role) ? (
              <Link className="btn-primary" href="/register/new">
                Add account
              </Link>
            ) : null}
          </>
        }
      />

      {savedViews.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Saved views
          </span>
          {savedViews.map((view) => (
            <Link
              key={view.id}
              href={`/register?${view.query}`}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:border-slate-500"
            >
              {view.name}
              {view.scope === "SHARED" ? <span className="ml-1 text-slate-400">shared</span> : null}
            </Link>
          ))}
        </div>
      ) : null}

      <RegisterFilters vendors={vendors} params={params} />

      <Card className="mt-4 overflow-hidden">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-700">Accounts</h2>
          <SaveViewButton query={qs} />
        </div>

        {records.length === 0 ? (
          <EmptyState>No accounts match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {SORTABLE_COLUMNS.filter((c) =>
                    [
                      "vendor",
                      "person",
                      "rawUsername",
                      "rawEmail",
                      "role",
                      "accountStatus",
                      "lastLogin",
                      "accountExpiry",
                      "passwordExpiry",
                      "lastConfirmed",
                    ].includes(c.key),
                  ).map((column) => {
                    const active = sort === column.key;
                    const nextDir = active && dir === "asc" ? "desc" : "asc";
                    return (
                      <th key={column.key}>
                        <Link
                          href={`/register${withParam({ ...params, dir: nextDir }, "sort", column.key)}`}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          {column.label}
                          {active ? <span>{dir === "asc" ? "▲" : "▼"}</span> : null}
                        </Link>
                      </th>
                    );
                  })}
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <Link href={`/register/${record.id}`} className="link font-medium">
                        {record.vendor.name}
                      </Link>
                      {record.instance ? (
                        <div className="text-xs text-slate-500">{record.instance.name}</div>
                      ) : null}
                    </td>
                    <td>
                      {record.person ? (
                        <Link href={`/people/${record.person.id}`} className="link">
                          {record.person.fullName}
                        </Link>
                      ) : (
                        <span className="badge bg-violet-100 text-violet-800">Unmatched</span>
                      )}
                    </td>
                    <td className="font-mono text-xs">{record.rawUsername || "—"}</td>
                    <td className="font-mono text-xs">{record.rawEmail || "—"}</td>
                    <td>
                      {record.role || "—"}
                      {record.permissionLevel ? (
                        <div className="text-xs text-slate-500">{record.permissionLevel}</div>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge status={record.accountStatus} />
                    </td>
                    <td className="whitespace-nowrap">
                      <StatefulValue value={record.lastLogin} state={record.lastLoginState} />
                    </td>
                    <td className="whitespace-nowrap">
                      <StatefulValue value={record.accountExpiry} state={record.accountExpiryState} />
                    </td>
                    <td className="whitespace-nowrap">
                      <StatefulValue value={record.passwordExpiry} state={record.passwordExpiryState} />
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(record.lastConfirmed) || (
                        <span className="blank-cell">Never</span>
                      )}
                    </td>
                    <td>
                      <FlagList flags={record.flags} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link className="btn-secondary btn-sm" href={`/register${withParam(params, "page", String(page - 1))}`}>
                  Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link className="btn-secondary btn-sm" href={`/register${withParam(params, "page", String(page + 1))}`}>
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
