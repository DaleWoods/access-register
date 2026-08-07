import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canEditVendor, canViewVendor, isAdmin } from "@/lib/auth/policy";
import { Card, EmptyState, PageHeader, Stat, formatDateTime } from "@/components/ui";
import { HistoryTable } from "@/components/history-table";
import { VendorForm } from "../vendor-form";
import { archiveInstance, archiveVendor, createInstance, deleteColumnMapping } from "@/app/actions/vendors";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: {
      owner: true,
      instances: { orderBy: { name: "asc" } },
      columnMappings: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] },
    },
  });
  if (!vendor) notFound();

  const actor = toActor(user);
  if (!canViewVendor(actor, id)) notFound();
  const editable = canEditVendor(actor, id);

  const [owners, counts, history] = await Promise.all([
    prisma.appUser.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "VENDOR_OWNER"] } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.accessRecord.groupBy({
      by: ["accountStatus"],
      where: { vendorId: id },
      _count: true,
    }),
    prisma.auditEvent.findMany({
      where: { entityType: "Vendor", entityId: id },
      orderBy: { changedAt: "desc" },
      take: 50,
    }),
  ]);

  const countFor = (status: string) =>
    counts.find((c) => c.accountStatus === status)?._count ?? 0;

  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle={vendor.description || "No description recorded"}
        actions={
          <>
            <Link href={`/register?vendorId=${id}`} className="btn-secondary">
              View accounts
            </Link>
            {editable ? (
              <Link href={`/import?vendorId=${id}`} className="btn-primary">
                Import
              </Link>
            ) : null}
            {isAdmin(user.role) ? (
              <form action={archiveVendor}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="btn-secondary">
                  {vendor.isArchived ? "Unarchive" : "Archive"}
                </button>
              </form>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active" value={countFor("ACTIVE")} href={`/register?vendorId=${id}&accountStatus=ACTIVE`} />
        <Stat label="Disabled" value={countFor("DISABLED")} />
        <Stat label="Removed" value={countFor("REMOVED")} />
        <Stat label="Saved mappings" value={vendor.columnMappings.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <VendorForm
            vendor={vendor}
            owners={owners}
            editable={editable}
            canRename={isAdmin(user.role)}
          />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title={`Instances (${vendor.instances.length})`}>
            <div className="card-body space-y-3">
              <p className="text-sm text-slate-600">
                Use instances where one vendor has several portals or tenants — for example a
                separate Adyen account per retail brand. Imports are scoped per instance.
              </p>

              {vendor.instances.length === 0 ? (
                <p className="text-sm text-slate-500">No instances — accounts sit at vendor level.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {vendor.instances.map((instance) => (
                    <li key={instance.id} className="flex items-center justify-between gap-3 py-2">
                      <span className={instance.isArchived ? "text-slate-400 line-through" : ""}>
                        {instance.name}
                        {instance.notes ? (
                          <span className="ml-2 text-xs text-slate-500">{instance.notes}</span>
                        ) : null}
                      </span>
                      {editable ? (
                        <form action={archiveInstance}>
                          <input type="hidden" name="instanceId" value={instance.id} />
                          <button type="submit" className="btn-secondary btn-sm">
                            {instance.isArchived ? "Restore" : "Archive"}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {editable ? (
                <form action={createInstance} className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
                  <input type="hidden" name="vendorId" value={id} />
                  <div className="flex-1">
                    <label className="label">New instance name</label>
                    <input name="name" className="input" placeholder="e.g. Adyen – Goldsmiths" required />
                  </div>
                  <div className="flex-1">
                    <label className="label">Notes</label>
                    <input name="notes" className="input" />
                  </div>
                  <button type="submit" className="btn-secondary">
                    Add instance
                  </button>
                </form>
              ) : null}
            </div>
          </Card>

          <Card title={`Saved column mappings (${vendor.columnMappings.length})`}>
            <div className="card-body space-y-3">
              <p className="text-sm text-slate-600">
                A mapping records how this vendor&apos;s export columns line up with the register&apos;s
                fields, so a routine import needs no re-mapping.
              </p>
              {vendor.columnMappings.length === 0 ? (
                <p className="text-sm text-slate-500">
                  None yet — the first import will offer to save one.
                </p>
              ) : (
                <ul className="space-y-3">
                  {vendor.columnMappings.map((mapping) => (
                    <li key={mapping.id} className="rounded-md border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {mapping.name}
                          {mapping.isDefault ? (
                            <span className="ml-2 badge bg-emerald-100 text-emerald-800">default</span>
                          ) : null}
                        </span>
                        {editable ? (
                          <form action={deleteColumnMapping}>
                            <input type="hidden" name="mappingId" value={mapping.id} />
                            <button type="submit" className="btn-secondary btn-sm">
                              Delete
                            </button>
                          </form>
                        ) : null}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                        {Object.entries(mapping.mapping as Record<string, string>).map(
                          ([source, canonical]) => (
                            <div key={source} className="flex gap-1">
                              <dt className="font-mono text-slate-500">{source}</dt>
                              <dd className="text-slate-400">→</dd>
                              <dd className="font-medium">{canonical}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="Vendor history">
          {history.length === 0 ? (
            <EmptyState>No changes recorded against this vendor.</EmptyState>
          ) : (
            <HistoryTable events={history} />
          )}
        </Card>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Vendor created {formatDateTime(vendor.createdAt)}.
      </p>
    </>
  );
}
