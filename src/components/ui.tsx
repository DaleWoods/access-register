import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountStatus, FieldState } from "@prisma/client";
import { FLAG_DESCRIPTIONS, FLAG_LABELS, type FlagKey } from "@/lib/flags";

/** Shared presentation pieces. Kept deliberately small and plain. */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-500">{children}</p>;
}

const STATUS_STYLES: Record<AccountStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DISABLED: "bg-amber-100 text-amber-800",
  REMOVED: "bg-slate-200 text-slate-600",
};

const STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: "Active",
  DISABLED: "Disabled",
  REMOVED: "Removed",
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

const FLAG_STYLES: Partial<Record<FlagKey, string>> = {
  leaver_with_access: "bg-red-100 text-red-800",
  dormant: "bg-orange-100 text-orange-800",
  expired: "bg-red-100 text-red-800",
  expiring_soon: "bg-amber-100 text-amber-800",
  unverifiable: "bg-slate-200 text-slate-700",
  unmatched: "bg-violet-100 text-violet-800",
  last_login_missing: "bg-amber-50 text-amber-700",
  no_justification: "bg-sky-100 text-sky-800",
  never_reviewed: "bg-sky-100 text-sky-800",
  review_overdue: "bg-amber-100 text-amber-800",
};

export function FlagBadge({ flag }: { flag: string }) {
  const key = flag as FlagKey;
  return (
    <span
      className={`badge ${FLAG_STYLES[key] ?? "bg-slate-100 text-slate-700"}`}
      title={FLAG_DESCRIPTIONS[key] ?? flag}
    >
      {FLAG_LABELS[key] ?? flag}
    </span>
  );
}

export function FlagList({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <FlagBadge key={flag} flag={flag} />
      ))}
    </div>
  );
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Renders a field that may be genuinely absent.
 *
 * Three outcomes, and the difference is the point:
 *   value        -> the data
 *   N/A          -> the vendor does not expose this; it will never exist
 *   Not captured -> outstanding work
 */
export function StatefulValue({
  value,
  state,
  format = "date",
}: {
  value: Date | string | null;
  state: FieldState;
  format?: "date" | "datetime";
}) {
  if (state === "NOT_EXPOSED") {
    return (
      <span className="na-cell" title="This vendor does not expose this field">
        N/A – not exposed
      </span>
    );
  }
  if (value) {
    return <span>{format === "date" ? formatDate(value) : formatDateTime(value)}</span>;
  }
  return (
    <span className="blank-cell" title="Not yet captured — outstanding work">
      Not captured
    </span>
  );
}

export function Stat({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const tones = {
    default: "text-slate-900",
    warn: "text-amber-600",
    danger: "text-red-600",
    good: "text-emerald-600",
  };
  const body = (
    <>
      <div className={`text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card block px-4 py-3 transition hover:border-slate-400">
        {body}
      </Link>
    );
  }
  return <div className="card px-4 py-3">{body}</div>;
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

/** Shown when a signed-in user reaches a page their role does not cover. */
export function AccessDenied({ need }: { need: string }) {
  return (
    <div className="mx-auto mt-12 max-w-lg">
      <Card title="Not permitted">
        <div className="card-body space-y-3 text-sm">
          <p className="text-slate-600">
            This page needs the {need} role. Your account does not have it, so there is nothing to
            show here.
          </p>
          <Link href="/" className="btn-secondary">
            Back to dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function ReadOnlyNotice() {
  return (
    <Alert tone="info" title="Read-only">
      Your role is auditor. You can view and export everything here, and change nothing.
    </Alert>
  );
}
