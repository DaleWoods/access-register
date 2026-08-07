"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireVendorEdit } from "@/lib/auth/guards";
import { stageImport } from "@/lib/import/stage";
import { commitImport, discardBatch } from "@/lib/import/commit";
import { validateMapping } from "@/lib/import/normalise";
import { parseTable } from "@/lib/import/parse";
import { suggestCanonicalKey } from "@/lib/canonical-fields";

/**
 * Server actions for the import wizard: read the file's headers, stage a batch
 * with a mapping, adjust the staged decisions, then commit or discard.
 */

export type UploadState = {
  error?: string;
  headers?: string[];
  sample?: Record<string, string>[];
  suggestions?: Record<string, string>;
  text?: string;
  filename?: string;
  vendorId?: string;
  instanceId?: string;
  rowCount?: number;
};

async function readPayload(formData: FormData): Promise<{ text: string; filename: string }> {
  const pasted = String(formData.get("pasted") ?? "").trim();
  if (pasted) return { text: pasted, filename: "pasted-data" };

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    return { text: await file.text(), filename: file.name };
  }
  return { text: "", filename: "" };
}

/** Step 1: read the headers so the user can map them. */
export async function inspectUpload(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!vendorId) return { error: "Choose a vendor" };
  await requireVendorEdit(vendorId);

  const { text, filename } = await readPayload(formData);
  if (!text) return { error: "Upload a CSV file or paste some tabular data" };

  const table = parseTable(text);
  if (!table.headers.length) {
    return { error: table.errors[0] ?? "Could not read any columns from that data" };
  }
  if (!table.rows.length) return { error: "That file has headers but no data rows" };

  const suggestions: Record<string, string> = {};
  const taken = new Set<string>();
  for (const header of table.headers) {
    const suggestion = suggestCanonicalKey(header);
    // Never suggest the same canonical field twice; the first header wins.
    if (suggestion && !taken.has(suggestion)) {
      suggestions[header] = suggestion;
      taken.add(suggestion);
    }
  }

  return {
    headers: table.headers,
    sample: table.rows.slice(0, 5),
    suggestions,
    text,
    filename,
    vendorId,
    instanceId: String(formData.get("instanceId") ?? ""),
    rowCount: table.rows.length,
  };
}

/** Step 2: stage the import against the register, producing the diff preview. */
export async function stageUpload(formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendorId") ?? "");
  const user = await requireVendorEdit(vendorId);

  const text = String(formData.get("text") ?? "");
  const filename = String(formData.get("filename") ?? "upload.csv");
  const instanceId = String(formData.get("instanceId") ?? "") || null;

  const mapping: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("map:")) continue;
    const canonical = String(value);
    if (canonical) mapping[key.slice(4)] = canonical;
  }

  const errors = validateMapping(mapping);
  if (errors.length) throw new Error(errors.join(" "));

  let mappingId: string | null = null;
  const saveAs = String(formData.get("saveMappingAs") ?? "").trim();
  if (saveAs) {
    const saved = await prisma.columnMapping.upsert({
      where: { vendorId_name: { vendorId, name: saveAs } },
      create: { vendorId, name: saveAs, mapping, isDefault: true },
      update: { mapping },
    });
    mappingId = saved.id;
    // Only one default per vendor.
    await prisma.columnMapping.updateMany({
      where: { vendorId, id: { not: saved.id } },
      data: { isDefault: false },
    });
  }

  const result = await stageImport({
    vendorId,
    instanceId,
    sourceFilename: filename,
    text,
    mapping,
    mappingId,
    userId: user.id,
  });

  if (!result.ok) throw new Error(result.errors.join(" "));
  redirect(`/import/${result.batchId}`);
}

/** Toggle a per-row decision in the staging area. */
export async function updateStagedRow(formData: FormData): Promise<void> {
  const rowId = String(formData.get("rowId") ?? "");
  const row = await prisma.stagedRow.findUniqueOrThrow({
    where: { id: rowId },
    include: { batch: true },
  });
  await requireVendorEdit(row.batch.vendorId);

  const action = String(formData.get("action") ?? "");
  const data: Record<string, unknown> = {};

  if (action === "acceptSuggestion") data.decidedPersonId = row.suggestedPersonId;
  else if (action === "createPerson") {
    data.createPerson = true;
    data.decidedPersonId = null;
  } else if (action === "clearPerson") {
    data.decidedPersonId = null;
    data.createPerson = false;
  } else if (action === "setPerson") {
    data.decidedPersonId = String(formData.get("personId") ?? "") || null;
    data.createPerson = false;
  } else if (action === "toggleSkip") data.skip = !row.skip;

  await prisma.stagedRow.update({ where: { id: rowId }, data });
  revalidatePath(`/import/${row.batchId}`);
}

/** Bulk decisions across the whole staged batch. */
export async function bulkStagedDecision(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "");
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  await requireVendorEdit(batch.vendorId);

  const action = String(formData.get("action") ?? "");

  if (action === "createAllUnmatched") {
    await prisma.stagedRow.updateMany({
      where: { batchId, decidedPersonId: null, diff: { not: "INVALID" }, skip: false },
      data: { createPerson: true },
    });
  } else if (action === "clearAllCreates") {
    await prisma.stagedRow.updateMany({ where: { batchId }, data: { createPerson: false } });
  } else if (action === "acceptAllSuggestions") {
    const rows = await prisma.stagedRow.findMany({
      where: { batchId, decidedPersonId: null, suggestedPersonId: { not: null } },
      select: { id: true, suggestedPersonId: true },
    });
    for (const row of rows) {
      await prisma.stagedRow.update({
        where: { id: row.id },
        data: { decidedPersonId: row.suggestedPersonId, createPerson: false },
      });
    }
  } else if (action === "confirmAllRemovals") {
    await prisma.disappearedCandidate.updateMany({ where: { batchId }, data: { confirmRemove: true } });
  } else if (action === "clearAllRemovals") {
    await prisma.disappearedCandidate.updateMany({ where: { batchId }, data: { confirmRemove: false } });
  }

  revalidatePath(`/import/${batchId}`);
}

export async function toggleDisappeared(formData: FormData): Promise<void> {
  const candidateId = String(formData.get("candidateId") ?? "");
  const candidate = await prisma.disappearedCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    include: { batch: true },
  });
  await requireVendorEdit(candidate.batch.vendorId);

  await prisma.disappearedCandidate.update({
    where: { id: candidateId },
    data: { confirmRemove: !candidate.confirmRemove },
  });
  revalidatePath(`/import/${candidate.batchId}`);
}

export async function commitStagedBatch(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "");
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const user = await requireVendorEdit(batch.vendorId);

  await commitImport({ batchId, user });

  revalidatePath("/register");
  revalidatePath("/");
  redirect(`/import/${batchId}`);
}

export async function discardStagedBatch(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "");
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  await requireVendorEdit(batch.vendorId);

  await discardBatch(batchId);
  redirect("/import");
}
