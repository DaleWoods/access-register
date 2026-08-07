import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canEditVendor } from "@/lib/auth/policy";
import { Alert, Card, PageHeader, Stat, StatusBadge, formatDateTime } from "@/components/ui";
import {
  bulkStagedDecision,
  commitStagedBatch,
  discardStagedBatch,
  toggleDisappeared,
} from "@/app/actions/imports";
import { DiffRows } from "./diff-rows";

export const dynamic = "force-dynamic";

type StagedCanonical = {
  values: Record<string, string | null>;
  personName: string;
  matchKey: string;
};

/**
 * The diff preview. Three buckets — new, changed, disappeared — with the exact
 * field-level changes shown, and every removal requiring a tick before it
 * happens. Nothing on this page has touched the register yet.
 */
export default async function ImportPreviewPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const user = await requireUser();

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: {
      vendor: true,
      instance: true,
      importedBy: true,
      rows: { orderBy: { rowNumber: "asc" } },
      disappeared: {
        include: { accessRecord: { include: { person: true } } },
        orderBy: { accessRecord: { rawUsername: "asc" } },
      },
    },
  });
  if (!batch) notFound();

  const actor = toActor(user);
  const editable = canEditVendor(actor, batch.vendorId) && batch.status === "STAGED";

  const people = await prisma.person.findMany({
    where: { mergedIntoId: null },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, primaryEmail: true },
  });
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const newRows = batch.rows.filter((r) => r.diff === "NEW");
  const changedRows = batch.rows.filter((r) => r.diff === "CHANGED");
  const unchangedRows = batch.rows.filter((r) => r.diff === "UNCHANGED");
  const invalidRows = batch.rows.filter((r) => r.diff === "INVALID");

  const pendingPeople = batch.rows.filter(
    (r) => r.diff !== "INVALID" && !r.skip && !r.decidedPersonId && !r.createPerson,
  ).length;
  const confirmedRemovals = batch.disappeared.filter((d) => d.confirmRemove).length;

  const committed = (batch.summary as Record<string, unknown>).committed as
    | Record<string, number>
    | undefined;

  return (
    <>
      <PageHeader
        title={`Import preview — ${batch.vendor.name}`}
        subtitle={
          <>
            {batch.sourceFilename}
            {batch.instance ? ` · ${batch.instance.name}` : ""} · staged{" "}
            {formatDateTime(batch.createdAt)} by {batch.importedBy.fullName}
          </>
        }
        actions={
          <Link href="/import" className="btn-secondary">
            Back to imports
          </Link>
        }
      />

      {batch.status === "COMMITTED" ? (
        <div className="mb-4">
          <Alert tone="success" title="Committed">
            Applied {formatDateTime(batch.importedAt)}.{" "}
            {committed
              ? `${committed.created} created, ${committed.updated} updated, ${committed.unchanged} unchanged, ${committed.removed} marked removed, ${committed.personsCreated} people created.`
              : null}{" "}
            <Link href={`/register?vendorId=${batch.vendorId}`} className="link">
              View these accounts in the register
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      {batch.status === "DISCARDED" ? (
        <div className="mb-4">
          <Alert tone="info" title="Discarded">
            This staged batch was thrown away. The register was not changed.
          </Alert>
        </div>
      ) : null}

      {batch.status === "STAGED" ? (
        <div className="mb-4">
          <Alert tone="warn" title="Nothing has been committed yet">
            This is a preview of what would change. Review each bucket below, then commit or
            discard.
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="New" value={newRows.length} tone={newRows.length ? "good" : "default"} />
        <Stat label="Changed" value={changedRows.length} tone={changedRows.length ? "warn" : "default"} />
        <Stat label="Unchanged" value={unchangedRows.length} />
        <Stat
          label="Disappeared"
          value={batch.disappeared.length}
          tone={batch.disappeared.length ? "danger" : "default"}
        />
        <Stat label="Invalid" value={invalidRows.length} tone={invalidRows.length ? "danger" : "default"} />
      </div>

      {newRows.length === 0 && changedRows.length === 0 && batch.disappeared.length === 0 ? (
        <div className="mb-4">
          <Alert tone="success" title="This export matches the register exactly">
            Every row is already recorded with the same values, and nothing has gone missing.
            Committing this batch changes nothing — which is exactly what a repeat import of an
            unchanged export should do.
          </Alert>
        </div>
      ) : null}

      {/* --- Disappeared: the one bucket that can remove access --- */}
      {batch.disappeared.length ? (
        <Card
          className="mb-4 overflow-hidden"
          title={`Disappeared — in the register, absent from this file (${batch.disappeared.length})`}
          actions={
            editable ? (
              <div className="flex gap-2">
                <form action={bulkStagedDecision}>
                  <input type="hidden" name="batchId" value={batch.id} />
                  <input type="hidden" name="action" value="confirmAllRemovals" />
                  <button className="btn-secondary btn-sm" type="submit">
                    Confirm all
                  </button>
                </form>
                <form action={bulkStagedDecision}>
                  <input type="hidden" name="batchId" value={batch.id} />
                  <input type="hidden" name="action" value="clearAllRemovals" />
                  <button className="btn-secondary btn-sm" type="submit">
                    Clear all
                  </button>
                </form>
              </div>
            ) : null
          }
        >
          <div className="border-b border-slate-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
            These accounts are not in the uploaded file. That usually means they were removed at
            source — but it can also mean a partial export. Nothing is removed unless you tick it.
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Current status</th>
                  <th>Mark as removed</th>
                </tr>
              </thead>
              <tbody>
                {batch.disappeared.map((candidate) => (
                  <tr key={candidate.id} className={candidate.confirmRemove ? "bg-red-50" : ""}>
                    <td>
                      <Link href={`/register/${candidate.accessRecordId}`} className="link font-mono text-xs">
                        {candidate.accessRecord.rawUsername || candidate.accessRecord.rawEmail}
                      </Link>
                    </td>
                    <td className="text-sm">
                      {candidate.accessRecord.person?.fullName ?? (
                        <span className="text-xs text-slate-400">unmatched</span>
                      )}
                    </td>
                    <td className="text-sm">{candidate.accessRecord.role || "—"}</td>
                    <td>
                      <StatusBadge status={candidate.accessRecord.accountStatus} />
                    </td>
                    <td>
                      {editable ? (
                        <form action={toggleDisappeared}>
                          <input type="hidden" name="candidateId" value={candidate.id} />
                          <button
                            type="submit"
                            className={candidate.confirmRemove ? "btn-danger btn-sm" : "btn-secondary btn-sm"}
                          >
                            {candidate.confirmRemove ? "Will be removed" : "Leave as is"}
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {candidate.confirmRemove ? "Removed on commit" : "Left as is"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* --- New and changed rows --- */}
      <DiffRows
        title={`New accounts (${newRows.length})`}
        rows={newRows.map(toRowView)}
        peopleById={peopleById}
        people={people}
        editable={editable}
        batchId={batch.id}
        emptyText="No new accounts in this file."
        showChanges={false}
      />

      <div className="mt-4">
        <DiffRows
          title={`Changed accounts (${changedRows.length})`}
          rows={changedRows.map(toRowView)}
          peopleById={peopleById}
          people={people}
          editable={editable}
          batchId={batch.id}
          emptyText="No existing accounts changed."
          showChanges
        />
      </div>

      {invalidRows.length ? (
        <div className="mt-4">
          <Card title={`Rows that could not be read (${invalidRows.length})`}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Problem</th>
                    <th>Raw data</th>
                  </tr>
                </thead>
                <tbody>
                  {invalidRows.map((row) => (
                    <tr key={row.id}>
                      <td className="tabular-nums">{row.rowNumber}</td>
                      <td className="text-sm text-red-700">{row.errors.join("; ")}</td>
                      <td className="font-mono text-[11px] text-slate-500">
                        {JSON.stringify(row.raw).slice(0, 160)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {/* --- Commit --- */}
      {editable ? (
        <Card className="mt-6" title="Commit">
          <div className="card-body space-y-3">
            {pendingPeople > 0 ? (
              <Alert tone="info">
                {pendingPeople} row{pendingPeople === 1 ? "" : "s"} will stay unmatched to a person
                and be flagged for follow-up. That is fine — the register never guesses who an
                account belongs to. Use the bulk actions above if you would rather resolve them now.
              </Alert>
            ) : null}

            <p className="text-sm text-slate-600">
              Committing writes {newRows.length} new account{newRows.length === 1 ? "" : "s"},
              updates {changedRows.length}, and marks {confirmedRemovals} as removed. It runs as a
              single transaction, so it either all lands or none of it does.
            </p>

            <div className="flex gap-2">
              <form action={commitStagedBatch}>
                <input type="hidden" name="batchId" value={batch.id} />
                <button type="submit" className="btn-primary">
                  Commit this import
                </button>
              </form>
              <form action={discardStagedBatch}>
                <input type="hidden" name="batchId" value={batch.id} />
                <button type="submit" className="btn-secondary">
                  Discard
                </button>
              </form>
            </div>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function toRowView(row: {
  id: string;
  rowNumber: number;
  canonical: unknown;
  changes: unknown;
  errors: string[];
  matchedRecordId: string | null;
  matchedPersonId: string | null;
  suggestedPersonId: string | null;
  suggestedPersonScore: number | null;
  decidedPersonId: string | null;
  createPerson: boolean;
  skip: boolean;
}) {
  const canonical = row.canonical as StagedCanonical;
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    username: canonical.values?.rawUsername ?? "",
    email: canonical.values?.rawEmail ?? "",
    personName: canonical.personName ?? "",
    role: canonical.values?.role ?? "",
    changes: (row.changes ?? []) as { field: string; oldValue: string | null; newValue: string | null }[],
    matchedRecordId: row.matchedRecordId,
    matchedPersonId: row.matchedPersonId,
    suggestedPersonId: row.suggestedPersonId,
    suggestedPersonScore: row.suggestedPersonScore,
    decidedPersonId: row.decidedPersonId,
    createPerson: row.createPerson,
    skip: row.skip,
  };
}
