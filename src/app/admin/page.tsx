import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { getSettings } from "@/lib/settings";
import { ROLE_LABELS, isAdmin } from "@/lib/auth/policy";
import { AccessDenied, Alert, Card, PageHeader, formatDateTime } from "@/components/ui";
import { SavedNotice } from "@/components/saved-notice";
import {
  createAppUser,
  resetUserPassword,
  runDailyJobNow,
  saveAppSettings,
  setUserRole,
  toggleUserActive,
  unlockAccount,
} from "@/app/actions/admin";
import { accountLockState } from "@/lib/auth/rate-limit";
import { emailConfigured } from "@/lib/notifications/email";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireUser();
  // A page-level refusal reads better than an exception. The server actions on
  // this page enforce the same rule again with requireAdmin.
  if (!isAdmin(user.role)) return <AccessDenied need="Admin" />;

  const [users, settings, vendors] = await Promise.all([
    prisma.appUser.findMany({
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
      include: { _count: { select: { ownedVendors: true } } },
    }),
    getSettings(),
    prisma.vendor.count(),
  ]);

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="App users, roles and the rule-engine settings."
      />

      <SavedNotice searchParams={params}>Settings saved.</SavedNotice>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card title={`App users (${users.length})`} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Vendors owned</th>
                    <th>Created</th>
                    <th>Sign-in</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const lock = accountLockState(user.lockedUntil);
                    return (
                    <tr key={user.id} className={user.isActive ? "" : "opacity-50"}>
                      <td className="font-medium">
                        {user.fullName}
                        {!user.isActive ? (
                          <span className="ml-2 badge bg-slate-200 text-slate-600">disabled</span>
                        ) : null}
                      </td>
                      <td className="font-mono text-xs">{user.email}</td>
                      <td>
                        <form action={setUserRole} className="flex items-center gap-1">
                          <input type="hidden" name="userId" value={user.id} />
                          <select name="role" defaultValue={user.role} className="input h-8 py-0 text-xs">
                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn-secondary btn-sm">
                            Set
                          </button>
                        </form>
                      </td>
                      <td className="tabular-nums">{user._count.ownedVendors}</td>
                      <td className="text-xs">{formatDateTime(user.createdAt)}</td>
                      <td>
                        {lock.locked ? (
                          <span
                            className="badge bg-red-100 text-red-800"
                            title={`${user.failedLoginAttempts} failed attempts`}
                          >
                            Locked ({lock.retryAfterMinutes}m)
                          </span>
                        ) : user.failedLoginAttempts > 0 ? (
                          <span className="text-xs text-amber-600">
                            {user.failedLoginAttempts} failed attempt
                            {user.failedLoginAttempts === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <form action={toggleUserActive}>
                            <input type="hidden" name="userId" value={user.id} />
                            <button type="submit" className="btn-secondary btn-sm">
                              {user.isActive ? "Disable" : "Enable"}
                            </button>
                          </form>
                          {lock.locked ? (
                            <form action={unlockAccount}>
                              <input type="hidden" name="userId" value={user.id} />
                              <button type="submit" className="btn-secondary btn-sm">
                                Unlock
                              </button>
                            </form>
                          ) : null}
                          <form action={resetUserPassword} className="flex gap-1">
                            <input type="hidden" name="userId" value={user.id} />
                            <input
                              name="password"
                              type="password"
                              placeholder="New password"
                              className="input h-8 w-32 py-0 text-xs"
                            />
                            <button type="submit" className="btn-secondary btn-sm">
                              Reset
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Rule engine settings">
            <form action={saveAppSettings} className="card-body grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Dormancy threshold (months)</label>
                <input
                  type="number"
                  name="dormantMonths"
                  min={1}
                  max={60}
                  defaultValue={settings.dormantMonths}
                  className="input"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  An account whose last login is older than this is flagged dormant. Accounts whose
                  vendor does not expose last login are flagged unverifiable instead — never
                  dormant.
                </p>
              </div>

              <div>
                <label className="label">Expiry warning window (days)</label>
                <input
                  type="number"
                  name="expiryWindowDays"
                  min={1}
                  max={365}
                  defaultValue={settings.expiryWindowDays}
                  className="input"
                />
              </div>

              <div>
                <label className="label">Fuzzy name match threshold</label>
                <input
                  type="number"
                  name="fuzzyMatchThreshold"
                  min={0.5}
                  max={1}
                  step={0.01}
                  defaultValue={settings.fuzzyMatchThreshold}
                  className="input"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Name matches below this score are not even suggested. Suggestions always need a
                  human to accept them.
                </p>
              </div>

              <div>
                <label className="label">Vendor owner aggregate access</label>
                <select
                  name="vendorOwnerAggregateAccess"
                  defaultValue={settings.vendorOwnerAggregateAccess ? "1" : "0"}
                  className="input"
                >
                  <option value="1">Vendor owners see whole-estate aggregates (read-only)</option>
                  <option value="0">Vendor owners see only their own vendors</option>
                </select>
              </div>

              <div>
                <label className="label">Review "due soon" window (days)</label>
                <input
                  type="number"
                  name="reviewDueSoonDays"
                  min={1}
                  max={90}
                  defaultValue={settings.reviewDueSoonDays}
                  className="input"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  The daily email digest warns a vendor owner once a review cycle's due date falls
                  inside this window, and again if it goes overdue.
                </p>
              </div>

              <div className="md:col-span-2">
                <button type="submit" className="btn-primary">
                  Save settings
                </button>
                <span className="ml-3 text-xs text-slate-500">
                  Saving recalculates every flag across all {vendors} vendors.
                </span>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Daily job">
            <div className="card-body space-y-3">
              {emailConfigured() ? (
                <p className="text-xs text-emerald-700">Email configured — sending via Resend.</p>
              ) : (
                <p className="text-xs text-amber-700">
                  Email not configured. Set <code>RESEND_API_KEY</code> and{" "}
                  <code>NOTIFICATIONS_FROM_EMAIL</code> to enable the digest. Snapshots are
                  recorded either way.
                </p>
              )}

              {params.digestSent === "1" ? (
                <Alert tone="success">
                  Snapshot recorded. Sent {params.emails ?? 0} email(s) ({params.errors ?? 0}{" "}
                  failed) — {params.records ?? 0} new account alert(s), {params.cycles ?? 0} review
                  reminder(s).
                </Alert>
              ) : null}
              {params.snapshotOnly === "1" ? (
                <Alert tone="success">
                  Snapshot recorded. No email sent — the digest is not configured.
                </Alert>
              ) : null}

              <p className="text-xs text-slate-500">
                Once a day, a GitHub Actions schedule records a snapshot of the register&apos;s
                headline counts and emails each vendor owner about anything new — dormant accounts,
                leavers who still have access, accounts expiring soon, reviews due or overdue. Each
                condition is emailed once, not every day it stays true.
              </p>
              <p className="text-xs text-slate-500">
                This button runs the same job now. Snapshots cannot be backfilled, so the dashboard
                trend only covers days the job has actually run.
              </p>

              <form action={runDailyJobNow}>
                <button type="submit" className="btn-secondary btn-sm">
                  Run daily job now
                </button>
              </form>
            </div>
          </Card>

          <Card title="Add an app user">
            <form action={createAppUser} className="card-body space-y-3">
              <div>
                <label className="label">Full name</label>
                <input name="fullName" className="input" required />
              </div>
              <div>
                <label className="label">Email</label>
                <input name="email" type="email" className="input" required />
              </div>
              <div>
                <label className="label">Role</label>
                <select name="role" className="input" defaultValue="AUDITOR">
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Initial password</label>
                <input name="password" type="password" className="input" required minLength={12} />
                <p className="mt-1 text-[11px] text-slate-400">At least 12 characters.</p>
              </div>
              <button type="submit" className="btn-primary w-full">
                Create user
              </button>
            </form>
          </Card>

          <Alert tone="info" title="Single sign-on">
            Local accounts are the MVP fallback. Microsoft Entra (OIDC) is a phase-2 item — the
            session layer is already provider-agnostic, so adding it means implementing the code
            exchange in <code className="text-xs">src/lib/auth/entra.ts</code> and calling the
            existing <code className="text-xs">createSession</code>.
          </Alert>
        </div>
      </div>
    </>
  );
}
