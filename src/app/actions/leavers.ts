"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LeaverActionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireWriter } from "@/lib/auth/guards";
import { closeLeaverCase, openLeaverCase, recordLeaverAction } from "@/lib/leaver";

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVIDENCE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "message/rfc822",
]);

export async function startLeaverCase(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const personId = String(formData.get("personId") ?? "");
  const leaveDateRaw = String(formData.get("leaveDate") ?? "").trim();

  const leaverCase = await openLeaverCase({
    personId,
    user,
    notes: String(formData.get("notes") ?? "").trim(),
    leaveDate: leaveDateRaw ? new Date(`${leaveDateRaw}T00:00:00.000Z`) : null,
  });

  revalidatePath(`/people/${personId}`);
  redirect(`/leavers/${leaverCase.id}`);
}

export async function saveLeaverAction(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const actionId = String(formData.get("actionId") ?? "");
  const action = String(formData.get("action") ?? "PENDING") as LeaverActionType;
  const evidenceNote = String(formData.get("evidenceNote") ?? "").trim();

  await recordLeaverAction({ actionId, action, evidenceNote, user });

  // Optional evidence upload: a confirmation screenshot, an email, a ticket PDF.
  const file = formData.get("evidence");
  if (file instanceof File && file.size > 0) {
    await storeEvidence(actionId, file);
  }

  const caseId = String(formData.get("caseId") ?? "");
  revalidatePath(`/leavers/${caseId}`);
}

async function storeEvidence(leaverActionId: string, file: File): Promise<void> {
  if (file.size > MAX_EVIDENCE_BYTES) {
    throw new Error("Evidence files must be 10MB or smaller");
  }
  if (file.type && !ALLOWED_EVIDENCE.has(file.type)) {
    throw new Error(`Evidence files of type ${file.type} are not accepted`);
  }

  const root = process.env.EVIDENCE_STORAGE_DIR ?? "./storage/evidence";
  const directory = path.resolve(root, leaverActionId);
  await mkdir(directory, { recursive: true });

  // Store under a generated name so a hostile filename cannot escape the
  // directory or overwrite anything; the original name lives in the database.
  const storedName = `${randomUUID()}${path.extname(file.name).slice(0, 10)}`;
  await writeFile(path.join(directory, storedName), Buffer.from(await file.arrayBuffer()));

  await prisma.evidenceFile.create({
    data: {
      leaverActionId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      storagePath: path.join(leaverActionId, storedName),
    },
  });
}

export async function finishLeaverCase(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const caseId = String(formData.get("caseId") ?? "");

  await closeLeaverCase({ caseId, user });
  revalidatePath(`/leavers/${caseId}`);
}
