import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canWrite, vendorScope } from "@/lib/auth/policy";
import { buildRegisterQuery, toQueryString, withParam } from "@/lib/register-query";
import { Card, PageHeader } from "@/components/ui";
import { SavedNotice } from "@/components/saved-notice";
import { RegisterFilters } from "./filters";
import { SaveViewButton } from "./save-view";
import { RegisterTable } from "./table";

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

      <SavedNotice searchParams={params} />

      <Card className="mt-4 overflow-hidden">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-700">Accounts</h2>
          <SaveViewButton query={qs} />
        </div>

        <RegisterTable
          records={records}
          params={params}
          sort={sort}
          dir={dir}
          qs={qs}
          canWrite={canWrite(user.role)}
        />

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
