import { prisma } from "@/lib/db";
import { requireWriter, toActor } from "@/lib/auth/guards";
import { vendorScope } from "@/lib/auth/policy";
import { Card, PageHeader } from "@/components/ui";
import { createRecord } from "@/app/actions/records";
import { NewRecordForm } from "./new-record-form";

export const dynamic = "force-dynamic";

/** Manual single-entry, for vendors that offer no export at all. */
export default async function NewRecordPage() {
  const user = await requireWriter();
  const scope = vendorScope(toActor(user));

  const [vendors, people] = await Promise.all([
    prisma.vendor.findMany({
      where: { isArchived: false, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        exposesLastLogin: true,
        exposesPasswordExpiry: true,
        exposesAccountExpiry: true,
        exposesAccountCreated: true,
        instances: { where: { isArchived: false }, select: { id: true, name: true } },
      },
    }),
    prisma.person.findMany({
      where: { mergedIntoId: null },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, primaryEmail: true },
    }),
  ]);

  if (vendors.length === 0) {
    return (
      <>
        <PageHeader title="Add account" />
        <Card>
          <p className="card-body text-sm text-slate-600">
            There are no vendors you can add accounts to yet.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Add account"
        subtitle="Manual entry for vendors with no export, or for an account spotted outside an import."
      />
      <form action={createRecord}>
        <NewRecordForm vendors={vendors} people={people} />
      </form>
    </>
  );
}
