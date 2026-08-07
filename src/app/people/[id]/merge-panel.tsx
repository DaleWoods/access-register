import { Card } from "@/components/ui";
import { mergePeople } from "@/app/actions/people";

/**
 * Manual merge. Matching is never perfect, so duplicates happen — this folds
 * one person into another, moving every account across and keeping all known
 * email addresses so future imports match the survivor.
 */
export function MergePanel({
  personId,
  people,
  editable,
}: {
  personId: string;
  people: { id: string; fullName: string; primaryEmail: string | null }[];
  editable: boolean;
}) {
  if (!editable || people.length === 0) return null;

  return (
    <Card title="Merge a duplicate">
      <form action={mergePeople} className="card-body space-y-2 text-sm">
        <input type="hidden" name="survivorId" value={personId} />
        <p className="text-slate-600">
          Choose a duplicate record to fold into this person. Their accounts and email addresses
          move here; the duplicate is kept as a tombstone so its history still resolves.
        </p>
        <select name="mergedId" className="input" required>
          <option value="">Choose a duplicate…</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName} {person.primaryEmail ? `(${person.primaryEmail})` : ""}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary btn-sm">
          Merge into this person
        </button>
      </form>
    </Card>
  );
}
