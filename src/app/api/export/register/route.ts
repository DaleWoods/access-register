import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser, toActor } from "@/lib/auth/guards";
import { vendorScope } from "@/lib/auth/policy";
import { buildRegisterQuery } from "@/lib/register-query";
import { exportFilename, exportResponse, toCsv, toXlsx, type ExportColumn } from "@/lib/export";
import { formatDate, formatDateTime } from "@/components/ui";
import type { FieldState } from "@prisma/client";

/**
 * Export the register exactly as filtered and sorted on screen.
 * Available to every role — an auditor's job is to take this away and read it.
 */

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(
  params: Record<string, string | string[] | undefined>,
  scope: string[] | null,
) {
  const { where, orderBy } = buildRegisterQuery(params, scope);
  return prisma.accessRecord.findMany({
    where,
    orderBy,
    take: 50_000,
    include: {
      vendor: { select: { name: true, category: true } },
      instance: { select: { name: true } },
      person: {
        select: {
          fullName: true,
          primaryEmail: true,
          employeeStatus: true,
          personType: true,
          department: true,
          lineManager: true,
        },
      },
    },
  });
}

/** Renders the three-way field state as text an auditor can read in Excel. */
function statefulText(value: Date | null, state: FieldState): string {
  if (state === "NOT_EXPOSED") return "N/A - not exposed";
  if (!value) return "";
  return formatDate(value);
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: "Vendor", value: (r) => r.vendor.name },
  { header: "Vendor category", value: (r) => r.vendor.category },
  { header: "Instance", value: (r) => r.instance?.name ?? "" },
  { header: "Person", value: (r) => r.person?.fullName ?? "" },
  { header: "Person email", value: (r) => r.person?.primaryEmail ?? "" },
  { header: "Person type", value: (r) => r.person?.personType ?? "" },
  { header: "Employee status", value: (r) => r.person?.employeeStatus ?? "" },
  { header: "Department", value: (r) => r.person?.department ?? "" },
  { header: "Line manager", value: (r) => r.person?.lineManager ?? "" },
  { header: "Matched to person", value: (r) => (r.personId ? "Yes" : "No") },
  { header: "Username", value: (r) => r.rawUsername },
  { header: "Email", value: (r) => r.rawEmail },
  { header: "Role", value: (r) => r.role },
  { header: "Permission level", value: (r) => r.permissionLevel },
  { header: "Account status", value: (r) => r.accountStatus },
  { header: "Account created", value: (r) => statefulText(r.accountCreated, r.accountCreatedState) },
  { header: "Account expiry", value: (r) => statefulText(r.accountExpiry, r.accountExpiryState) },
  { header: "Password expiry", value: (r) => statefulText(r.passwordExpiry, r.passwordExpiryState) },
  { header: "Last login", value: (r) => statefulText(r.lastLogin, r.lastLoginState) },
  { header: "Justification", value: (r) => r.justification },
  { header: "Source", value: (r) => r.source },
  { header: "First seen", value: (r) => formatDateTime(r.firstSeen) },
  { header: "Last seen in source", value: (r) => formatDateTime(r.lastSeenInSource) },
  { header: "Last confirmed", value: (r) => formatDateTime(r.lastConfirmed) },
  { header: "Last reviewed", value: (r) => formatDateTime(r.lastReviewedAt) },
  { header: "Flags", value: (r) => r.flags.join(" | ") },
];

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const url = new URL(request.url);
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    params[key] = all.length > 1 ? all : all[0];
  }

  const format = params.format === "xlsx" ? "xlsx" : "csv";
  const rows = await loadRows(params, vendorScope(toActor(user)));
  const filename = exportFilename("access-register", format);

  if (format === "xlsx") {
    return exportResponse(await toXlsx(rows, COLUMNS, "Access register"), filename, "xlsx");
  }
  return exportResponse(toCsv(rows, COLUMNS), filename, "csv");
}
