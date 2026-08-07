import { createHash } from "node:crypto";
import type { FieldState, Prisma, StagedRowDiff } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CANONICAL_BY_KEY, VENDOR_EXPOSURE_FLAG } from "@/lib/canonical-fields";
import { serialiseValue, type FieldChange } from "@/lib/audit";
import { matchPersonByEmail, suggestPersonByName, nameFromEmail } from "@/lib/matching";
import { getSettings } from "@/lib/settings";
import { parseTable } from "@/lib/import/parse";
import {
  normaliseRow,
  validateMapping,
  type CanonicalRow,
  type MappingOptions,
} from "@/lib/import/normalise";

/**
 * Stage an import: parse, normalise, diff against the live register, and park
 * the whole thing in the staging tables. Nothing here touches AccessRecord —
 * the operator sees the New / Changed / Disappeared preview first, and only a
 * commit applies it.
 */

export type StageInput = {
  vendorId: string;
  instanceId: string | null;
  sourceFilename: string;
  text: string;
  mapping: Record<string, string>;
  options?: MappingOptions;
  mappingId?: string | null;
  userId: string;
};

export type StageResult =
  | { ok: false; errors: string[] }
  | { ok: true; batchId: string; summary: StageSummary; warnings: string[] };

export type StageSummary = {
  rowCount: number;
  new: number;
  changed: number;
  unchanged: number;
  invalid: number;
  disappeared: number;
  unmatchedPersons: number;
  suggestedPersons: number;
};

/** Field states this import implies, given what the vendor exposes. */
export function resolveFieldStates(
  vendor: {
    exposesLastLogin: boolean;
    exposesPasswordExpiry: boolean;
    exposesAccountExpiry: boolean;
    exposesAccountCreated: boolean;
  },
  mappedKeys: Set<string>,
): { states: Record<string, FieldState>; warnings: string[] } {
  const states: Record<string, FieldState> = {};
  const warnings: string[] = [];

  for (const [canonicalKey, flag] of Object.entries(VENDOR_EXPOSURE_FLAG)) {
    const field = CANONICAL_BY_KEY.get(canonicalKey);
    if (!field?.stateColumn) continue;

    const exposed = vendor[flag as keyof typeof vendor];
    const mapped = mappedKeys.has(canonicalKey);

    if (mapped) {
      // The export contains the column, so the vendor plainly does expose it.
      states[field.stateColumn] = "CAPTURED";
      if (!exposed) {
        warnings.push(
          `This export includes ${field.label}, but the vendor is configured as not exposing it. ` +
            `Imported values will be captured — consider updating the vendor's settings.`,
        );
      }
    } else if (!exposed) {
      // The vendor will never give us this. Record it as N/A, not blank.
      states[field.stateColumn] = "NOT_EXPOSED";
    }
    // Exposed but unmapped: leave the record's existing state alone.
  }
  return { states, warnings };
}

type ExistingRecord = {
  id: string;
  matchKey: string;
  personId: string | null;
  accountStatus: string;
  [key: string]: unknown;
};

/** Compare a normalised row to an existing record over the mapped fields only. */
export function diffRow(
  existing: ExistingRecord,
  row: CanonicalRow,
  states: Record<string, FieldState>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [key, value] of Object.entries(row.values)) {
    const field = CANONICAL_BY_KEY.get(key);
    if (!field || !field.diffable) continue;

    const before = serialiseValue(existing[field.column]);
    const after = serialiseValue(value);
    if (before !== after) changes.push({ field: field.column, oldValue: before, newValue: after });
  }

  for (const [stateColumn, nextState] of Object.entries(states)) {
    const before = serialiseValue(existing[stateColumn]);
    if (before !== nextState) {
      changes.push({ field: stateColumn, oldValue: before, newValue: nextState });
    }
  }

  return changes;
}

