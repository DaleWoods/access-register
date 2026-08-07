import type { AccessRecord, FieldState, VendorInstance } from "@prisma/client";
import { Card, formatDate } from "@/components/ui";
import { confirmRecord, markRecordRemoved, updateRecord } from "@/app/actions/records";

/**
 * Edit form for one register row.
 *
 * Each date field has a companion state control so an operator can say
 * "this vendor does not expose this" explicitly, rather than leaving a blank
 * that reads as unfinished work.
 */

export function RecordForm({
  record,
  instances,
  editable,
}: {
  record: AccessRecord;
  instances: VendorInstance[];
  editable: boolean;
}) {
  return (
    <Card
      title="Account details"
      actions={
        editable ? (
          <div className="flex gap-2">
            <form action={confirmRecord}>
              <input type="hidden" name="id" value={record.id} />
              <button className="btn-secondary btn-sm" type="submit">
                Confirm as correct
              </button>
            </form>
            {record.accountStatus !== "REMOVED" ? (
              <form action={markRecordRemoved}>
                <input type="hidden" name="id" value={record.id} />
                <button className="btn-danger btn-sm" type="submit">
                  Mark removed
                </button>
              </form>
            ) : null}
          </div>
        ) : null
      }
    >
      <form action={updateRecord} className="card-body grid gap-4 md:grid-cols-2">
        <input type="hidden" name="id" value={record.id} />
        <input type="hidden" name="personId" value={record.personId ?? ""} />

        <Text label="Username" name="rawUsername" defaultValue={record.rawUsername} disabled={!editable} />
        <Text label="Email" name="rawEmail" type="email" defaultValue={record.rawEmail} disabled={!editable} />
        <Text label="Role" name="role" defaultValue={record.role} disabled={!editable} />
        <Text
          label="Permission level"
          name="permissionLevel"
          defaultValue={record.permissionLevel}
          disabled={!editable}
          hint="Use where the named role is not specific enough."
        />

        <div>
          <label className="label">Account status</label>
          <select
            name="accountStatus"
            defaultValue={record.accountStatus}
            className="input"
            disabled={!editable}
          >
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
            <option value="REMOVED">Removed</option>
          </select>
        </div>

        {instances.length ? (
          <div>
            <label className="label">Instance</label>
            <select
              name="instanceId"
              defaultValue={record.instanceId ?? ""}
              className="input"
              disabled={!editable}
            >
              <option value="">None</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="instanceId" value={record.instanceId ?? ""} />
        )}

        <StatefulDate
          label="Last login"
          name="lastLogin"
          value={record.lastLogin}
          state={record.lastLoginState}
          disabled={!editable}
        />
        <StatefulDate
          label="Account created"
          name="accountCreated"
          value={record.accountCreated}
          state={record.accountCreatedState}
          disabled={!editable}
        />
        <StatefulDate
          label="Account expiry"
          name="accountExpiry"
          value={record.accountExpiry}
          state={record.accountExpiryState}
          disabled={!editable}
        />
        <StatefulDate
          label="Password expiry"
          name="passwordExpiry"
          value={record.passwordExpiry}
          state={record.passwordExpiryState}
          disabled={!editable}
        />

        <div className="md:col-span-2">
          <label className="label">Justification — why do they have this access?</label>
          <textarea
            name="justification"
            defaultValue={record.justification}
            rows={3}
            className="input"
            disabled={!editable}
          />
        </div>

        {editable ? (
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary">
              Save changes
            </button>
            <span className="ml-3 text-xs text-slate-500">
              Saving also stamps this row as confirmed today.
            </span>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function Text({
  label,
  name,
  defaultValue,
  disabled,
  type = "text",
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  disabled: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input name={name} type={type} defaultValue={defaultValue} className="input" disabled={disabled} />
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function StatefulDate({
  label,
  name,
  value,
  state,
  disabled,
}: {
  label: string;
  name: string;
  value: Date | null;
  state: FieldState;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input
          type="date"
          name={name}
          defaultValue={formatDate(value)}
          className="input"
          disabled={disabled || state === "NOT_EXPOSED"}
        />
        <select
          name={`${name}State`}
          defaultValue={state}
          className="input w-44"
          disabled={disabled}
          title="Blank means not yet captured. N/A means this vendor will never provide it."
        >
          <option value="BLANK">Blank</option>
          <option value="CAPTURED">Captured</option>
          <option value="NOT_EXPOSED">N/A – not exposed</option>
        </select>
      </div>
    </div>
  );
}
