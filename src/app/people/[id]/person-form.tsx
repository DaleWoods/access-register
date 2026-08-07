import type { Person } from "@prisma/client";
import { Card, formatDate } from "@/components/ui";
import { updatePerson } from "@/app/actions/people";

export function PersonForm({ person, editable }: { person: Person; editable: boolean }) {
  return (
    <Card title="Person details">
      <form action={updatePerson} className="card-body grid gap-4 md:grid-cols-2">
        <input type="hidden" name="id" value={person.id} />

        <div className="md:col-span-2">
          <label className="label">Full name</label>
          <input name="fullName" defaultValue={person.fullName} className="input" disabled={!editable} required />
        </div>

        <div>
          <label className="label">Primary email</label>
          <input
            name="primaryEmail"
            type="email"
            defaultValue={person.primaryEmail ?? ""}
            className="input"
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label">Person type</label>
          <select name="personType" defaultValue={person.personType} className="input" disabled={!editable}>
            <option value="EMPLOYEE">Employee</option>
            <option value="CONTRACTOR">Contractor</option>
            <option value="PARTNER">Partner</option>
            <option value="SERVICE_ACCOUNT">Service account</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="label">Alternate emails</label>
          <textarea
            name="alternateEmails"
            defaultValue={person.alternateEmails.join("\n")}
            rows={2}
            className="input"
            disabled={!editable}
            placeholder="One per line — used to match this person across vendor systems"
          />
        </div>

        <div>
          <label className="label">Employee status</label>
          <select
            name="employeeStatus"
            defaultValue={person.employeeStatus}
            className="input"
            disabled={!editable}
          >
            <option value="ACTIVE">Active</option>
            <option value="LEFT">Left</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
        </div>

        <div>
          <label className="label">Department</label>
          <input name="department" defaultValue={person.department ?? ""} className="input" disabled={!editable} />
        </div>

        <div>
          <label className="label">Line manager</label>
          <input name="lineManager" defaultValue={person.lineManager ?? ""} className="input" disabled={!editable} />
        </div>

        <div>
          <label className="label">HR reference</label>
          <input name="hrReference" defaultValue={person.hrReference ?? ""} className="input" disabled={!editable} />
        </div>

        <div>
          <label className="label">Start date</label>
          <input
            type="date"
            name="startDate"
            defaultValue={formatDate(person.startDate)}
            className="input"
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label">Leave date</label>
          <input
            type="date"
            name="leaveDate"
            defaultValue={formatDate(person.leaveDate)}
            className="input"
            disabled={!editable}
          />
        </div>

        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <textarea name="notes" defaultValue={person.notes} rows={2} className="input" disabled={!editable} />
        </div>

        {editable ? (
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary">
              Save person
            </button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
