import type { NextRequest } from "next/server";
import type { FieldState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth/guards";
import { exportFilename, exportResponse, toCsv, toXlsx, type ExportColumn } from "@/lib/export";
import { formatDate, formatDateTime } from "@/components/ui";

/**
 * One person's entire access footprint across every vendor — the cross-vendor
 * view, as a file. This is what gets attached to a leaver ticket.
 */

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load(personId: string) {
  return prisma.accessRecord.findMany({
    where: { personId },
    orderBy: [{ vendor: { name: "asc" } }],
    include: { vendor: true, instance: true, person: true },
  });
}

function statefulText(value: Date | null, state: FieldState): string {
  if (state === "NOT_EXPOSED") return "N/A - not exposed";
  return value ? formatDate(value) : "";
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: "Person", value: (r) => r.person?.fullName ?? "" },
  { header: "Person email", value: (r) => r.person?.primaryEmail ?? "" },
  { header: "Employee status", value: (r) => r.person?.employeeStatus ?? "" },
  { header: "Vendor", value: (r) => r.vendor.name },
  { header: "Instance", value: (r) => r.instance?.name ?? "" },
  { header: "Username", value: (r) => r.rawUsername },
  { header: "Email", value: (r) => r.rawEmail },
  { header: "Role", value: (r) => r.role },
  { header: "Permission level", value: (r) => r.permissionLevel },
  { header: "Account status", value: (r) => r.accountStatus },
  { header: "Last login", value: (r) => statefulText(r.lastLogin, r.lastLoginState) },
  { header: "Account expiry", value: (r) => statefulText(r.accountExpiry, r.accountExpiryState) },
  { header: "Password expiry", value: (r) => statefulText(r.passwordExpiry, r.passwordExpiryState) },
  { header: "Justification", value: (r) => r.justification },
  { header: "Last confirmed", value: (r) => formatDateTime(r.lastConfirmed) },
  { header: "Flags", value: (r) => r.flags.join(" | ") },
];

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const url = new URL(request.url);
  const personId = url.searchParams.get("personId");
  if (!personId) return new Response("personId is required", { status: 400 });

  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const rows = await load(personId);
  const person = await prisma.person.findUnique({ where: { id: personId } });

  const filename = exportFilename(`access-footprint-${person?.fullName ?? "person"}`, format);
  if (format === "xlsx") return exportResponse(await toXlsx(rows, COLUMNS, "Footprint"), filename, "xlsx");
  return exportResponse(toCsv(rows, COLUMNS), filename, "csv");
}
