import { randomUUID } from "node:crypto";
import type { ChangeSource } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";

/**
 * The audit backbone. Every create, update and status change anywhere in the
 * app writes through here.
 *
 * AuditEvent rows are append-only — a database trigger rejects UPDATE and
 * DELETE (see migration `audit_event_append_only`), so nothing in this module
 * ever needs to offer an edit path.
 */

export type AuditActor = {
  id: string | null;
  label: string;
};

export const SYSTEM_ACTOR: AuditActor = { id: null, label: "system" };

export type AuditContext = {
  actor: AuditActor;
  source: ChangeSource;
  /** Groups all events written by one user action. Generated when absent. */
  correlationId?: string;
};

export function newCorrelationId(): string {
  return randomUUID();
}

/** Normalise any field value into the audit log's text representation. */
export function serialiseValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return serialiseValue(a) === serialiseValue(b);
}

export type FieldChange = { field: string; oldValue: string | null; newValue: string | null };

/**
 * Compare two snapshots and return the fields that actually differ.
 * Used both to write audit rows and to drive the import diff preview, so the
 * two can never disagree about what "changed" means.
 */
export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (!(field in after)) continue;
    if (valuesEqual(before[field], after[field])) continue;
    changes.push({
      field,
      oldValue: serialiseValue(before[field]),
      newValue: serialiseValue(after[field]),
    });
  }
  return changes;
}

type WriteArgs = {
  db?: Tx;
  entityType: string;
  entityId: string;
  context: AuditContext;
};

/** One event per changed field. No changes means no events. */
export async function recordChanges(
  args: WriteArgs & { changes: FieldChange[] },
): Promise<number> {
  const { db = prisma, entityType, entityId, context, changes } = args;
  if (changes.length === 0) return 0;

  await db.auditEvent.createMany({
    data: changes.map((c) => ({
      entityType,
      entityId,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      changedById: context.actor.id,
      changedByLabel: context.actor.label,
      changeSource: context.source,
      correlationId: context.correlationId ?? null,
    })),
  });
  return changes.length;
}

/** Convenience wrapper: diff, then write. Returns the changes it recorded. */
export async function recordDiff(
  args: WriteArgs & {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    fields: string[];
  },
): Promise<FieldChange[]> {
  const changes = diffSnapshots(args.before, args.after, args.fields);
  await recordChanges({ ...args, changes });
  return changes;
}

/** Creation event. `field` is null, per the data model. */
export async function recordCreate(
  args: WriteArgs & { summary?: string },
): Promise<void> {
  const { db = prisma, entityType, entityId, context, summary } = args;
  await db.auditEvent.create({
    data: {
      entityType,
      entityId,
      field: null,
      oldValue: null,
      newValue: summary ?? "created",
      changedById: context.actor.id,
      changedByLabel: context.actor.label,
      changeSource: context.source,
      correlationId: context.correlationId ?? null,
    },
  });
}

/**
 * Lifecycle event that is not a plain field edit — a soft delete, a person
 * merge, an import commit. AccessRecords are never hard-deleted, so this is
 * how "removed at source" is recorded alongside the accountStatus change.
 */
export async function recordEvent(
  args: WriteArgs & { field?: string | null; oldValue?: string | null; newValue: string },
): Promise<void> {
  const { db = prisma, entityType, entityId, context } = args;
  await db.auditEvent.create({
    data: {
      entityType,
      entityId,
      field: args.field ?? null,
      oldValue: args.oldValue ?? null,
      newValue: args.newValue,
      changedById: context.actor.id,
      changedByLabel: context.actor.label,
      changeSource: context.source,
      correlationId: context.correlationId ?? null,
    },
  });
}

export function actorFrom(user: { id: string; fullName: string; email: string }): AuditActor {
  return { id: user.id, label: `${user.fullName} <${user.email}>` };
}
