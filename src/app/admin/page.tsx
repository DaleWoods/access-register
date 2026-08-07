import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { getSettings } from "@/lib/settings";
import { ROLE_LABELS, isAdmin } from "@/lib/auth/policy";
import { AccessDenied, Alert, Card, PageHeader, formatDateTime } from "@/components/ui";
import { createAppUser, resetUserPassword, saveAppSettings, setUserRole, toggleUserActive } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
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
                        <div className="flex gap-1">
                          <form action={toggleUserActive}>
                            <input type="hidden" name="userId" value={user.id} />
                            <button type="submit" className="btn-secondary btn-sm">
                              {user.isActive ? "Disable" : "Enable"}
                            </button>
                          </form>
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
                  ))}
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
