"use client";

import { useActionState, useState } from "react";
import { CANONICAL_FIELDS } from "@/lib/canonical-fields";
import { inspectUpload, stageUpload, type UploadState } from "@/app/actions/imports";
import { Card } from "@/components/ui";

type Vendor = {
  id: string;
  name: string;
  exposesLastLogin: boolean;
  exposesPasswordExpiry: boolean;
  instances: { id: string; name: string }[];
  columnMappings: { id: string; name: string; mapping: unknown; isDefault: boolean }[];
};

/**
 * Two-step wizard: choose the vendor and the data, then confirm the column
 * mapping. The saved mapping for a vendor is applied automatically, so a
 * routine monthly import is upload-then-review.
 */
export function ImportWizard({ vendors }: { vendors: Vendor[] }) {
  const [state, formAction] = useActionState<UploadState, FormData>(inspectUpload, {});
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");

  const vendor = vendors.find((v) => v.id === (state.vendorId ?? vendorId)) ?? vendors[0];

  if (state.headers?.length) {
    return <MappingStep state={state} vendor={vendor} />;
  }

  return (
    <Card title="1. Choose the vendor and the data">
      <form action={formAction} className="card-body grid gap-4 md:grid-cols-2">
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
          {vendor?.columnMappings.length ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Saved mapping available: {vendor.columnMappings[0].name}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              No saved mapping yet — you will map the columns on the next step.
            </p>
          )}
        </div>

        <div>
          <label className="label">Instance</label>
          <select name="instanceId" className="input" disabled={!vendor?.instances.length}>
            <option value="">
              {vendor?.instances.length ? "None — vendor-wide" : "This vendor has no instances"}
            </option>
            {vendor?.instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Imports are scoped to the instance you pick, so one portal&apos;s export never marks
            another portal&apos;s accounts as disappeared.
          </p>
        </div>

        <div className="md:col-span-2">
          <label className="label">CSV file</label>
          <input type="file" name="file" accept=".csv,.tsv,.txt,text/csv" className="input" />
        </div>

        <div className="md:col-span-2">
          <label className="label">Or paste tabular data</label>
          <textarea
            name="pasted"
            rows={6}
            className="input font-mono text-xs"
            placeholder="Paste straight from a spreadsheet — commas or tabs both work. First row must be the column headers."
          />
        </div>

        {state.error ? (
          <p className="md:col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}

        <div className="md:col-span-2">
          <button type="submit" className="btn-primary">
            Read columns
          </button>
        </div>
      </form>
    </Card>
  );
}

function MappingStep({ state, vendor }: { state: UploadState; vendor: Vendor }) {
  const saved = vendor?.columnMappings.find((m) => m.isDefault) ?? vendor?.columnMappings[0];
  const savedMapping = (saved?.mapping ?? {}) as Record<string, string>;

  // A saved mapping wins over the header-name guess; the guess only fills gaps.
  const initial: Record<string, string> = {};
  for (const header of state.headers ?? []) {
    initial[header] = savedMapping[header] ?? state.suggestions?.[header] ?? "";
  }

  const [mapping, setMapping] = useState(initial);

  const used = Object.values(mapping).filter(Boolean);
  const duplicates = used.filter((v, i) => used.indexOf(v) !== i);
  const hasIdentity = used.includes("rawUsername") || used.includes("rawEmail");

  return (
    <Card
      title={`2. Map the columns — ${state.filename} (${state.rowCount} rows)`}
      actions={
        saved ? (
          <span className="text-xs text-slate-500">
            Pre-filled from saved mapping &ldquo;{saved.name}&rdquo;
          </span>
        ) : null
      }
    >
      <form action={stageUpload} className="card-body space-y-4">
        <input type="hidden" name="vendorId" value={state.vendorId ?? ""} />
        <input type="hidden" name="instanceId" value={state.instanceId ?? ""} />
        <input type="hidden" name="filename" value={state.filename ?? ""} />
        <input type="hidden" name="text" value={state.text ?? ""} />

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Source column</th>
                <th>Sample values</th>
                <th className="w-72">Maps to</th>
              </tr>
            </thead>
            <tbody>
              {(state.headers ?? []).map((header) => (
                <tr key={header}>
                  <td className="font-mono text-xs font-medium">{header}</td>
                  <td className="text-xs text-slate-500">
                    {(state.sample ?? [])
                      .map((row) => row[header])
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(" · ") || <span className="italic">empty</span>}
                  </td>
                  <td>
                    <select
                      name={`map:${header}`}
                      value={mapping[header] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [header]: e.target.value }))
                      }
                      className="input"
                    >
                      <option value="">Ignore this column</option>
                      {CANONICAL_FIELDS.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {duplicates.length ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Each canonical field can only be mapped once. Fix the duplicated mapping before
            continuing.
          </p>
        ) : null}

        {!hasIdentity ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Map at least one identity column — username or email — so rows can be matched to
            existing accounts.
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
          <div>
            <label className="label">Save this mapping for reuse</label>
            <input
              name="saveMappingAs"
              defaultValue={saved?.name ?? `${vendor?.name ?? "Vendor"} export`}
              className="input w-72"
              placeholder="Leave blank to use once without saving"
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={duplicates.length > 0 || !hasIdentity}
          >
            Stage and preview changes
          </button>
          <a href="/import" className="btn-secondary">
            Start again
          </a>
        </div>

        <p className="text-xs text-slate-500">
          Staging writes nothing to the register. You will see exactly what is new, what changed
          and what disappeared before deciding whether to commit.
        </p>
      </form>
    </Card>
  );
}
