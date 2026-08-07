import Link from "next/link";
import type { Person } from "@prisma/client";
import { Card } from "@/components/ui";
import { linkRecordToPerson } from "@/app/actions/records";

/**
 * Manual identity matching for one account. Offered whenever a row is
 * unmatched — the import pipeline deliberately leaves these for a human
 * rather than guessing.
 */

export function MatchPersonPanel({
  recordId,
  person,
  people,
  editable,
}: {
  recordId: string;
  person: Person | null;
  people: { id: string; fullName: string; primaryEmail: string | null }[];
  editable: boolean;
}) {
  if (person) {
    return (
      <Card title="Person">
        <div className="card-body space-y-2 text-sm">
          <Link href={`/people/${person.id}`} className="link font-medium">
            {person.fullName}
          </Link>
          <div className="text-xs text-slate-500">{person.primaryEmail ?? "no email recorded"}</div>
          <div className="text-xs">
            <span className="text-slate-500">Status: </span>
            {person.employeeStatus === "LEFT" ? (
              <span className="badge bg-red-100 text-red-800">Left</span>
            ) : (
              person.employeeStatus
            )}
          </div>

          {editable ? (
            <form action={linkRecordToPerson} className="border-t border-slate-200 pt-3">
              <input type="hidden" name="id" value={recordId} />
              <label className="label">Re-link to a different person</label>
              <select name="personId" defaultValue={person.id} className="input">
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} {p.primaryEmail ? `(${p.primaryEmail})` : ""}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-secondary btn-sm mt-2">
                Re-link
              </button>
            </form>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Unmatched account">
      <div className="card-body space-y-4 text-sm">
        <p className="text-slate-600">
          This account is not linked to a person, so it is invisible to the leaver process. Link it
          to someone, or create a new person for it.
        </p>

        {editable ? (
          <>
            <form action={linkRecordToPerson} className="space-y-2">
              <input type="hidden" name="id" value={recordId} />
              <input type="hidden" name="mode" value="link" />
              <label className="label">Link to an existing person</label>
              <select name="personId" className="input" required>
                <option value="">Choose a person…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} {p.primaryEmail ? `(${p.primaryEmail})` : ""}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary btn-sm">
                Link
              </button>
            </form>

            <form action={linkRecordToPerson} className="space-y-2 border-t border-slate-200 pt-4">
              <input type="hidden" name="id" value={recordId} />
              <input type="hidden" name="mode" value="create" />
              <label className="label">Or create a new person</label>
              <input name="fullName" placeholder="Full name" className="input" required />
              <input name="primaryEmail" type="email" placeholder="Primary email" className="input" />
              <button type="submit" className="btn-secondary btn-sm">
                Create and link
              </button>
            </form>
          </>
        ) : null}
      </div>
    </Card>
  );
}
