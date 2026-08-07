import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, type SessionUser } from "@/lib/auth/session";
import {
  canEditVendor,
  canViewVendor,
  canWrite,
  isAdmin,
  type Actor,
} from "@/lib/auth/policy";

/**
 * Server-side enforcement. Every page, server action and route handler that
 * touches data starts here — RBAC is never left to the UI.
 */

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type CurrentUser = SessionUser & { vendorIds: string[] };

/** Resolve the signed-in user plus the vendors they may act on. */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;

  if (session.role !== "VENDOR_OWNER") {
    return { ...session, vendorIds: [] };
  }

  const [owned, granted] = await Promise.all([
    prisma.vendor.findMany({ where: { ownerUserId: session.id }, select: { id: true } }),
    prisma.vendorGrant.findMany({ where: { userId: session.id }, select: { vendorId: true } }),
  ]);

  const vendorIds = [
    ...new Set([...owned.map((v) => v.id), ...granted.map((g) => g.vendorId)]),
  ];
  return { ...session, vendorIds };
}

/** For pages: bounce to login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdmin(user.role)) throw new ForbiddenError("Admin role required");
  return user;
}

/** Any mutating action must call this. Auditors are rejected here. */
export async function requireWriter(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canWrite(user.role)) {
    throw new ForbiddenError("Your role is read-only");
  }
  return user;
}

export function toActor(user: CurrentUser): Actor {
  return { id: user.id, role: user.role, vendorIds: user.vendorIds };
}

export async function requireVendorView(vendorId: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canViewVendor(toActor(user), vendorId)) {
    throw new ForbiddenError("You do not have access to this vendor");
  }
  return user;
}

export async function requireVendorEdit(vendorId: string): Promise<CurrentUser> {
  const user = await requireWriter();
  if (!canEditVendor(toActor(user), vendorId)) {
    throw new ForbiddenError("You do not have edit access to this vendor");
  }
  return user;
}

/** Edit rights on an existing account row, resolved via its vendor. */
export async function requireRecordEdit(
  accessRecordId: string,
): Promise<{ user: CurrentUser; vendorId: string }> {
  const record = await prisma.accessRecord.findUnique({
    where: { id: accessRecordId },
    select: { vendorId: true },
  });
  if (!record) throw new ForbiddenError("Record not found");
  const user = await requireVendorEdit(record.vendorId);
  return { user, vendorId: record.vendorId };
}
