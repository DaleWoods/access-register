import type { AccountStatus, FieldState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CANONICAL_BY_KEY } from "@/lib/canonical-fields";
import {
  actorFrom,
  newCorrelationId,
  recordChanges,
  recordCreate,
  recordEvent,
  type AuditContext,
  type FieldChange,
} from "@/lib/audit";
import { refreshFlagsForRecords } from "@/lib/flags";
import { nameFromEmail, normaliseEmail } from "@/lib/matching";
import { resolveFieldStates, type StagedCanonical } from "@/lib/import/stage";

/**
 * Commit a staged batch.
 *
 * Guarantees:
 *  - All-or-nothing. Everything runs inside one transaction; a failure part way
 *    through leaves the register exactly as it was.
 *  - Idempotent. Re-importing the same export produces no field changes and no
 *    audit events, because UNCHANGED rows only touch `lastSeenInSource`.
 *  - Nothing is removed without confirmation. A disappeared account is only
 *    marked Removed if the operator ticked it.
 */

export type CommitResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  removed: number;
  personsCreated: number;
  personsLinked: number;
  auditEvents: number;
};

export async function commitImport(args: {
  batchId: string;
  user: { id: string; fullName: string; email: string };
}): Promise<CommitResult> {
  const { batchId, user } = args;

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { vendor: true, rows: { orderBy: { rowNumber: "asc" } }, disappeared: true },
  });
  if (!batch) throw new Error("Import batch not found");
  if (batch.status !== "STAGED") {
    throw new Error(`This batch is already ${batch.status.toLowerCase()}`);
  }

  const context: AuditContext = {
    actor: actorFrom(user),
    source: "IMPORT",
    correlationId: newCorrelationId(),
  };

  const mappedKeys = new Set<string>();
  for (const row of batch.rows) {
    const canonical = row.canonical as unknown as StagedCanonical;
    for (const key of Object.keys(canonical.values ?? {})) mappedKeys.add(key);
  }
  const { states } = resolveFieldStates(batch.vendor, mappedKeys);

  const result: CommitResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    removed: 0,
    personsCreated: 0,
    personsLinked: 0,
    auditEvents: 0,
  };
  const touchedRecordIds: string[] = [];
  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      // Re-check inside the transaction so two operators cannot commit the
      // same batch twice.
      const fresh = await tx.importBatch.findUnique({
        where: { id: batchId },
        select: { status: true },
      });
      if (fresh?.status !== "STAGED") throw new Error("This batch was already committed");

      // New people created during this commit, keyed by email, so two rows for
      // the same human do not produce two Person records.
      const createdPeople = new Map<string, string>();

      for (const row of batch.rows) {
        if (row.skip || row.diff === "INVALID") {
          result.skipped += 1;
          continue;
        }

        const canonical = row.canonical as unknown as StagedCanonical;
        const values = canonical.values ?? {};
        const email = normaliseEmail(values.rawEmail ?? "");

        // --- Resolve the person for this row ------------------------------
        let personId: string | null = row.decidedPersonId ?? row.matchedPersonId ?? null;

        if (!personId && row.createPerson) {
          const cacheKey = email || `name:${canonical.personName}`;
          const cached = createdPeople.get(cacheKey);
          if (cached) {
            personId = cached;
          } else {
            const fullName = canonical.personName || nameFromEmail(email) || email || "Unknown";
            const person = await tx.person.create({
              data: {
                fullName,
                primaryEmail: email || null,
                personType: "EMPLOYEE",
                employeeStatus: "UNKNOWN",
              },
            });
            await recordCreate({
              db: tx,
              entityType: "Person",
              entityId: person.id,
              context,
              summary: `created from import of ${batch.sourceFilename}`,
            });
            result.auditEvents += 1;
            result.personsCreated += 1;
            createdPeople.set(cacheKey, person.id);
            personId = person.id;
          }
        }

        // --- Apply to the register ----------------------------------------
        const writable = buildWritableFields(values, states);

        if (row.matchedRecordId) {
          const existing = await tx.accessRecord.findUnique({
            where: { id: row.matchedRecordId },
          });
          if (!existing) {
            result.skipped += 1;
            continue;
          }

          const changes: FieldChange[] = [];
          const data: Prisma.AccessRecordUpdateInput = {};

          for (const [column, value] of Object.entries(writable)) {
            const before = normaliseForCompare(existing[column as keyof typeof existing]);
            const after = normaliseForCompare(value);
            if (before === after) continue;
            changes.push({ field: column, oldValue: before, newValue: after });
            (data as Record<string, unknown>)[column] = value;
          }

          if (personId && personId !== existing.personId) {
            changes.push({
              field: "personId",
              oldValue: existing.personId,
              newValue: personId,
            });
            data.person = { connect: { id: personId } };
            result.personsLinked += 1;
          }

          // Always stamp that the account was still present at source. This is
          // bookkeeping, not a field change, so it is deliberately not audited
          // and does not make a re-import look like a change.
          data.lastSeenInSource = now;

          await tx.accessRecord.update({ where: { id: existing.id }, data });
          touchedRecordIds.push(existing.id);

          if (changes.length) {
            result.updated += 1;
            result.auditEvents += await recordChanges({
              db: tx,
              entityType: "AccessRecord",
              entityId: existing.id,
              context,
              changes,
            });
          } else {
            result.unchanged += 1;
          }
        } else {
          const created = await tx.accessRecord.create({
            data: {
              vendorId: batch.vendorId,
              instanceId: batch.instanceId,
              instanceKey: batch.instanceId ?? "",
              matchKey: canonical.matchKey,
              personId,
              source: batch.vendor.captureMethod,
              firstSeen: now,
              lastSeenInSource: now,
              ...writable,
            } as Prisma.AccessRecordUncheckedCreateInput,
          });
          touchedRecordIds.push(created.id);
          result.created += 1;
          if (personId) result.personsLinked += 1;

          await recordCreate({
            db: tx,
            entityType: "AccessRecord",
            entityId: created.id,
            context,
            summary: `created from import of ${batch.sourceFilename} (${batch.vendor.name})`,
          });
          result.auditEvents += 1;
        }
      }

      // --- Disappeared accounts, only where confirmed --------------------
      for (const candidate of batch.disappeared) {
        if (!candidate.confirmRemove) continue;

        const record = await tx.accessRecord.findUnique({
          where: { id: candidate.accessRecordId },
        });
        if (!record || record.accountStatus === "REMOVED") continue;

        await tx.accessRecord.update({
          where: { id: record.id },
          data: { accountStatus: "REMOVED" as AccountStatus },
        });
        touchedRecordIds.push(record.id);
        result.removed += 1;

        await recordChanges({
          db: tx,
          entityType: "AccessRecord",
          entityId: record.id,
          context,
          changes: [
            { field: "accountStatus", oldValue: record.accountStatus, newValue: "REMOVED" },
          ],
        });
        await recordEvent({
          db: tx,
          entityType: "AccessRecord",
          entityId: record.id,
          context,
          newValue: `confirmed removed at source — absent from import of ${batch.sourceFilename}`,
        });
        result.auditEvents += 2;
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: "COMMITTED",
          importedAt: now,
          summary: {
            ...(batch.summary as object),
            committed: result,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      await recordEvent({
        db: tx,
        entityType: "ImportBatch",
        entityId: batchId,
        context,
        newValue:
          `committed ${batch.sourceFilename} for ${batch.vendor.name}: ` +
          `${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged, ` +
          `${result.removed} removed`,
      });
      result.auditEvents += 1;
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  // Flags are derived state, recomputed after the commit lands. Keeping this
  // outside the transaction keeps the write lock short.
  await refreshFlagsForRecords([...new Set(touchedRecordIds)]);

  return result;
}

/** Map canonical values onto AccessRecord columns, adding the field states. */
function buildWritableFields(
  values: Record<string, string | null>,
  states: Record<string, FieldState>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    const field = CANONICAL_BY_KEY.get(key);
    if (!field || field.column.startsWith("__")) continue;

    if (field.kind === "date") {
      out[field.column] = value ? new Date(value) : null;
    } else if (field.kind === "accountStatus") {
      out[field.column] = (value ?? "ACTIVE") as AccountStatus;
    } else {
      out[field.column] = value ?? "";
    }
  }

  for (const [stateColumn, state] of Object.entries(states)) out[stateColumn] = state;
  return out;
}

function normaliseForCompare(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Throw away a staged batch without touching the register. */
export async function discardBatch(batchId: string): Promise<void> {
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: "DISCARDED", discardedAt: new Date() },
  });
}
