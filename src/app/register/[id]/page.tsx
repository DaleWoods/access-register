import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, toActor } from "@/lib/auth/guards";
import { canEditVendor, canViewVendor } from "@/lib/auth/policy";
import {
  Alert,
  Card,
  FlagList,
  PageHeader,
  ReadOnlyNotice,
  StatusBadge,
  formatDateTime,
} from "@/components/ui";
import { RecordForm } from "./record-form";
import { MatchPersonPanel } from "./match-person";
import { HistoryTable } from "@/components/history-table";

export const dynamic = "force-dynamic";

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const record = await prisma.accessRecord.findUnique({
    where: { id },
    include: {
      vendor: { include: { instances: { orderBy: { name: "asc" } } } },
      instance: true,
      person: true,
    },
  });
  if (!record) notFound();

  const actor = toActor(user);
  if (!canViewVendor(actor, record.vendorId)) notFound();
  const editable = canEditVendor(actor, record.vendorId);

  const [history, people, siblingAccounts] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { entityType: "AccessRecord", entityId: id },
      orderBy: { changedAt: "desc" },
      take: 200,
    }),
    prisma.person.findMany({
      where: { mergedIntoId: null },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, primaryEmail: true },
    }),
    record.personId
      ? prisma.accessRecord.findMany({
          where: { personId: record.personId, id: { not: id } },
          include: { vendor: { select: { name: true } } },
          orderBy: { vendor: { name: "asc" } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={record.rawUsername || record.rawEmail || "Account"}
        subtitle={
          <>
            <Link href={`/vendors/${record.vendorId}`} className="link">
              {record.vendor.name}
            </Link>
            {record.instance ? ` · ${record.instance.name}` : ""} ·{" "}
            {record.person ? (
              <Link href={`/people/${record.person.id}`} className="link">
                {record.person.fullName}
              </Link>
            ) : (
              "not matched to a person"
            )}
          </>
        }
        actions={
          <>
            <StatusBadge status={record.accountStatus} />
            <Link href="/register" className="btn-secondary">
              Back to register
            </Link>
          </>
        }
      />

      {!editable ? (
        <div className="mb-4">
          <ReadOnlyNotice />
        </div>
      ) : null}

      {record.flags.length ? (
        <div className="mb-4">
          <Card title="Flags">
            <div className="card-body">
              <FlagList flags={record.flags} />
            </div>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecordForm record={record} instances={record.vendor.instances} editable={editable} />
        </div>

        <div className="space-y-4">
          <Card title="Capture">
            <div className="card-body space-y-2 text-sm">
              <Row label="Source" value={record.source} />
              <Row label="First seen" value={formatDateTime(record.firstSeen)} />
              <Row
                label="Last seen in source"
                value={formatDateTime(record.lastSeenInSource) || "—"}
              />
              <Row
                label="Last confirmed by a human"
                value={formatDateTime(record.lastConfirmed) || "Never"}
              />
              <Row label="Match key" value={record.matchKey} mono />
            </div>
          </Card>

          <MatchPersonPanel
            recordId={record.id}
            person={record.person}
            people={people}
            editable={editable}
          />

          {siblingAccounts.length ? (
            <Card title="Same person, other systems">
              <div className="card-body space-y-1 text-sm">
                {siblingAccounts.map((sibling) => (
                  <div key={sibling.id} className="flex items-center justify-between gap-2">
                    <Link href={`/register/${sibling.id}`} className="link">
                      {sibling.vendor.name}
                    </Link>
                    <StatusBadge status={sibling.accountStatus} />
                  </div>
                ))}
                {record.personId ? (
                  <Link
                    href={`/people/${record.personId}`}
                    className="mt-2 block text-xs text-slate-500 hover:text-slate-900"
                  >
                    See this person's full footprint →
                  </Link>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <Card title={`History (${history.length})`}>
          {history.length === 0 ? (
            <div className="card-body">
              <Alert tone="info">No changes recorded against this account yet.</Alert>
            </div>
          ) : (
            <HistoryTable events={history} />
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}
