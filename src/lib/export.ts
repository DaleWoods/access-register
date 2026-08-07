import ExcelJS from "exceljs";

/**
 * Export helpers. Any view an auditor can see, they can download — as CSV or
 * as a real Excel workbook.
 */

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null;
};

function escapeCsv(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Guard against spreadsheet formula injection in exported data.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCsv(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsv(c.value(row))).join(","));
  }
  // BOM so Excel opens UTF-8 correctly on a Windows estate.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function toXlsx<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  sheetName = "Export",
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Third-Party Access Register";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.header,
    width: Math.min(40, Math.max(12, c.header.length + 4)),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    sheet.addRow(columns.map((c) => c.value(row) ?? ""));
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportFilename(base: string, format: "csv" | "xlsx"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = base.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${safe}-${stamp}.${format}`;
}

export function exportResponse(
  body: string | Buffer,
  filename: string,
  format: "csv" | "xlsx",
): Response {
  const contentType =
    format === "csv"
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
