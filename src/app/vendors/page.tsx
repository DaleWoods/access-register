import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { isAdmin, vendorScope } from "@/lib/auth/policy";
import { Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { canWrite } from "@/lib/auth/policy";
import { VendorForm } from "./vendor-form";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  PAYMENTS: "Payments",
  COURIER: "Courier",
  DEV_TOOLING: "Dev tooling",
  ANALYTICS: "Analytics",
  BRAND_PARTNER: "Brand partner",
  HOSTING: "Hosting",
  OTHER: "Other",
};

export default async function VendorsPage() {
  const user = await requireUser();
  const scope = vendorScope(toActor(user));
  const editable = canWrite(user.role);

  const [vendors, owners] = await Promise.all([
    prisma.vendor.findMany({
      where: scope ? { id: { in: scope } } : {},
      orderBy: [{ isArchived: "asc" }, { name: "asc" }],
      include: {
        owner: { select: { fullName: true } },
        instances: { select: { id: true, isArchived: true } },
        _count: { select: { accessRecords: true, columnMappings: true } },
        // The most recent committed upload, so the list doubles as a record of
        // which vendors are up to date and which have been forgotten.
        importBatches: {
          where: { status: "COMMITTED" },
          orderBy: { importedAt: "desc" },
          take: 1,
          select: { importedAt: true, sourceFilename: true, rowCount: true },
        },
      },
    }),
    prisma.appUser.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "VENDOR_OWNER"] } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Each third-party system, who owns it, how its data is captured, and which fields it actually exposes."
      />

      {/* The list is the primary content and has grown a column, so it gets the
          full width; adding a vendor is occasional and sits underneath. */}
      <div className="space-y-4">
        <div>
          <Card title={`${vendors.length} vendors`} className="overflow-hidden">
            {vendors.length === 0 ? (
              <EmptyState>No vendors yet.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Category</th>
                      <th>Owner</th>
                      <th>Capture</th>
                      <th>Instances</th>
                      <th>Accounts</th>
                      <th>Exposes last login</th>
                      <th>Last upload</th>
                      {editable ? <th>Upload</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((vendor) => (
                      <tr key={vendor.id} className={vendor.isArchived ? "opacity-50" : ""}>
                        <td>
                          <Link href={`/vendors/${vendor.id}`} className="link font-medium">
                            {vendor.name}
                          </Link>
                          {vendor.isArchived ? (
                            <span className="ml-2 badge bg-slate-200 text-slate-600">archived</span>
                          ) : null}
                          {vendor.description ? (
                            <div className="text-xs text-slate-500">{vendor.description}</div>
                          ) : null}
                        </td>
                        <td className="text-xs">{CATEGORY_LABELS[vendor.category]}</td>
                        <td className="text-xs">{vendor.owner?.fullName ?? "—"}</td>
                        <td className="text-xs">{vendor.captureMethod.replace("_", " ").toLowerCase()}</td>
                        <td className="tabular-nums">
                          {vendor.instances.filter((i) => !i.isArchived).length || "—"}
                        </td>
                        <td className="tabular-nums">{vendor._count.accessRecords}</td>
                        <td>
                          {vendor.exposesLastLogin ? (
                            <span className="badge bg-emerald-100 text-emerald-800">Yes</span>
                          ) : (
                            <span
                              className="badge bg-slate-200 text-slate-700"
                              title="Its accounts are flagged unverifiable rather than dormant"
                            >
                              No
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          <LastUpload
                            batch={vendor.importBatches[0]}
                            captureMethod={vendor.captureMethod}
                          />
                        </td>
                        {editable ? (
                          <td>
                            <Link
                              href={`/import?vendorId=${vendor.id}`}
                              className="btn-secondary btn-sm whitespace-nowrap"
                            >
                              Upload data
                            </Link>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {isAdmin(user.role) ? (
          <div className="max-w-2xl">
            <VendorForm owners={owners} />
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * When this vendor's data was last uploaded. Vendors captured by hand have no
 * export to upload, so they are called out rather than shown as overdue.
 */
function LastUpload({
  batch,
  captureMethod,
}: {
  batch?: { importedAt: Date | null; sourceFilename: string; rowCount: number };
  captureMethod: string;
}) {
  if (captureMethod === "MANUAL_READ") {
    return <span className="text-slate-400">Entered by hand</span>;
  }
  if (!batch?.importedAt) {
    return <span className="blank-cell">Never uploaded</span>;
  }

  const days = Math.floor((Date.now() - batch.importedAt.getTime()) / 86_400_000);
  return (
    <span title={`${batch.sourceFilename} — ${batch.rowCount} rows`}>
      {formatDate(batch.importedAt)}
      <span className={days > 90 ? "ml-1 text-amber-600" : "ml-1 text-slate-400"}>
        ({days === 0 ? "today" : `${days}d ago`})
      </span>
    </span>
  );
}
