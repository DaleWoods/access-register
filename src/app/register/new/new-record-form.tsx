"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

type Vendor = {
  id: string;
  name: string;
  exposesLastLogin: boolean;
  exposesPasswordExpiry: boolean;
  exposesAccountExpiry: boolean;
  exposesAccountCreated: boolean;
  instances: { id: string; name: string }[];
};

/**
 * Manual entry form. Picking a vendor pre-sets each date field's state from
 * what that vendor actually exposes, so a hand-entered row starts out with the
 * same honest N/A markings an import would produce.
 */
export function NewRecordForm({
  vendors,
  people,
}: {
  vendors: Vendor[];
  people: { id: string; fullName: string; primaryEmail: string | null }[];
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const vendor = vendors.find((v) => v.id === vendorId) ?? vendors[0];

  const stateFor = (exposed: boolean) => (exposed ? "BLANK" : "NOT_EXPOSED");

  return (
    <Card title="New account">
      <div className="card-body grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Vendor</label>
          <select
            name="vendorId"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="input"
            required
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Instance</label>
          <select name="instanceId" className="input" disabled={!vendor?.instances.length}>
            <option value="">None</option>
            {vendor?.instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Username</label>
          <input name="rawUsername" className="input" placeholder="As it appears in the vendor system" />
        </div>

        <div>
          <label className="label">Email</label>
          <input name="rawEmail" type="email" className="input" />
        </div>

        <div>
          <label className="label">Role</label>
          <input name="role" className="input" />
        </div>

        <div>
          <label className="label">Permission level</label>
          <input name="permissionLevel" className="input" />
        </div>

        <div>
          <label className="label">Account status</label>
          <select name="accountStatus" className="input" defaultValue="ACTIVE">
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
            <option value="REMOVED">Removed</option>
          </select>
        </div>

        <div>
          <label className="label">Person</label>
          <select name="personId" className="input" defaultValue="">
            <option value="">Leave unmatched</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} {p.primaryEmail ? `(${p.primaryEmail})` : ""}
              </option>
            ))}
          </select>
        </div>

        <DateField
          key={`${vendorId}-lastLogin`}
          label="Last login"
          name="lastLogin"
          defaultState={stateFor(vendor?.exposesLastLogin ?? true)}
        />
        <DateField
          key={`${vendorId}-accountCreated`}
          label="Account created"
          name="accountCreated"
          defaultState={stateFor(vendor?.exposesAccountCreated ?? false)}
        />
        <DateField
          key={`${vendorId}-accountExpiry`}
          label="Account expiry"
          name="accountExpiry"
          defaultState={stateFor(vendor?.exposesAccountExpiry ?? false)}
        />
        <DateField
          key={`${vendorId}-passwordExpiry`}
          label="Password expiry"
          name="passwordExpiry"
          defaultState={stateFor(vendor?.exposesPasswordExpiry ?? false)}
        />

        <div className="md:col-span-2">
          <label className="label">Justification</label>
          <textarea name="justification" rows={3} className="input" />
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="btn-primary">
            Add account
          </button>
        </div>
      </div>
    </Card>
  );
}

function DateField({
  label,
  name,
  defaultState,
}: {
  label: string;
  name: string;
  defaultState: string;
}) {
  const [state, setState] = useState(defaultState);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input type="date" name={name} className="input" disabled={state === "NOT_EXPOSED"} />
        <select
          name={`${name}State`}
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="input w-44"
        >
          <option value="BLANK">Blank</option>
          <option value="CAPTURED">Captured</option>
          <option value="NOT_EXPOSED">N/A – not exposed</option>
        </select>
      </div>
    </div>
  );
}
