"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";

/** Saved views are per-user, and any user (auditors included) may keep them. */
export async function saveView(formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the view a name" };

  const query = String(formData.get("query") ?? "");
  const shared = formData.get("shared") === "1";

  try {
    await prisma.savedView.upsert({
      where: {
        ownerUserId_entity_name: { ownerUserId: user.id, entity: "accessRecord", name },
      },
      create: {
        name,
        entity: "accessRecord",
        ownerUserId: user.id,
        scope: shared ? "SHARED" : "PERSONAL",
        query,
      },
      update: { query, scope: shared ? "SHARED" : "PERSONAL" },
    });
  } catch {
    return { error: "Could not save that view" };
  }

  revalidatePath("/register");
  return {};
}

export async function deleteView(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  // Users can only remove their own saved views.
  await prisma.savedView.deleteMany({ where: { id, ownerUserId: user.id } });
  revalidatePath("/register");
}
