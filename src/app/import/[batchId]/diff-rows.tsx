import { Card, EmptyState } from "@/components/ui";
import { bulkStagedDecision, updateStagedRow } from "@/app/actions/imports";

/**
 * One bucket of the diff preview.
 *
 * For changed rows it shows the exact field-level before/after, so the
 * reviewer sees "role: Admin → Read Only" rather than a bare "changed".
 * The person column is where the never-guess rule shows up: an email match is
 * applied, a fuzzy name match is offered with its score, and anything else
 * stays unmatched until someone decides.
 */

const FIELD_LABELS: Record<string, string> = {
  rawUsername: "Username",
  rawEmail: "Email",
  role: "Role",
  permissionLevel: "Permission level",
  accountStatus: "Status",
  accountCreated: "Account created",
  accountExpiry: "Account expiry",
  passwordExpiry: "Password expiry",
  lastLogin: "Last login",
  justification: "Justification",
  lastLoginState: "Last login availability",
  passwordExpiryState: "Password expiry availability",
  accountExpiryState: "Account expiry availability",
  accountCreatedState: "Account created availability",
};

const STATE_LABELS: Record<string, string> = {
  CAPTURED: "captured",
  BLANK: "blank",
  NOT_EXPOSED: "N/A – not exposed",
};

/** Render a staged value the way a human reads it, not the way it is stored. */
function displayValue(raw: string | null): string {
  if (!raw) return "empty";
  if (STATE_LABELS[raw]) return STATE_LABELS[raw];
  const iso = /^(\d{4}-\d{2}-\d{2})T[\d:.]+Z$/.exec(raw);
  if (iso) return iso[1];
  return raw;
}

type RowView = {
  id: string;
  rowNumber: number;
  username: string;
  email: string;
  personName: string;
  role: string;
  changes: { field: string; oldValue: string | null; newValue: string | null }[];
  matchedPersonId: string | null;
  suggestedPersonId: string | null;
  suggestedPersonScore: number | null;
  decidedPersonId: string | null;
  createPerson: boolean;
  skip: boolean;
};

