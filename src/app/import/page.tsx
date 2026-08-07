import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canWrite, vendorScope } from "@/lib/auth/policy";
import { Alert, Card, EmptyState, PageHeader, ReadOnlyNotice, formatDateTime } from "@/components/ui";
import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await requireUser();
  const scope = vendorScope(toActor(user));

  if (!canWrite(user.role)) {
    return (
      <>
        <PageHeader title="Import" />
        <ReadOnlyNotice />
      </>
    );
  }

  const [vendors, recent] = await Promise.all([
    prisma.vendor.findMany({
      where: { isArchived: false, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
      include: {
        instances: { where: { isArchived: false }, orderBy: { name: "asc" } },
        columnMappings: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] },
      },
    }),
    prisma.importBatch.findMany({
      where: scope ? { vendorId: { in: scope } } : {},
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { vendor: true, importedBy: true },
    }),
  ]);

  const staged = recent.filter((b) => b.status === "STAGED");

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Upload a vendor export, map its columns once, then review exactly what will change before anything is committed."
      />

      {staged.length ? (
        <div className="mb-4">
          <Alert tone="warn" title="Staged imports awaiting review">
            <ul className="mt-1 space-y-1">
              {staged.map((batch) => (
                <li key={batch.id}>
                  <Link href={`/import/${batch.id}`} className="link">
                    {batch.vendor.name} — {batch.sourceFilename}
                  </Link>{" "}
                  <span className="text-xs">
                    staged {formatDateTime(batch.createdAt)}, nothing committed yet
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {vendors.length === 0 ? (
        <Card>
          <div className="card-body text-sm text-slate-600">
            There are no vendors set up yet. <Link href="/vendors" className="link">Add a vendor</Link>{" "}
            before importing.
          </div>
        </Card>
      ) : (
        <ImportWizard vendors={vendors} />
      )}

      <div className="mt-6">
        <Card title="Recent import batches" className="overflow-hidden">
          {recent.length === 0 ? (
            <EmptyState>No imports yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Vendor</th>
                    <th>File</th>
                    <th>Rows</th>
                    <th>Status</th>
                    <th>By</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((batch) => {
                    const summary = batch.summary as Record<string, unknown>;
                    const committed = summary.committed as Record<string, number> | undefined;
                    return (
                      <tr key={batch.id}>
                        <td className="whitespace-nowrap text-xs">
                          {formatDateTime(batch.importedAt ?? batch.createdAt)}
                        </td>
                        <td>{batch.vendor.name}</td>
                        <td>
                          <Link href={`/import/${batch.id}`} className="link">
                            {batch.sourceFilename}
                          </Link>
                        </td>
                        <td className="tabular-nums">{batch.rowCount}</td>
                        <td>
                          <span
                            className={`badge ${
                              batch.status === "COMMITTED"
                                ? "bg-emerald-100 text-emerald-800"
                                : batch.status === "STAGED"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {batch.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="text-xs">{batch.importedBy.fullName}</td>
                        <td className="text-xs text-slate-600">
                          {committed
                            ? `${committed.created} new, ${committed.updated} updated, ${committed.unchanged} unchanged, ${committed.removed} removed`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