export async function stageImport(input: StageInput): Promise<StageResult> {
  const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId } });
  if (!vendor) return { ok: false, errors: ["Vendor not found"] };

  const mappingErrors = validateMapping(input.mapping);
  if (mappingErrors.length) return { ok: false, errors: mappingErrors };

  const table = parseTable(input.text);
  const fatal = table.errors.filter((e) => e.startsWith("No column") || e.startsWith("The file"));
  if (fatal.length) return { ok: false, errors: table.errors };
  if (table.rows.length === 0) return { ok: false, errors: ["No data rows found"] };

  const unknownColumns = Object.keys(input.mapping).filter((c) => !table.headers.includes(c));
  if (unknownColumns.length) {
    return {
      ok: false,
      errors: [
        `The saved mapping expects columns this file does not have: ${unknownColumns.join(", ")}. ` +
          `Re-map the columns for this export.`,
      ],
    };
  }

  const settings = await getSettings();
  const mappedKeys = new Set(Object.values(input.mapping).filter(Boolean));
  const { states, warnings } = resolveFieldStates(vendor, mappedKeys);

  const instanceKey = input.instanceId ?? "";
  const existingRecords = await prisma.accessRecord.findMany({
    where: { vendorId: input.vendorId, instanceKey },
  });
  const existingByKey = new Map(existingRecords.map((r) => [r.matchKey, r as ExistingRecord]));

  // Person candidates are loaded once; fuzzy matching against the DB per row
  // would be needlessly slow on a large export.
  const personCandidates = await prisma.person.findMany({
    where: { mergedIntoId: null },
    select: { id: true, fullName: true },
  });

  const seenKeys = new Set<string>();
  const stagedRows: Omit<Prisma.StagedRowCreateManyInput, "batchId">[] = [];
  const summary: StageSummary = {
    rowCount: table.rows.length,
    new: 0,
    changed: 0,
    unchanged: 0,
    invalid: 0,
    disappeared: 0,
    unmatchedPersons: 0,
    suggestedPersons: 0,
  };

  for (const [index, raw] of table.rows.entries()) {
    const row = normaliseRow(raw, input.mapping, input.options ?? {});
    const errors = [...row.errors];

    let diff: StagedRowDiff = "NEW";
    let changes: FieldChange[] = [];
    let matchedRecordId: string | null = null;

    if (errors.length && !row.matchKey) {
      diff = "INVALID";
    } else if (seenKeys.has(row.matchKey)) {
      errors.push("Duplicate of an earlier row in this file with the same identity");
      diff = "INVALID";
    } else {
      seenKeys.add(row.matchKey);
      const existing = existingByKey.get(row.matchKey);
      if (existing) {
        matchedRecordId = existing.id;
        changes = diffRow(existing, row, states);
        diff = changes.length ? "CHANGED" : "UNCHANGED";
      }
    }

    // --- Person resolution -------------------------------------------------
    let matchedPersonId: string | null = null;
    let suggestedPersonId: string | null = null;
    let suggestedPersonScore: number | null = null;

    if (diff !== "INVALID") {
      const email = String(row.values.rawEmail ?? "");
      if (email) {
        const match = await matchPersonByEmail(email);
        if (match) matchedPersonId = match.personId;
      }
      if (!matchedPersonId) {
        const name = row.personName || nameFromEmail(email);
        if (name) {
          const suggestion = await suggestPersonByName(
            name,
            settings.fuzzyMatchThreshold,
            personCandidates,
          );
          if (suggestion) {
            suggestedPersonId = suggestion.personId;
            suggestedPersonScore = Number(suggestion.score.toFixed(3));
          }
        }
      }
    }

    const existingPersonId = matchedRecordId
      ? (existingByKey.get(row.matchKey)?.personId ?? null)
      : null;
    if (diff !== "INVALID" && !matchedPersonId && !existingPersonId) {
      summary.unmatchedPersons += 1;
      if (suggestedPersonId) summary.suggestedPersons += 1;
    }

    summary[diff.toLowerCase() as "new" | "changed" | "unchanged" | "invalid"] += 1;

    stagedRows.push({
      rowNumber: index + 1,
      raw: raw as Prisma.InputJsonValue,
      canonical: serialiseCanonical(row) as Prisma.InputJsonValue,
      diff,
      changes: changes as unknown as Prisma.InputJsonValue,
      errors,
      matchedRecordId,
      matchedPersonId,
      suggestedPersonId,
      suggestedPersonScore,
      // Email matches are authoritative, so they are applied by default.
      // Fuzzy suggestions stay unapplied until a human accepts them.
      decidedPersonId: matchedPersonId,
      createPerson: false,
      skip: false,
    });
  }

  // --- Disappeared: in the register, absent from this file -------------------
  const disappeared = existingRecords.filter(
    (r) => r.accountStatus !== "REMOVED" && !seenKeys.has(r.matchKey),
  );
  summary.disappeared = disappeared.length;

  const payloadHash = createHash("sha256")
    .update(JSON.stringify(stagedRows.map((r) => r.canonical)))
    .digest("hex");

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: {
        vendorId: input.vendorId,
        instanceId: input.instanceId,
        importedById: input.userId,
        mappingId: input.mappingId ?? null,
        status: "STAGED",
        sourceFilename: input.sourceFilename,
        rowCount: table.rows.length,
        summary: summary as unknown as Prisma.InputJsonValue,
        payloadHash,
      },
    });

    await tx.stagedRow.createMany({
      data: stagedRows.map((r) => ({ ...r, batchId: created.id })),
    });

    if (disappeared.length) {
      await tx.disappearedCandidate.createMany({
        data: disappeared.map((r) => ({
          batchId: created.id,
          accessRecordId: r.id,
          // Never pre-ticked. Removal is always an explicit human decision.
          confirmRemove: false,
        })),
      });
    }
    return created;
  });

  const allWarnings = [...warnings, ...table.errors];
  return { ok: true, batchId: batch.id, summary, warnings: allWarnings };
}

/** Dates become ISO strings so the staged payload round-trips through JSON. */
function serialiseCanonical(row: CanonicalRow): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.values)) {
    values[key] = value instanceof Date ? value.toISOString() : value;
  }
  return { values, personName: row.personName, matchKey: row.matchKey };
}

export type StagedCanonical = {
  values: Record<string, string | null>;
  personName: string;
  matchKey: string;
};
