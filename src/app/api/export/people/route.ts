import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth/guards";
import { exportFilename, exportResponse, toCsv, toXlsx, type ExportColumn } from "@/lib/export";
import { formatDate } from "@/components/ui";

/** People with a count of their access footprint. */

export const dynamic = "force-dynamic";

type Row = {
  fullName: string;
  primaryEmail: string | null;
  alternateEmails: string[];
  personType: string;
  employeeStatus: string;
  department: string | null;
  lineManager: string | null;
  hrReference: string | null;
  startDate: Date | null;
  leaveDate: Date | null;
  accessRecords: { accountStatus: string; vendorId: string; flags: string[] }[];
};

const COLUMNS: ExportColumn<Row>[] = [
  { header: "Full name", value: (r) => r.fullName },
  { header: "Primary email", value: (r) => r.primaryEmail ?? "" },
  { header: "Alternate emails", value: (r) => r.alternateEmails.join(" | ") },
  { header: "Person type", value: (r) => r.personType },
  { header: "Employee status", value: (r) => r.employeeStatus },
  { header: "Department", value: (r) => r.department ?? "" },
  { header: "Line manager", value: (r) => r.lineManager ?? "" },
  { header: "HR reference", value: (r) => r.hrReference ?? "" },
  { header: "Start date", value: (r) => formatDate(r.startDate) },
  { header: "Leave date", value: (r) => formatDate(r.leaveDate) },
  {
    header: "Live accounts",
    value: (r) => r.accessRecords.filter((a) => a.accountStatus !== "REMOVED").length,
  },
  {
    header: "Vendors",
    value: (r) =>
      new Set(
        r.accessRecords.filter((a) => a.accountStatus !== "REMOVED").map((a) => a.vendorId),
      ).size,
  },
  { header: "Removed accounts", value: (r) => r.accessRecords.filter((a) => a.accountStatus === "REMOVED").length },
  {
    header: "Flagged accounts",
    value: (r) =>
      r.accessRecords.filter((a) => a.accountStatus !== "REMOVED" && a.flags.length > 0).length,
  },
];

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const people = await prisma.person.findMany({
    where: { mergedIntoId: null },
    orderBy: { fullName: "asc" },
    include: {
      accessRecords: { select: { accountStatus: true, vendorId: true, flags: true } },
    },
  });

  const filename = exportFilename("people", format);
  if (format === "xlsx") return exportResponse(await toXlsx(people, COLUMNS, "People"), filename, "xlsx");
  return exportResponse(toCsv(people, COLUMNS), filename, "csv");
}
