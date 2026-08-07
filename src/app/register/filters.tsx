"use client";

import { useState } from "react";
import { FLAG_LABELS } from "@/lib/flags";

/**
 * Filter panel for the register.
 *
 * A plain GET form: every filter ends up in the URL, which means a filtered
 * view is shareable, bookmarkable, saveable, and exports exactly what is on
 * screen.
 */

type Vendor = { id: string; name: string; instances: { id: string; name: string }[] };

function value(params: Record<string, string | string[] | undefined>, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function values(params: Record<string, string | string[] | undefined>, key: string): string[] {
  const v = params[key];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export function RegisterFilters({
  vendors,
  params,
}: {
  vendors: Vendor[];
  params: Record<string, string | string[] | undefined>;
}) {
  const activeCount = Object.entries(params).filter(
    ([k, v]) => !["sort", "dir", "page", "pageSize"].includes(k) && v,
  ).length;
  const [open, setOpen] = useState(activeCount > 0);

  const instances = vendors.flatMap((v) =>
    v.instances.map((i) => ({ ...i, vendorName: v.name })),
  );

  return (
    <form method="get" action="/register" className="card">
      <div className="card-header">
        <div className="flex items-center gap-3">
          <input
            type="search"
            name="q"
            defaultValue={value(params, "q")}
            placeholder="Search username, email, role, person, vendor…"
            className="input w-80"
          />
          <button type="submit" className="btn-primary btn-sm">
            Search
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="btn-secondary btn-sm"
          >
            {open ? "Hide filters" : "More filters"}
            {activeCount > 0 ? (
              <span className="ml-1 rounded-full bg-slate-900 px-1.5 text-[10px] text-white">
                {activeCount}
              </span>
            ) : null}
          </button>
        </div>
        <a href="/register" className="text-xs text-slate-500 hover:text-slate-900">
          Clear all
        </a>
      </div>

      {open ? (
        <div className="card-body grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Field label="Vendor">
            <select name="vendorId" defaultValue={value(params, "vendorId")} className="input">
              <option value="">Any</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>

          {instances.length ? (
            <Field label="Instance">
              <select name="instanceId" defaultValue={value(params, "instanceId")} className="input">
                <option value="">Any</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Account status">
            <select name="accountStatus" defaultValue={value(params, "accountStatus")} className="input">
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
              <option value="REMOVED">Removed</option>
            </select>
          </Field>

          <Field label="Flag">
            <select name="flag" defaultValue={value(params, "flag")} className="input">
              <option value="">Any</option>
              {Object.entries(FLAG_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Person status">
            <select name="employeeStatus" defaultValue={value(params, "employeeStatus")} className="input">
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="LEFT">Left</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </Field>

          <Field label="Person type">
            <select name="personType" defaultValue={value(params, "personType")} className="input">
              <option value="">Any</option>
              <option value="EMPLOYEE">Employee</option>
              <option value="CONTRACTOR">Contractor</option>
              <option value="PARTNER">Partner</option>
              <option value="SERVICE_ACCOUNT">Service account</option>
            </select>
          </Field>

          <Field label="Role contains">
            <input name="role" defaultValue={value(params, "role")} className="input" />
          </Field>

          <Field label="Department contains">
            <input name="department" defaultValue={value(params, "department")} className="input" />
          </Field>

          <Field
            label="Last login field"
            hint="Blank means outstanding work; N/A means the vendor will never provide it."
          >
            <select name="lastLoginState" defaultValue={value(params, "lastLoginState")} className="input">
              <option value="">Any</option>
              <option value="CAPTURED">Captured</option>
              <option value="BLANK">Blank – not yet captured</option>
              <option value="NOT_EXPOSED">N/A – not exposed</option>
            </select>
          </Field>

          <Field label="Password expiry field">
            <select
              name="passwordExpiryState"
              defaultValue={value(params, "passwordExpiryState")}
              className="input"
            >
              <option value="">Any</option>
              <option value="CAPTURED">Captured</option>
              <option value="BLANK">Blank – not yet captured</option>
              <option value="NOT_EXPOSED">N/A – not exposed</option>
            </select>
          </Field>

          <Field label="Last login from">
            <input type="date" name="lastLoginFrom" defaultValue={value(params, "lastLoginFrom")} className="input" />
          </Field>
          <Field label="Last login to">
            <input type="date" name="lastLoginTo" defaultValue={value(params, "lastLoginTo")} className="input" />
          </Field>

          <Field label="Account expiry from">
            <input
              type="date"
              name="accountExpiryFrom"
              defaultValue={value(params, "accountExpiryFrom")}
              className="input"
            />
          </Field>
          <Field label="Account expiry to">
            <input
              type="date"
              name="accountExpiryTo"
              defaultValue={value(params, "accountExpiryTo")}
              className="input"
            />
          </Field>

          <Field label="Source">
            <select name="source" defaultValue={value(params, "source")} className="input">
              <option value="">Any</option>
              <option value="CSV_EXPORT">CSV export</option>
              <option value="API">API</option>
              <option value="MANUAL_READ">Manual read</option>
            </select>
          </Field>

          <Field label="Matching">
            <select name="unmatched" defaultValue={value(params, "unmatched")} className="input">
              <option value="">Any</option>
              <option value="1">Unmatched to a person only</option>
            </select>
          </Field>

          <Field label="Rows per page">
            <select name="pageSize" defaultValue={value(params, "pageSize") || "50"} className="input">
              {["25", "50", "100", "250", "500"].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>

          {/* Preserve the current sort when the filter form is submitted. */}
          <input type="hidden" name="sort" value={value(params, "sort")} />
          <input type="hidden" name="dir" value={value(params, "dir")} />

          <div className="flex items-end gap-2 md:col-span-3 lg:col-span-4">
            <button type="submit" className="btn-primary">
              Apply filters
            </button>
            <a href="/register" className="btn-secondary">
              Reset
            </a>
            {values(params, "flag").length > 0 ? (
              <span className="self-center text-xs text-slate-500">
                Filtering on flag: {FLAG_LABELS[value(params, "flag") as keyof typeof FLAG_LABELS]}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-tight text-slate-400">{hint}</p> : null}
    </div>
  );
}
