import type { Vendor } from "@prisma/client";
import { Card } from "@/components/ui";
import { createVendor, updateVendor } from "@/app/actions/vendors";

/**
 * Vendor form. The "exposes" checkboxes are the important part: they decide
 * whether a missing value reads as "N/A - not exposed" or as outstanding work,
 * and therefore whether an account can ever be called dormant.
 */
export function VendorForm({
  vendor,
  owners,
  editable = true,
  canRename = true,
}: {
  vendor?: Vendor;
  owners: { id: string; fullName: string; email: string }[];
  editable?: boolean;
  canRename?: boolean;
}) {
  const editing = Boolean(vendor);

  return (
    <Card title={editing ? "Vendor settings" : "Add a vendor"}>
      <form action={editing ? updateVendor : createVendor} className="card-body space-y-3">
        {vendor ? <input type="hidden" name="id" value={vendor.id} /> : null}

        <div>
          <label className="label">Name</label>
          <input
            name="name"
            defaultValue={vendor?.name ?? ""}
            className="input"
            required
            disabled={!editable || !canRename}
          />
        </div>

        <div>
          <label className="label">Category</label>
          <select
            name="category"
            defaultValue={vendor?.category ?? "OTHER"}
            className="input"
            disabled={!editable}
          >
            <option value="PAYMENTS">Payments</option>
            <option value="COURIER">Courier</option>
            <option value="DEV_TOOLING">Dev tooling</option>
            <option value="ANALYTICS">Analytics</option>
            <option value="BRAND_PARTNER">Brand partner</option>
            <option value="HOSTING">Hosting</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            name="description"
            defaultValue={vendor?.description ?? ""}
            rows={2}
            className="input"
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label">Accountable owner</label>
          <select
            name="ownerUserId"
            defaultValue={vendor?.ownerUserId ?? ""}
            className="input"
            disabled={!editable || !canRename}
          >
            <option value="">Unassigned</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.fullName} ({owner.email})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Capture method</label>
          <select
            name="captureMethod"
            defaultValue={vendor?.captureMethod ?? "CSV_EXPORT"}
            className="input"
            disabled={!editable}
          >
            <option value="CSV_EXPORT">CSV export</option>
            <option value="API">API</option>
            <option value="MANUAL_READ">Manual read</option>
          </select>
        </div>

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Fields this vendor exposes
          </legend>
          <p className="mb-2 text-[11px] leading-tight text-slate-500">
            Unticked means the vendor will never give us this field. Its accounts show
            &ldquo;N/A – not exposed&rdquo; rather than a blank, and last login in particular makes
            them <strong>unverifiable</strong> instead of dormant.
          </p>
          <div className="space-y-1.5 text-sm">
            <Checkbox
              name="exposesLastLogin"
              label="Last login"
              defaultChecked={vendor?.exposesLastLogin ?? true}
              disabled={!editable}
            />
            <Checkbox
              name="exposesPasswordExpiry"
              label="Password expiry"
              defaultChecked={vendor?.exposesPasswordExpiry ?? false}
              disabled={!editable}
            />
            <Checkbox
              name="exposesAccountExpiry"
              label="Account expiry"
              defaultChecked={vendor?.exposesAccountExpiry ?? false}
              disabled={!editable}
            />
            <Checkbox
              name="exposesAccountCreated"
              label="Account created date"
              defaultChecked={vendor?.exposesAccountCreated ?? false}
              disabled={!editable}
            />
          </div>
        </fieldset>

        <div>
          <label className="label">Review frequency (months)</label>
          <input
            type="number"
            name="reviewFrequencyMonths"
            min={1}
            max={36}
            defaultValue={vendor?.reviewFrequencyMonths ?? 3}
            className="input"
            disabled={!editable}
          />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            name="notes"
            defaultValue={vendor?.notes ?? ""}
            rows={2}
            className="input"
            disabled={!editable}
          />
        </div>

        {editable ? (
          <button type="submit" className="btn-primary w-full">
            {editing ? "Save vendor" : "Add vendor"}
          </button>
        ) : null}
      </form>
    </Card>
  );
}

function Checkbox({
  name,
  label,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} />
      {label}
    </label>
  );
}
