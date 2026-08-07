import type { AuditEvent, ChangeSource } from "@prisma/client";
import { formatDateTime } from "@/components/ui";

/**
 * Renders an append-only audit trail: who changed what, when, and via which
 * process. Field names are translated into the language the UI uses.
 */

const FIELD_LABELS: Record<string, string> = {
  rawUsername: "Username",
  rawEmail: "Email",
  role: "Role",
  permissionLevel: "Permission level",
  accountStatus: "Account status",
  accountCreated: "Account created",
  accountExpiry: "Account expiry",
  passwordExpiry: "Password expiry",
  lastLogin: "Last login",
  accountCreatedState: "Account created — field state",
  accountExpiryState: "Account expiry — field state",
  passwordExpiryState: "Password expiry — field state",
  lastLoginState: "Last login — field state",
  justification: "Justification",
  personId: "Linked person",
  instanceId: "Vendor instance",
  lastConfirmed: "Last confirmed",
  employeeStatus: "Employee status",
  leaver_action: "Leaver action",
};

const SOURCE_LABELS: Record<ChangeSource, string> = {
  MANUAL: "Manual edit",
  IMPORT: "Import",
  LEAVER_PROCESS: "Leaver process",
  REVIEW: "Review",
  SYSTEM: "System",
};

const SOURCE_STYLES: Record<ChangeSource, string> = {
  MANUAL: "bg-sky-100 text-sky-800",
  IMPORT: "bg-violet-100 text-violet-800",
  LEAVER_PROCESS: "bg-red-100 text-red-800",
  REVIEW: "bg-emerald-100 text-emerald-800",
  SYSTEM: "bg-slate-200 text-slate-700",
};

export function HistoryTable({
  events,
  showEntity = false,
}: {
  events: AuditEvent[];
  showEntity?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            {showEntity ? <th>Entity</th> : null}
            <th>Field</th>
            <th>From</th>
            <th>To</th>
            <th>Who</th>
            <th>Via</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="whitespace-nowrap text-xs text-slate-600">
                {formatDateTime(event.changedAt)}
              </td>
              {showEntity ? (
                <td className="whitespace-nowrap text-xs">
                  {event.entityType}
                  <div className="font-mono text-[10px] text-slate-400">
                    {event.entityId.slice(0, 8)}
                  </div>
                </td>
              ) : null}
              <td className="whitespace-nowrap">
                {event.field ? (
                  FIELD_LABELS[event.field] ?? event.field
                ) : (
                  <span className="text-slate-500 italic">record event</span>
                )}
              </td>
              <td className="max-w-[18rem] break-words text-slate-500">{event.oldValue ?? "—"}</td>
              <td className="max-w-[18rem] break-words font-medium">{event.newValue ?? "—"}</td>
              <td className="whitespace-nowrap text-xs">{event.changedByLabel}</td>
              <td>
                <span className={`badge ${SOURCE_STYLES[event.changeSource]}`}>
                  {SOURCE_LABELS[event.changeSource]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
