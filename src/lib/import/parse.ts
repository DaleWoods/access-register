import Papa from "papaparse";

/** CSV / pasted-tabular parsing. Server-side only, validated before staging. */

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
};

/**
 * Parse a CSV or tab-separated paste into headers + row objects.
 * Delimiter is auto-detected, so a paste straight out of Excel works.
 */
export function parseTable(text: string): ParsedTable {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { headers: [], rows: [], errors: ["The file or pasted data is empty"] };

  const result = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    delimitersToGuess: [",", "\t", ";", "|"],
  });

  const errors = result.errors
    .filter((e) => e.type !== "FieldMismatch" || e.code !== "TooFewFields")
    .slice(0, 10)
    .map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);

  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
  if (headers.length === 0) errors.push("No column headers found in the first row");

  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) errors.push(`Duplicate column header: "${header}"`);
    seen.add(header);
  }

  const rows = (result.data ?? []).map((row) => {
    const clean: Record<string, string> = {};
    for (const header of headers) clean[header] = (row[header] ?? "").toString().trim();
    return clean;
  });

  // Drop rows that are entirely empty after trimming.
  const nonEmpty = rows.filter((row) => Object.values(row).some((v) => v !== ""));

  return { headers, rows: nonEmpty, errors };
}

/**
 * Parse a date from vendor exports, which are wildly inconsistent.
 * Ambiguous numeric dates are read day-first (UK vendors) unless the mapping
 * says otherwise, and anything unparseable returns null rather than a guess.
 */
export function parseDate(
  value: string,
  opts: { dateFormat?: "DMY" | "MDY" | "ISO" } = {},
): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  const lowered = raw.toLowerCase();
  if (["never", "n/a", "na", "-", "none", "null", "not available"].includes(lowered)) return null;

  // ISO 8601 first — unambiguous.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (iso) {
    const [, y, m, d, hh = "0", mm = "0", ss = "0"] = iso;
    return buildUtc(+y, +m, +d, +hh, +mm, +ss);
  }

  // Numeric d/m/y or m/d/y.
  const numeric = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (numeric) {
    const [, first, second, yearRaw, hh = "0", mm = "0", ss = "0"] = numeric;
    const year = yearRaw.length === 2 ? 2000 + +yearRaw : +yearRaw;
    const format = opts.dateFormat ?? "DMY";
    let day = +first;
    let month = +second;
    if (format === "MDY") {
      day = +second;
      month = +first;
    }
    // A value above 12 in the month slot settles the ambiguity regardless.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return buildUtc(year, month, day, +hh, +mm, +ss);
  }

  // "12 Jan 2026" / "Jan 12, 2026" and similar.
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return buildUtc(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    );
  }
  return null;
}

function buildUtc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (Number.isNaN(date.getTime())) return null;
  // Reject roll-over like 31 February.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

const DISABLED_WORDS = ["disabled", "inactive", "suspended", "locked", "blocked", "false", "no", "0"];
const REMOVED_WORDS = ["removed", "deleted", "deprovisioned", "terminated", "archived"];

/** Map a vendor's status column onto the register's three states. */
export function parseAccountStatus(value: string): "ACTIVE" | "DISABLED" | "REMOVED" {
  const v = value.trim().toLowerCase();
  if (!v) return "ACTIVE";
  if (REMOVED_WORDS.some((w) => v.includes(w))) return "REMOVED";
  if (DISABLED_WORDS.some((w) => v === w || v.includes(w))) return "DISABLED";
  return "ACTIVE";
}
