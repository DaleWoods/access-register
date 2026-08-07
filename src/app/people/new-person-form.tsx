import { Card } from "@/components/ui";
import { createPerson } from "@/app/actions/people";

export function NewPersonForm() {
  return (
    <Card title="Add a person">
      <form action={createPerson} className="card-body space-y-3">
        <div>
          <label className="label">Full name</label>
          <input name="fullName" className="input" required />
        </div>
        <div>
          <label className="label">Primary email</label>
          <input name="primaryEmail" type="email" className="input" />
        </div>
        <div>
          <label className="label">Alternate emails</label>
          <textarea
            name="alternateEmails"
            rows={2}
            className="input"
            placeholder="One per line"
          />
        </div>
        <div>
          <label className="label">Person type</label>
          <select name="personType" className="input" defaultValue="EMPLOYEE">
            <option value="EMPLOYEE">Employee</option>
            <option value="CONTRACTOR">Contractor</option>
            <option value="PARTNER">Partner</option>
            <option value="SERVICE_ACCOUNT">Service account</option>
          </select>
        </div>
        <div>
          <label className="label">Employee status</label>
          <select name="employeeStatus" className="input" defaultValue="ACTIVE">
            <option value="ACTIVE">Active</option>
            <option value="LEFT">Left</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
        </div>
        <div>
          <label className="label">Department</label>
          <input name="department" className="input" />
        </div>
        <button type="submit" className="btn-primary w-full">
          Add person
        </button>
      </form>
    </Card>
  );
}
