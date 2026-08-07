import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { canWrite } from "@/lib/auth/policy";
import { buildLeaverReport } from "@/lib/leaver";
import { Alert, Card, PageHeader, Stat, StatusBadge, formatDateTime } from "@/components/ui";
import { finishLeaverCase, saveLeaverAction } from "@/app/actions/leavers";

export const dynamic = "force-dynamic";

const ACTION_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  REMOVED: "bg-emerald-100 text-emerald-800",
  RETAINED: "bg-sky-100 text-sky-800",
  NOT_APPLICABLE: "bg-slate-200 text-slate-600",
};

/**
 * The leaver checklist. One row per account across every vendor, each needing
 * an action and an evidence note. Completing it produces the single report
 * that proves the leaver was dealt with.
 */
export default async function LeaverCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const user = await requireUser();

  const leaverCase = await prisma.leaverCase.findUnique({
    where: { id: caseId },
    include: {
      person: true,
      openedBy: true,
      actions: {
        include: {
          accessRecord: { include: { vendor: true, instance: true } },
          actionedBy: true,
          evidence: true,
        },
        orderBy: [{ action: "asc" }, { accessRecord: { vendor: { name: "asc" } } }],
      },
    },
  });
  if (!leaverCase) notFound();

  const report = await buildLeaverReport(caseId);
  const editable = canWrite(user.role) && leaverCase.status === "OPEN";
  const done = leaverCase.actions.length - report.outstanding;

  return (
    <>
      <PageHeader
        title={`Leaver case — ${leaverCase.person.fullName}`}
        subtitle={
          <>
            Opened {formatDateTime(leaverCase.openedAt)}
            {leaverCase.openedBy ? ` by ${leaverCase.openedBy.fullName}` : ""}
            {leaverCase.notes ? ` · ${leaverCase.notes}` : ""}
          </>
        }
        actions={
          <>
            <Link href={`/people/${leaverCase.personId}`} className="btn-secondary">
              View person
            </Link>
            <a className="btn-secondary" href={`/api/export/leaver?caseId=${caseId}&format=csv`}>
              Export report CSV
            </a>
            <a className="btn-secondary" href={`/api/export/leaver?caseId=${caseId}&format=xlsx`}>
              Export report Excel
            </a>
          </>
        }
      />

      {leaverCase.status === "CLOSED" ? (
        <div className="mb-4">
          <Alert tone="success" title="Case closed">
            Closed {formatDateTime(leaverCase.closedAt)}. Every account was actioned and evidenced.
            This page is the audit record.
          </Alert>
        </div>
      ) : report.outstanding === 0 ? (
        <div className="mb-4">
          <Alert tone="success" title="Ready to close">
            Every account has an action recorded. Close the case to finalise the report.
          </Alert>
        </div>
      ) : (
        <div className="mb-4">
          <Alert tone="warn" title={`${report.outstanding} account(s) still to action`}>
            Work down the list. Each row needs an action and, ideally, an evidence reference such
            as a change number or a confirmation screenshot.
          </Alert>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accounts in scope" value={leaverCase.actions.length} />
        <Stat label="Actioned" value={done} tone={done ? "good" : "default"} />
        <Stat
          label="Outstanding"
          value={report.outstanding}
          tone={report.outstanding ? "danger" : "good"}
        />
        <Stat
          label="Evidence files"
          value={leaverCase.actions.reduce((n, a) => n + a.evidence.length, 0)}
        />
      </div>

      <div className="space-y-3">
        {leaverCase.actions.map((action) => (
          <Card key={action.id}>
            <div className="card-header">
              <div>
                <h3 className="text-sm font-semibold">
                  {action.accessRecord.vendor.name}
                  {action.accessRecord.instance ? ` — ${action.accessRecord.instance.name}` : ""}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  <Link href={`/register/${action.accessRecordId}`} className="link font-mono">
                    {action.accessRecord.rawUsername || action.accessRecord.rawEmail}
                  </Link>
                  {action.accessRecord.role ? ` · ${action.accessRecord.role}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={action.accessRecord.accountStatus} />
                <span className={`badge ${ACTION_STYLES[action.action]}`}>
                  {action.action.replace("_", " ").toLowerCase()}
                </span>
              </div>
            </div>

            <div className="card-body">
              {action.actionedAt ? (
                <p className="mb-3 text-xs text-slate-500">
                  {action.action.replace("_", " ").toLowerCase()} by{" "}
                  {action.actionedBy?.fullName ?? "unknown"} on {formatDateTime(action.actionedAt)}
                  {action.evidenceNote ? ` — ${action.evidenceNote}` : ""}
                </p>
              ) : null}

              {action.evidence.length ? (
                <ul className="mb-3 space-y-0.5 text-xs text-slate-600">
                  {action.evidence.map((file) => (
                    <li key={file.id}>
                      Evidence: {file.filename} ({Math.ceil(file.sizeBytes / 1024)}KB, uploaded{" "}
                      {formatDateTime(file.uploadedAt)})
                    </li>
                  ))}
                </ul>
              ) : null}

              {editable ? (
                <form action={saveLeaverAction} className="grid gap-3 md:grid-cols-4">
                  <input type="hidden" name="actionId" value={action.id} />
                  <input type="hidden" name="caseId" value={caseId} />

                  <div>
                    <label className="label">Action</label>
                    <select name="action" defaultValue={action.action} className="input">
                      <option value="PENDING">Not yet actioned</option>
                      <option value="REMOVED">Removed</option>
                      <option value="RETAINED">Retained — justified</option>
                      <option value="NOT_APPLICABLE">Not applicable</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="label">Evidence note</label>
                    <input
                      name="evidenceNote"
                      defaultValue={action.evidenceNote}
                      className="input"
                      placeholder="Confirmation reference, ticket number, who confirmed it"
                    />
                  </div>

                  <div>
                    <label className="label">Evidence file</label>
                    <input type="file" name="evidence" className="input" />
                  </div>

                  <div className="md:col-span-4">
                    <button type="submit" className="btn-primary btn-sm">
                      Save
                    </button>
                    <span className="ml-3 text-xs text-slate-500">
                      Choosing &ldquo;Removed&rdquo; also sets the account to Removed in the
                      register and writes it to history.
                    </span>
                  </div>
                </form>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {editable && report.outstanding === 0 ? (
        <Card className="mt-4">
          <form action={finishLeaverCase} className="card-body">
            <input type="hidden" name="caseId" value={caseId} />
            <button type="submit" className="btn-primary">
              Close this case
            </button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