export function DiffRows({
  title,
  rows,
  people,
  peopleById,
  editable,
  batchId,
  emptyText,
  showChanges,
}: {
  title: string;
  rows: RowView[];
  people: { id: string; fullName: string; primaryEmail: string | null }[];
  peopleById: Map<string, { id: string; fullName: string; primaryEmail: string | null }>;
  editable: boolean;
  batchId: string;
  emptyText: string;
  showChanges: boolean;
}) {
  const unresolved = rows.filter((r) => !r.decidedPersonId && !r.createPerson && !r.skip).length;
  const suggestions = rows.filter((r) => !r.decidedPersonId && r.suggestedPersonId).length;

  return (
    <Card
      title={title}
      className="overflow-hidden"
      actions={
        editable && rows.length ? (
          <div className="flex flex-wrap gap-2">
            {suggestions > 0 ? (
              <form action={bulkStagedDecision}>
                <input type="hidden" name="batchId" value={batchId} />
                <input type="hidden" name="action" value="acceptAllSuggestions" />
                <button className="btn-secondary btn-sm" type="submit">
                  Accept {suggestions} name suggestion{suggestions === 1 ? "" : "s"}
                </button>
              </form>
            ) : null}
            {unresolved > 0 ? (
              <form action={bulkStagedDecision}>
                <input type="hidden" name="batchId" value={batchId} />
                <input type="hidden" name="action" value="createAllUnmatched" />
                <button className="btn-secondary btn-sm" type="submit">
                  Create people for {unresolved} unmatched
                </button>
              </form>
            ) : null}
          </div>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-12">Row</th>
                <th>Account</th>
                <th>Role</th>
                {showChanges ? <th>What changes</th> : null}
                <th className="w-80">Person</th>
                {editable ? <th className="w-20">Skip</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.skip ? "opacity-40" : ""}>
                  <td className="tabular-nums text-xs text-slate-400">{row.rowNumber}</td>
                  <td>
                    <div className="font-mono text-xs font-medium">{row.username || "—"}</div>
                    <div className="font-mono text-[11px] text-slate-500">{row.email || ""}</div>
                    {row.personName ? (
                      <div className="text-[11px] text-slate-500">{row.personName}</div>
                    ) : null}
                  </td>
                  <td className="text-sm">{row.role || "—"}</td>

                  {showChanges ? (
                    <td>
                      <ul className="space-y-0.5">
                        {row.changes.map((change) => (
                          <li key={change.field} className="text-xs">
                            <span className="font-medium">
                              {FIELD_LABELS[change.field] ?? change.field}
                            </span>{" "}
                            <span className="text-slate-500 line-through">
                              {displayValue(change.oldValue)}
                            </span>{" "}
                            <span className="text-slate-400">→</span>{" "}
                            <span className="font-medium text-emerald-700">
                              {displayValue(change.newValue)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  ) : null}

                  <td>
                    <PersonCell row={row} people={people} peopleById={peopleById} editable={editable} />
                  </td>

                  {editable ? (
                    <td>
                      <form action={updateStagedRow}>
                        <input type="hidden" name="rowId" value={row.id} />
                        <input type="hidden" name="action" value="toggleSkip" />
                        <button type="submit" className="btn-secondary btn-sm">
                          {row.skip ? "Include" : "Skip"}
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PersonCell({
  row,
  people,
  peopleById,
  editable,
}: {
  row: RowView;
  people: { id: string; fullName: string; primaryEmail: string | null }[];
  peopleById: Map<string, { id: string; fullName: string; primaryEmail: string | null }>;
  editable: boolean;
}) {
  const decided = row.decidedPersonId ? peopleById.get(row.decidedPersonId) : null;

  if (decided) {
    return (
      <div className="space-y-1">
        <div className="text-sm">
          <span className="badge bg-emerald-100 text-emerald-800">
            {row.matchedPersonId === row.decidedPersonId ? "Matched on email" : "Chosen"}
          </span>{" "}
          {decided.fullName}
        </div>
        {editable ? (
          <form action={updateStagedRow}>
            <input type="hidden" name="rowId" value={row.id} />
            <input type="hidden" name="action" value="clearPerson" />
            <button type="submit" className="text-[11px] text-slate-500 hover:text-slate-900">
              Clear
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  if (row.createPerson) {
    return (
      <div className="space-y-1">
        <span className="badge bg-sky-100 text-sky-800">New person will be created</span>
        {editable ? (
          <form action={updateStagedRow}>
            <input type="hidden" name="rowId" value={row.id} />
            <input type="hidden" name="action" value="clearPerson" />
            <button type="submit" className="block text-[11px] text-slate-500 hover:text-slate-900">
              Cancel
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  const suggested = row.suggestedPersonId ? peopleById.get(row.suggestedPersonId) : null;

  return (
    <div className="space-y-1.5">
      <span className="badge bg-violet-100 text-violet-800">Unmatched</span>

      {suggested ? (
        <div className="text-xs">
          Possible match: <span className="font-medium">{suggested.fullName}</span>{" "}
          <span className="text-slate-400">
            ({Math.round((row.suggestedPersonScore ?? 0) * 100)}% name similarity)
          </span>
          {editable ? (
            <form action={updateStagedRow} className="mt-1">
              <input type="hidden" name="rowId" value={row.id} />
              <input type="hidden" name="action" value="acceptSuggestion" />
              <button type="submit" className="btn-secondary btn-sm">
                Accept
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-1">
          <form action={updateStagedRow} className="flex items-center gap-1">
            <input type="hidden" name="rowId" value={row.id} />
            <input type="hidden" name="action" value="setPerson" />
            <select name="personId" className="input h-8 w-44 py-0 text-xs" defaultValue="">
              <option value="">Link to…</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-secondary btn-sm">
              Link
            </button>
          </form>
          <form action={updateStagedRow}>
            <input type="hidden" name="rowId" value={row.id} />
            <input type="hidden" name="action" value="createPerson" />
            <button type="submit" className="btn-secondary btn-sm">
              Create person
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
