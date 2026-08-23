"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { bulkConfirmRecords, bulkRemoveRecords } from "@/app/actions/records";
import { SORTABLE_COLUMNS, withParam, type SearchParams } from "@/lib/register-query";
import { FlagList, StatefulValue, StatusBadge, formatDate } from "@/components/ui";
import type { AccountStatus, FieldState } from "@prisma/client";

/**
 * The register table plus row selection. Selection drives three bulk actions:
 * confirm, remove and export — each one operating on exactly the rows ticked,
 * never on "everything matching the current filter" by surprise.
 */

type Record_ = {
  id: string;
  vendor: { id: string; name: string };
  instance: { id: string; name: string } | null;
  person: { id: string; fullName: string; employeeStatus: string } | null;
  rawUsername: string;
  rawEmail: string;
  role: string;
  permissionLevel: string;
  accountStatus: AccountStatus;
  lastLogin: Date | null;
  lastLoginState: FieldState;
  accountExpiry: Date | null;
  accountExpiryState: FieldState;
  passwordExpiry: Date | null;
  passwordExpiryState: FieldState;
  lastConfirmed: Date | null;
  flags: string[];
};

const VISIBLE_COLUMNS = [
  "vendor",
  "person",
  "rawUsername",
  "rawEmail",
  "role",
  "accountStatus",
  "lastLogin",
  "accountExpiry",
  "passwordExpiry",
  "lastConfirmed",
];

export function RegisterTable({
  records,
  params,
  sort,
  dir,
  qs,
  canWrite,
}: {
  records: Record_[];
  params: SearchParams;
  sort: string;
  dir: "asc" | "desc";
  qs: string;
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allOnPageSelected = records.length > 0 && records.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (allOnPageSelected) return new Set();
      return new Set(records.map((r) => r.id));
    });
  }

  const exportHref = useMemo(() => {
    const search = new URLSearchParams();
    for (const id of selected) search.append("id", id);
    return (format: "csv" | "xlsx") => `/api/export/register?format=${format}&${search.toString()}`;
  }, [selected]);

  if (records.length === 0) {
    return <p className="p-6 text-sm text-slate-500">No accounts match these filters.</p>;
  }

  return (
    <form>
      <input type="hidden" name="qs" value={qs} />

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm">
          <span className="font-medium text-amber-900">
            {selected.size} row{selected.size === 1 ? "" : "s"} selected
          </span>
          <a className="btn-secondary btn-sm" href={exportHref("csv")}>
            Export selected (CSV)
          </a>
          <a className="btn-secondary btn-sm" href={exportHref("xlsx")}>
            Export selected (Excel)
          </a>
          {canWrite ? (
            <>
              <button type="submit" formAction={bulkConfirmRecords} className="btn-secondary btn-sm">
                Confirm selected
              </button>
              <button
                type="submit"
                formAction={bulkRemoveRecords}
                className="btn-secondary btn-sm border-red-300 text-red-700 hover:border-red-500"
                onClick={(e) => {
                  if (
                    !window.confirm(
                      `Mark ${selected.size} account${selected.size === 1 ? "" : "s"} as removed? This does not delete history — it can be seen again in the audit trail.`,
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                Remove selected
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="text-xs text-amber-800 underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                  aria-label="Select all rows on this page"
                />
              </th>
              {SORTABLE_COLUMNS.filter((c) => VISIBLE_COLUMNS.includes(c.key)).map((column) => {
                const active = sort === column.key;
                const nextDir = active && dir === "asc" ? "desc" : "asc";
                return (
                  <th key={column.key}>
                    <Link
                      href={`/register${withParam({ ...params, dir: nextDir }, "sort", column.key)}`}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      {column.label}
                      {active ? <span>{dir === "asc" ? "▲" : "▼"}</span> : null}
                    </Link>
                  </th>
                );
              })}
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} className={selected.has(record.id) ? "bg-amber-50/60" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    name="id"
                    value={record.id}
                    checked={selected.has(record.id)}
                    onChange={() => toggle(record.id)}
                    aria-label={`Select ${record.rawUsername || record.rawEmail || record.id}`}
                  />
                </td>
                <td>
                  <Link href={`/register/${record.id}`} className="link font-medium">
                    {record.vendor.name}
                  </Link>
                  {record.instance ? (
                    <div className="text-xs text-slate-500">{record.instance.name}</div>
                  ) : null}
                </td>
                <td>
                  {record.person ? (
                    <Link href={`/people/${record.person.id}`} className="link">
                      {record.person.fullName}
                    </Link>
                  ) : (
                    <span className="badge bg-violet-100 text-violet-800">Unmatched</span>
                  )}
                </td>
                <td className="font-mono text-xs">{record.rawUsername || "—"}</td>
                <td className="font-mono text-xs">{record.rawEmail || "—"}</td>
                <td>
                  {record.role || "—"}
                  {record.permissionLevel ? (
                    <div className="text-xs text-slate-500">{record.permissionLevel}</div>
                  ) : null}
                </td>
                <td>
                  <StatusBadge status={record.accountStatus} />
                </td>
                <td className="whitespace-nowrap">
                  <StatefulValue value={record.lastLogin} state={record.lastLoginState} />
                </td>
                <td className="whitespace-nowrap">
                  <StatefulValue value={record.accountExpiry} state={record.accountExpiryState} />
                </td>
                <td className="whitespace-nowrap">
                  <StatefulValue value={record.passwordExpiry} state={record.passwordExpiryState} />
                </td>
                <td className="whitespace-nowrap text-xs text-slate-600">
                  {formatDate(record.lastConfirmed) || <span className="blank-cell">Never</span>}
                </td>
                <td>
                  <FlagList flags={record.flags} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
