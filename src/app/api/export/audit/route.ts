import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth/guards";
import { exportFilename, exportResponse, toCsv, toXlsx, type ExportColumn } from "@/lib/export";
import { formatDateTime } from "@/components/ui";

/** The append-only trail, as a file, for audit sign-off. */

export const dynamic = "force-dynamic";

type Row = {
  changedAt: Date;
  entityType: string;
  entityId: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedByLabel: string;
  changeSource: string;
  correlationId: string | null;
};

const COLUMNS: ExportColumn<Row>[] = [
  { header: "Changed at", value: (r) => formatDateTime(r.changedAt) },
  { header: "Entity type", value: (r) => r.entityType },
  { header: "Entity id", value: (r) => r.entityId },
  { header: "Field", value: (r) => r.field ?? "" },
  { header: "Old value", value: (r) => r.oldValue ?? "" },
  { header: "New value", value: (r) => r.newValue ?? "" },
  { header: "Changed by", value: (r) => r.changedByLabel },
  { header: "Via", value: (r) => r.changeSource },
  { header: "Correlation id", value: (r) => r.correlationId ?? "" },
];

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const entityType = url.searchParams.get("entityType") ?? "";
  const changeSource = url.searchParams.get("changeSource") ?? "";

  const rows = await prisma.auditEvent.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(changeSource
        ? { changeSource: changeSource as "MANUAL" | "IMPORT" | "LEAVER_PROCESS" | "REVIEW" | "SYSTEM" }
        : {}),
    },
    orderBy: { changedAt: "desc" },
    take: 100_000,
  });

  const filename = exportFilename("audit-trail", format);
  if (format === "xlsx") return exportResponse(await toXlsx(rows, COLUMNS, "Audit trail"), filename, "xlsx");
  return exportResponse(toCsv(rows, COLUMNS), filename, "csv");
}
