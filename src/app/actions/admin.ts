"use server";

import { revalidatePath } from "next/cache";
import type { AppRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/session";
import { actorFrom, newCorrelationId, recordCreate, recordDiff, recordEvent } from "@/lib/audit";
import { saveSettings } from "@/lib/settings";
import { refreshAllFlags } from "@/lib/flags";

/** Admin-only user and settings management. Changes are audited like any other. */

const MIN_PASSWORD_LENGTH = 12;

export async function createAppUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const context = { actor: actorFrom(admin), source: "MANUAL" as const, correlationId: newCorrelationId() };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const role = String(formData.get("role") ?? "AUDITOR") as AppRole;
  const password = String(formData.get("password") ?? "");

  if (!email || !fullName) throw new Error("Name and email are required");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const user = await prisma.appUser.create({
    data: { email, fullName, role, passwordHash: await hashPassword(password) },
  });

  await recordCreate({
    entityType: "AppUser",
    entityId: user.id,
    context,
    summary: `app user created: ${fullName} <${email}> as ${role}`,
  });
  revalidatePath("/admin");
}

export async function setUserRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const context = { actor: actorFrom(admin), source: "MANUAL" as const, correlationId: newCorrelationId() };

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;

  const before = await prisma.appUser.findUniqueOrThrow({ where: { id: userId } });

  // Never let the last admin demote themselves out of the system.
  if (before.role === "ADMIN" && role !== "ADMIN") {
    const admins = await prisma.appUser.count({ where: { role: "ADMIN", isActive: true } });
    if (admins <= 1) throw new Error("There must be at least one active admin");
  }

  const after = await prisma.appUser.update({ where: { id: userId }, data: { role } });
  await recordDiff({
    entityType: "AppUser",
    entityId: userId,
    context,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    fields: ["role"],
  });
  revalidatePath("/admin");
}

export async function toggleUserActive(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const context = { actor: actorFrom(admin), source: "MANUAL" as const, correlationId: newCorrelationId() };

  const userId = String(formData.get("userId") ?? "");
  const before = await prisma.appUser.findUniqueOrThrow({ where: { id: userId } });

  if (before.isActive && before.role === "ADMIN") {
    const admins = await prisma.appUser.count({ where: { role: "ADMIN", isActive: true } });
    if (admins <= 1) throw new Error("There must be at least one active admin");
  }

  const after = await prisma.appUser.update({
    where: { id: userId },
    data: { isActive: !before.isActive },
  });
  await recordDiff({
    entityType: "AppUser",
    entityId: userId,
    context,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    fields: ["isActive"],
  });
  revalidatePath("/admin");
}

export async function resetUserPassword(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const context = { actor: actorFrom(admin), source: "MANUAL" as const, correlationId: newCorrelationId() };

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  await prisma.appUser.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });

  // The event records that a reset happened; the value itself is never logged.
  await recordEvent({
    entityType: "AppUser",
    entityId: userId,
    context,
    field: "passwordHash",
    newValue: "password reset by an administrator",
  });
  revalidatePath("/admin");
}

export async function saveAppSettings(formData: FormData): Promise<void> {
  await requireAdmin();

  await saveSettings({
    dormantMonths: Math.max(1, Number.parseInt(String(formData.get("dormantMonths") ?? "12"), 10) || 12),
    expiryWindowDays: Math.max(
      1,
      Number.parseInt(String(formData.get("expiryWindowDays") ?? "30"), 10) || 30,
    ),
    fuzzyMatchThreshold: Math.min(
      1,
      Math.max(0.5, Number.parseFloat(String(formData.get("fuzzyMatchThreshold") ?? "0.86")) || 0.86),
    ),
    vendorOwnerAggregateAccess: String(formData.get("vendorOwnerAggregateAccess")) === "1",
  });

  // Thresholds changed, so every derived flag needs recomputing.
  await refreshAllFlags();

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/register");
}
