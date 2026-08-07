import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { buildLeaverReport, type LeaverReportLine } from "@/lib/leaver";
import { exportFilename, exportResponse, toCsv, toXlsx, type ExportColumn } from "@/lib/export";
import { formatDateTime } from "@/components/ui";

/**
 * The leaver report: every account the person held, the action taken against
 * each, and the evidence recorded. This is the audit proof the process ran.
 */

export const dynamic = "force-dynamic";

const COLUMNS: ExportColumn<LeaverReportLine>[] = [
  { header: "Vendor", value: (r) => r.vendorName },
  { header: "Instance", value: (r) => r.instanceName ?? "" },
  { header: "Username", value: (r) => r.rawUsername },
  { header: "Email", value: (r) => r.rawEmail },
  { header: "Role", value: (r) => r.role },
  { header: "Permission level", value: (r) => r.permissionLevel },
  { header: "Account status now", value: (r) => r.accountStatus },
  { header: "Action taken", value: (r) => r.action },
  { header: "Evidence note", value: (r) => r.evidenceNote },
  { header: "Evidence files", value: (r) => r.evidenceFiles.join(" | ") },
  { header: "Actioned by", value: (r) => r.actionedBy ?? "" },
  { header: "Actioned at", value: (r) => formatDateTime(r.actionedAt) },
];

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const url = new URL(request.url);
  const caseId = url.searchParams.get("caseId");
  if (!caseId) return new Response("caseId is required", { status: 400 });

  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const report = await buildLeaverReport(caseId);
  const filename = exportFilename(`leaver-report-${report.person.fullName}`, format);

  if (format === "xlsx") {
    return exportResponse(await toXlsx(report.lines, COLUMNS, "Leaver report"), filename, "xlsx");
  }

  // The CSV carries a short header block so the file stands alone as evidence.
  const header = [
    `Leaver report,${report.person.fullName}`,
    `Email,${report.person.primaryEmail ?? ""}`,
    `Department,${report.person.department ?? ""}`,
    `Line manager,${report.person.lineManager ?? ""}`,
    `Leave date,${report.person.leaveDate?.toISOString().slice(0, 10) ?? ""}`,
    `Case opened,${formatDateTime(report.openedAt)}`,
    `Case closed,${formatDateTime(report.closedAt) || "still open"}`,
    `Opened by,${report.openedBy ?? ""}`,
    `Accounts in scope,${report.lines.length}`,
    `Outstanding,${report.outstanding}`,
    "",
  ].join("\r\n");

  return exportResponse(header + toCsv(report.lines, COLUMNS), filename, "csv");
}
