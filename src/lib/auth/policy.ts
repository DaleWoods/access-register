import type { AppRole } from "@prisma/client";

/**
 * Pure authorisation decisions. No database, no cookies — so the rules can be
 * unit-tested directly, and every server-side guard funnels through the same
 * logic rather than re-deriving it.
 */

export type Actor = {
  id: string;
  role: AppRole;
  /** Vendors this user owns or has been granted. Empty for admins/auditors. */
  vendorIds: string[];
};

/** Auditors are read-only everywhere. This is the load-bearing rule for sign-off. */
export function canWrite(role: AppRole): boolean {
  return role === "ADMIN" || role === "VENDOR_OWNER";
}

export function isAdmin(role: AppRole): boolean {
  return role === "ADMIN";
}

export function canExport(): boolean {
  // Every role, including auditors, may export. That is the point of the role.
  return true;
}

/** Read access to one vendor's accounts. */
export function canViewVendor(actor: Actor, vendorId: string): boolean {
  if (actor.role === "ADMIN" || actor.role === "AUDITOR") return true;
  return actor.vendorIds.includes(vendorId);
}

/** Write access to one vendor's accounts, imports and reviews. */
export function canEditVendor(actor: Actor, vendorId: string): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "AUDITOR") return false;
  return actor.vendorIds.includes(vendorId);
}

/**
 * Vendor scope for list queries. `null` means "no restriction".
 * Vendor owners are restricted to their own vendors on record-level screens.
 */
export function vendorScope(actor: Actor): string[] | null {
  if (actor.role === "ADMIN" || actor.role === "AUDITOR") return null;
  return actor.vendorIds;
}

/**
 * Aggregate reports (dashboard counts, cross-vendor person view) can optionally
 * show a vendor owner the whole estate read-only. Controlled by the
 * `vendorOwnerAggregateAccess` app setting; when off, aggregates are scoped the
 * same way record screens are.
 */
export function aggregateScope(actor: Actor, aggregateAccessEnabled: boolean): string[] | null {
  if (actor.role === "ADMIN" || actor.role === "AUDITOR") return null;
  return aggregateAccessEnabled ? null : actor.vendorIds;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Admin",
  VENDOR_OWNER: "Vendor owner",
  AUDITOR: "Auditor (read-only)",
};
