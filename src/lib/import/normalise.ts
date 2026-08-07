import { CANONICAL_BY_KEY } from "@/lib/canonical-fields";
import { buildMatchKey, normaliseEmail } from "@/lib/matching";
import { parseAccountStatus, parseDate } from "@/lib/import/parse";

/**
 * Turn raw source rows into canonical field values.
 *
 * A normalised row only ever carries the fields the mapping actually covers.
 * That matters for two reasons: an unmapped column must never be read as
 * "cleared to blank" on an existing record, and it keeps re-imports of the
 * same export byte-for-byte stable.
 */

export type CanonicalValue = string | Date | null;
export type CanonicalRow = {
  /** Only the canonical keys this mapping covers. */
  values: Record<string, CanonicalValue>;
  /** Person name from the export, if mapped. Not stored on the account row. */
  personName: string;
  matchKey: string;
  errors: string[];
};

export type MappingOptions = Record<string, { dateFormat?: "DMY" | "MDY" | "ISO" }>;

export function normaliseRow(
  raw: Record<string, string>,
  mapping: Record<string, string>,
  options: MappingOptions = {},
): CanonicalRow {
  const values: Record<string, CanonicalValue> = {};
  const errors: string[] = [];
  let personName = "";

  for (const [sourceColumn, canonicalKey] of Object.entries(mapping)) {
    if (!canonicalKey) continue; // explicitly ignored column
    const field = CANONICAL_BY_KEY.get(canonicalKey);
    if (!field) continue;

    const rawValue = (raw[sourceColumn] ?? "").trim();

    if (canonicalKey === "fullName") {
      personName = rawValue;
      continue;
    }

    switch (field.kind) {
      case "date": {
        if (!rawValue) {
          values[canonicalKey] = null;
          break;
        }
        const parsed = parseDate(rawValue, options[canonicalKey] ?? {});
        if (!parsed) {
          errors.push(`Could not read "${rawValue}" as a date for ${field.label}`);
          values[canonicalKey] = null;
          break;
        }
        values[canonicalKey] = parsed;
        break;
      }
      case "accountStatus":
        values[canonicalKey] = parseAccountStatus(rawValue);
        break;
      default:
        values[canonicalKey] =
          canonicalKey === "rawEmail" ? normaliseEmail(rawValue) : rawValue;
    }
  }

  const username = String(values.rawUsername ?? "");
  const email = String(values.rawEmail ?? "");
  const matchKey = buildMatchKey(username, email);
  if (!matchKey) {
    errors.push("Row has neither a username nor an email, so it cannot be identified");
  }

  return { values, personName, matchKey, errors };
}

/** Validate a mapping before it is used or saved. */
export function validateMapping(mapping: Record<string, string>): string[] {
  const errors: string[] = [];
  const used = Object.values(mapping).filter(Boolean);

  const duplicates = used.filter((key, index) => used.indexOf(key) !== index);
  for (const key of [...new Set(duplicates)]) {
    errors.push(`Canonical field "${CANONICAL_BY_KEY.get(key)?.label ?? key}" is mapped more than once`);
  }

  if (!used.includes("rawUsername") && !used.includes("rawEmail")) {
    errors.push("Map at least one identity column: username or email");
  }
  return errors;
}
