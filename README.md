# Third-Party Access Register

A centralised, auditable register of every user account across all WOSG third-party systems.
It answers, at any moment: **who has access to what, at what level, since when, when they last
used it, and whether they should still have it.**

The register is **manually owned**. Data arrives by per-vendor CSV export and manual entry, not
live sync. The app's job is to make that manual process fast, consistent and evidenced.

### Where things are written down

| Document | What it is for |
|---|---|
| **This README** | The spec of record: what was asked for, what got built, the decisions behind it, and how to run and deploy it. |
| [`docs/requirements.md`](./docs/requirements.md) | The **original brief, verbatim and frozen**. Never edited to match the build — it is what the build is checked against. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to work on it, and the invariants not to break. |
| [`CLAUDE.md`](./CLAUDE.md) | The same invariants, aimed at an AI agent working in this repo. |
| **User guide** (in the app, `/guide`) | End-user documentation, served from `src/content/user-guide.ts`. Kept in step with the app by tests. |

**Jump to:** [Running it](#running-it) · [Requirements traceability](#requirements-traceability) ·
[What is pending](#what-is-pending) · [Decisions](#the-decisions-that-matter) ·
[Architecture](#how-it-is-put-together) · [Deploying](#deploying-to-render)

---

## Running it

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy
npm run db:seed               # demo vendors, people and users
npm run dev                   # http://localhost:3000
```

Seeded sign-ins (password `Password123!` for all three):

| Email | Role |
|---|---|
| `admin@wosg.example` | Admin |
| `owner@wosg.example` | Vendor owner (owns Adyen and Jira) |
| `auditor@wosg.example` | Auditor — read-only |

Sample vendor exports to import are in [`sample-data/`](./sample-data).

### Tests

```bash
createdb access_register_test
DATABASE_URL="postgresql://…/access_register_test" npx prisma migrate deploy
npm test
```

The suite runs against a real PostgreSQL database — the append-only trigger and the transactional
import cannot be meaningfully tested against a mock. It points at `access_register_test` by
default (override with `TEST_DATABASE_URL`) and truncates every table between tests, so it will
never touch your working data.

---

## Requirements traceability

Every clause of [the brief](./docs/requirements.md), what happened to it, and where to look.
✅ built · 🟡 partial · ⬜ not built — see [What is pending](#what-is-pending) for each gap.

### Functional requirements

| § | Requirement | Status | Where |
|---|---|---|---|
| 1 | Admin / Vendor owner / Auditor roles, RBAC throughout | ✅ | `lib/auth/policy.ts` (pure, unit-tested), enforced by `lib/auth/guards.ts` in every action and route |
| 1 | Vendor owner restricted to their own vendors, except read-only aggregates *(configurable)* | ✅ | `vendorScope()` vs `aggregateScope()`; the toggle is the `vendorOwnerAggregateAccess` setting on Admin |
| 1 | SSO via Microsoft Entra (OIDC) | ⬜ | Local login is the fallback the brief permits for MVP. Session layer is already provider-agnostic |
| 2 | Data model — Vendor, VendorInstance, Person, AccessRecord, ImportBatch, ColumnMapping, ReviewCycle/Item, AuditEvent | ✅ | `prisma/schema.prisma` — every field in the brief is present, plus the additions noted below |
| 3.1 | Vendor & instance CRUD, capture method, exposed-field flags, owner | ✅ | `/vendors`, `actions/vendors.ts` |
| 3.2 | AccessRecord CRUD + manual single entry | ✅ | `/register`, `/register/new`, `actions/records.ts` |
| 3.2 | Filter and sort on **every** field; saved views | ✅ | `lib/register-query.ts`, shared verbatim with the exports so a download always matches the screen |
| 3.2 | "N/A – not exposed" as a state distinct from blank, visible and filterable | ✅ | `FieldState` column beside each optional date; see [the decision](#blank-and-na--not-exposed-are-different-things) |
| 3.3 | One Person per human; cross-vendor view of their whole footprint | ✅ | `/people/[id]` — queries by `personId` with no vendor filter |
| 3.3 | Manual merge and split of Persons | ✅ | `mergePeople()` / `splitAccountFromPerson()` in `actions/people.ts`; merges tombstone rather than delete |
| 3.4 | Import: upload → saved mapping → staging → **diff preview** (new / changed / disappeared) → commit | ✅ | `lib/import/{parse,normalise,stage,commit}.ts`, `/import` |
| 3.4 | Imports idempotent — re-importing the same file changes nothing | ✅ | Acceptance test AC1 |
| 3.5 | Match by email first, fuzzy name as fallback; never silently guess | ✅ | `lib/matching.ts`. Fuzzy hits are suggestions with a score that a human accepts |
| 3.6 | HR reconciliation: import an active-employee list | ⬜ | Brief marks it later-phase. See [What is pending](#what-is-pending) |
| 3.6 | "Leavers with access" report | ✅ | Works off `employeeStatus`; the dashboard's headline figure and a register filter |
| 3.7 | `dormant` after N months (configurable, default 12) | ✅ | `lib/flags.ts`; N is the `dormantMonths` setting |
| 3.7 | Vendors not exposing last login → `unverifiable`, never `dormant` | ✅ | Acceptance test AC4 |
| 3.7 | Upcoming account/password expiry within a configurable window | ✅ | `expiringSoon` / `expired` flags; window is `expiryWindowDays` |
| 3.8 | Leaver workflow: every account as a checklist, evidence + timestamp, one report | ✅ | `lib/leaver.ts`, `/leavers`; acceptance test AC7 |
| 3.9 | Review cycles: open, assign per vendor owner, keep/downgrade/remove + notes, progress, exportable close | ✅ | `actions/reviews.ts`, `/reviews` |
| 3.9 | Challenge prompts — dormant, no justification, permission above role, never reviewed | ✅ | `lib/review-challenges.ts`, all four plus unverifiable and leaver |
| 3.10 | Append-only audit of every change; history per record and per person | ✅ | `lib/audit.ts`; immutability is [a database trigger](#the-audit-log-cannot-be-edited-even-from-psql), not a convention |
| 3.11 | Dashboard: per-vendor active/removed, dormant, unmatched, leavers, overdue review, upcoming expiries | ✅ | `/` — and now split into worklist vs assurance, with trends |
| 3.11 | Export any view to CSV/Excel | ✅ | `lib/export.ts`; every role including auditors |
| 3.12 | Notifications — review due, expiry approaching, new dormant accounts | ✅ | Later-phase in the brief, now built. See [Email notifications](#email-notifications). One deviation: the brief says dormant accounts are detected *on import*; detection is on the daily run instead, so an alert can lag an import by up to a day. Flags themselves update immediately |

### Non-functional requirements (§4)

| Requirement | Status | Notes |
|---|---|---|
| RBAC enforced **server-side** | ✅ | Every action and route handler starts at a guard. The UI only hides what the server would refuse anyway |
| SSO via Entra/OIDC, least privilege | 🟡 | Least privilege yes; Entra not built |
| Encrypted at rest and in transit | 🟡 | A deployment concern, met by the database and TLS termination rather than by application code |
| **Defined retention policy** | ⬜ | Not implemented and not currently defined. The audit trail and removed accounts grow without bound by design. See [What is pending](#what-is-pending) |
| Hosted in line with WOSG data policy | 🟡 | The database is an external EU-region Postgres; confirming that satisfies policy is a decision for WOSG, not code |
| Append-only audit log; no hard deletes | ✅ | Enforced by a Postgres trigger and by `accountStatus = REMOVED` respectively |
| Imports transactional (all-or-nothing per batch) | ✅ | One transaction per commit |
| Backups | ⬜ | A deployment setting on the database provider; not yet configured |
| Import diff-preview and cross-vendor view are the two screens that must be excellent | ✅ | Both got the most design attention |

### Acceptance criteria (§7)

Each has a test named after it in [`tests/acceptance.test.ts`](./tests/acceptance.test.ts).

| # | Criterion | Status | Where it is enforced |
|---|---|---|---|
| 1 | Importing a vendor CSV twice produces **zero** changes the second time | ✅ | `lib/import/commit.ts` — unchanged rows touch only `lastSeenInSource`, which is bookkeeping and is deliberately not audited |
| 2 | A disappeared account is surfaced and **never** auto-removed | ✅ | `DisappearedCandidate.confirmRemove` defaults to `false` and is never pre-ticked |
| 3 | Opening any Person shows **100%** of their accounts | ✅ | `/people/[id]` queries by `personId` with no vendor filter, and includes removed accounts |
| 4 | A vendor that doesn't expose `last_login` is `unverifiable`, never `dormant` | ✅ | `lib/flags.ts` — `NOT_EXPOSED` short-circuits the dormancy branch entirely |
| 5 | Every field change is retrievable with who/when/source | ✅ | `lib/audit.ts` writes one `AuditEvent` per changed field |
| 6 | An auditor can view and export everything and change nothing | ✅ | `lib/auth/policy.ts` `canWrite()`, enforced server-side by `requireWriter()` |
| 7 | A leaver produces one report of every account with action and evidence | ✅ | `lib/leaver.ts` `buildLeaverReport()` |

### Built beyond the brief

Added because the work called for it, not because it was asked for:

| Addition | Why |
|---|---|
| **Login lockout + per-IP rate limiting** | §4 asks for security but does not say how. Two different attacks needed two different controls — see [the decision](#login-is-rate-limited-two-ways-because-the-two-attacks-are-different) |
| **Strict per-request CSP + security headers** | Same clause. `src/middleware.ts` |
| **Bulk register actions** | Confirming or removing twenty rows one at a time is the difference between a review getting done and not |
| **Daily snapshots + trend chart** | §3.11 asks for a dashboard; without stored history it could only ever show *now*, never whether things were improving |
| **Per-vendor data freshness** | A register is only as current as its last upload, and nothing surfaced a vendor nobody had exported in six months |
| **In-app user guide** (`/guide`) | A standing request from the repo owner; kept in step with the app by `tests/user-guide.test.ts` |
| **Schema additions** | `VendorGrant` (a vendor can have more than one owner), `SavedView`, `LeaverCase`/`LeaverAction`/`EvidenceFile`, `DisappearedCandidate`, `StagedRow`, `AppSetting`, `LoginAttempt`, `NotificationLog`, `RegisterSnapshot`, and a `FieldState` column beside each optional date to make §3.2's N/A rule representable |

---

## What is pending

Everything not built, why, and what it would take. Nothing here is blocked by a decision
already made — each is simply not done yet.

| Item | Brief | Why not, and what it needs |
|---|---|---|
| **Microsoft Entra SSO** | §1, Phase 2 | Needs WOSG's own Azure tenant and an app registration, which only the customer can create. `createSession()` already takes a user and issues the cookie, so this is the OIDC code exchange and a callback route. Env scaffolding is in `.env.example` |
| **HR reconciliation import** | §3.6, Phase 2 | The biggest remaining *data-quality* gap. `hrReference` and the Left/Unknown statuses exist and the leavers report works off them, but employee status is set by hand — so the leaver flag is only as good as somebody remembering. Needs a bulk import of an HR active-employee list |
| **Defined retention policy** | §4 | Not defined, so not implemented. The audit trail and removed accounts grow without bound, which is currently the *safe* direction for an audit tool. Needs a policy decision from WOSG first, then a documented, audited expiry job |
| **Backup schedule** | §4 | A setting on the database provider rather than code. Not yet configured |
| **Vendor API pulls** | §3, Phase 3 | Explicitly a spot-check against the manual truth, not a live feed |
| **Alerting on repeated login lockouts** | — | The daily digest covers register conditions, not security events. Small to add now the email path exists |
| **Advanced dashboards** | Phase 3 | The trend chart and assurance split are a first cut; per-vendor trends and longer-range reporting would follow |

Phase status against §6: **MVP complete.** **Phase 2** is review cycles ✅ and notifications ✅,
with HR reconciliation ⬜ and Entra SSO ⬜ outstanding. **Phase 3** not started.

---

## Deploying to Render

The app runs on Render's free tier; the database is a free Postgres from Neon
or Supabase. One value to set by hand, once.

### 1. Create a free Postgres

At [neon.tech](https://neon.tech): sign up, create a project, pick an **EU
region** (the register holds UK staff names and email addresses). Copy the
connection string it shows you.

### 2. Point the app at it

In Render → the **access-register** service → **Environment** → add
`DATABASE_URL` and paste the string **exactly as given**. Then **Manual Deploy →
Deploy latest commit**.

Nothing to append. The app adds its own schema, connection limit and, when the
string is a pooled one, the pooler flag Prisma needs.

### 3. Sign in

`BOOTSTRAP_ADMIN_PASSWORD` must be **12 characters or more**, or the deploy
fails rather than coming up with no way in. Let Render generate it.

Open the service's **Environment** tab and copy:

- `BOOTSTRAP_ADMIN_PASSWORD` — for the admin account, whose address is
  `BOOTSTRAP_ADMIN_EMAIL`.
- `SEED_PASSWORD` — for the three demo accounts, if the demo data is on.

Render generates both and shows them nowhere else, so nothing sensitive is
committed here. Sign in at `https://<your-service>.onrender.com/login`.

### If you cannot sign in

The bootstrap creates the account named by `BOOTSTRAP_ADMIN_EMAIL` when it does
not exist, and otherwise **leaves it completely alone** — so a redeploy never
undoes a password changed inside the app. The consequence is that changing
`BOOTSTRAP_ADMIN_PASSWORD` after the account exists has no effect. The deploy log
says which happened:

```
[bootstrap] admin account created: someone@example.com
[bootstrap] admin account already present, password left alone: someone@example.com
```

Two ways back in, neither needing database access:

1. **From inside the app.** Sign in as any other admin and reset the password on
   the **Admin** page. With demo data loaded, `admin@wosg.example` and the
   `SEED_PASSWORD` value is a full admin.
2. **From the platform.** Set `BOOTSTRAP_ADMIN_FORCE_RESET` to `true`, set
   `BOOTSTRAP_ADMIN_PASSWORD` to what you want, deploy, sign in, then set it back
   to `false`. The log confirms with
   `admin password RESET from BOOTSTRAP_ADMIN_PASSWORD`.

### What happens on each deploy

`npm run start:render` runs [`scripts/bootstrap.mjs`](./scripts/bootstrap.mjs)
before the server accepts traffic. It composes the connection string, applies
pending migrations, ensures the named admin exists and is active, and loads the
demo data **only while the register is completely empty**.

It checks for that *named* account rather than "any admin at all", because once
demo data has created one, the person the deployment is actually for would never
get an account.

All of it is idempotent. Missing or unusable configuration fails the deploy with
a plain block naming the fix, rather than a stack trace or a green deploy nobody
can sign in to.

`/api/health` is the health check. It runs a query, because a web process that
cannot reach Postgres is not healthy in any useful sense.

### Why the database is not on Render

Render permits **one free-tier Postgres per account**, and on this account that
slot is taken. Three ways round it were tried:

| Attempt | Result |
|---|---|
| Declare a second database with `plan: free` | `cannot have more than one active free tier database` — failed the whole sync |
| `fromDatabase` pointing at the existing database | Does not resolve across Blueprints — `DATABASE_URL` stayed empty |
| Paste that database's Internal URL by hand | `P1001: Can't reach database server` — it is in a different region from the service, and internal hostnames only resolve within one region |

A service's region **cannot be changed after creation**, so the third is not
fixable by editing `render.yaml`. An external database sidesteps all of it: the
host is public, so region is a latency choice rather than a hard constraint.

To move the database onto Render later, add a `databases:` block on a paid plan
and point `DATABASE_URL` at it with `fromDatabase`. Nothing else changes.

### Connection string handling

[`src/lib/database-url.mjs`](./src/lib/database-url.mjs) composes the effective
URL, because a platform hands over a bare string with no room for parameters:

- **schema** — defaults to `access_register`, so every table this app owns,
  including Prisma's migration history, sits in its own namespace. Correct
  whether the database is dedicated or shared, and a shared one is cleaned up by
  dropping that single schema.
- **connection_limit** — defaults to 5, so the app cannot exhaust a small
  instance's connections.
- **pgbouncer** — added when the host carries a `-pooler` suffix, so Prisma stops
  caching prepared statements a transaction-mode pooler will not honour.

Migrations are separately routed to the **direct** endpoint, because Prisma
Migrate needs session state for advisory locks and DDL and cannot run through a
pooler. The running app keeps using whichever endpoint it was given.

Both parameters are applied only when the URL does not already specify them, so
a fully-qualified `DATABASE_URL` always wins. Composition is string-based rather
than by re-serialising a parsed URL, which would alter percent-encoding in the
password and break authentication.

### Before you put real data in

- Set `SEED_DEMO_DATA` to `false` and delete the demo vendors from the app.
  Everything seeded uses `@wosg.example` addresses, so it is easy to spot.
- **Leaver evidence uploads are lost on every deploy on the free web plan** —
  Render's free instances have ephemeral storage. Uncomment the `disk:` block in
  `render.yaml`, move to a paid instance type, and set `EVIDENCE_STORAGE_DIR`
  to `/var/data/evidence`.
- Free web services sleep when idle, so the first request after a quiet spell
  takes around 50 seconds. Neon's free tier also suspends when idle and takes a
  second or two to wake.
- Confirm the database's region is consistent with WOSG's data policy, and set a
  backup schedule.
- **Decide a retention policy.** §4 of the brief asks for one and there isn't
  one. The register holds staff names and email addresses, and the audit trail
  and removed accounts currently grow without bound — the safe direction for an
  audit tool, but a decision somebody has to actually take before real personal
  data goes in. See [What is pending](#what-is-pending).
- Run the daily job once (Admin → **Run daily job now**) so trend history starts
  accumulating. It cannot be backfilled, so every day it is not running is a day
  missing from the chart permanently.
- There is still no automated alert on repeated lockouts. An admin currently
  finds out by looking at the Admin screen's Sign-in column, not by being told.

---

## Email notifications

A daily digest emails each vendor owner about newly dormant accounts, leavers
who still have access, accounts expiring soon, and review cycles that are due
soon or overdue. Every condition is emailed once, the day it becomes true, not
every day it stays true — see `src/lib/notifications/digest.ts`.

This needs three things, all optional — without them the app runs exactly as
before and the Admin screen just shows the digest as not configured:

### 1. An email provider (Resend)

Sign up at [resend.com](https://resend.com) (free tier: 3,000 emails/month) and
create an API key. For real use, verify your own sending domain there too —
without a verified domain Resend's sandbox only delivers to the address you
signed up with.

Set on the Render service:

- `RESEND_API_KEY` — the API key
- `NOTIFICATIONS_FROM_EMAIL` — the address digests are sent from, e.g.
  `"Access Register <register@wosg.example>"`

### 2. Something to trigger it daily

The app is just a web service with no scheduler of its own, so
`.github/workflows/daily-digest.yml` calls `POST /api/cron/notifications` once
a day via a GitHub Actions schedule. It needs two **repository secrets**
(Settings → Secrets and variables → Actions on this repo):

- `APP_URL` — the deployed app's URL, e.g. `https://access-register.onrender.com`
- `CRON_SECRET` — any random string; the route only runs when the request's
  `Authorization: Bearer <value>` matches. `render.yaml` generates one on the
  service automatically — copy that value in from the Render dashboard's
  Environment tab.

### 3. Checking it actually works

Admin → **Daily job** has a **Run daily job now** button that does the identical
thing on demand — no need to wait for the schedule, or set up the GitHub Actions
secrets first. It records the snapshot whether or not email is configured, since
trend history cannot be caught up later.

---

## The decisions that matter

### The audit log cannot be edited, even from psql

`AuditEvent` immutability is not an application convention. The migration
`audit_event_append_only` installs a PostgreSQL trigger that raises on `UPDATE` and `DELETE`
against the table, for every connection:

```
ERROR:  AuditEvent is append-only: UPDATE is not permitted on this table
```

Application code therefore never needs to offer an edit path, and a mistake in application code
cannot quietly cost you the trail.

### Blank and "N/A – not exposed" are different things

A blank last-login means *nobody has captured it yet* — outstanding work. "N/A – not exposed"
means *this vendor will never give us this* — the work is impossible, not undone. Conflating them
is how a register quietly rots.

Each optional date field carries a companion `FieldState` column (`CAPTURED` / `BLANK` /
`NOT_EXPOSED`). The distinction is visible in the UI, filterable in the register, and carried
through to exports as literal text. It is also load-bearing for the dormancy rule: an account can
only be called dormant if we can actually see its last login.

### Nothing is guessed about who an account belongs to

On import, an exact match on primary or alternate email links the account to a person
automatically. A fuzzy name match is only ever a **suggestion**, shown with its similarity score,
that a human accepts. Anything else stays `unmatched` and is surfaced for follow-up. There is a
bulk "create people for N unmatched" action for the first import into an empty register, but it
is never the default.

### Imports are staged, previewed, then committed atomically

Uploading writes nothing to the register. Rows are normalised into `StagedRow` and diffed against
the live data into three buckets — **new**, **changed** (with exact field-level before/after) and
**disappeared**. Only a commit applies anything, and the commit runs inside one transaction: it
either all lands or none of it does.

An unmapped source column is not read as "cleared to blank". This is what makes a re-import of an
unchanged export a genuine no-op rather than a wave of spurious edits.

### Accounts are never hard-deleted

Removal is `accountStatus = REMOVED`. History is retained. Person merges tombstone the losing
record and point it at the survivor, so old links and audit rows still resolve.

### Login is rate-limited two ways, because the two attacks are different

Five wrong passwords locks an account for fifteen minutes — including against the *correct*
password, because a stolen-but-since-changed password must not walk straight past a lockout
that is already running. That stops someone brute-forcing one known email (typically an
admin's). Separately, sign-ins are rate-limited per client IP regardless of which account is
being tried, which is what stops someone spraying guesses across many emails from one machine —
per-account lockout alone would never trip if no single account gets more than a couple of
guesses. See `src/lib/auth/rate-limit.ts`.

An admin can see a lock (and how many failed attempts led to it) on the Admin screen, and clear
it with Unlock without touching the password. Resetting the password clears a lock at the same
time — a reset that left the old lockout standing would refuse the new password too. The same
rule applies to the platform-level recovery path in `scripts/bootstrap.mjs`
(`BOOTSTRAP_ADMIN_FORCE_RESET`): it clears the lock as part of resetting the password, since it
exists specifically to get the sole admin back in when there is nobody else to press Unlock.

### Every response carries a strict, per-request Content-Security-Policy

`src/middleware.ts` generates a fresh nonce on every request and forwards it to Next's own
inline bootstrap scripts, so `script-src` needs no `'unsafe-inline'` — anything an attacker
injects without the nonce is refused outright. `style-src` keeps `'unsafe-inline'` for two
`style={{ width }}` progress bars, which is a far smaller risk than a script and not worth
plumbing a nonce through client components for. The remaining security headers
(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Strict-Transport-Security`) don't vary per request, so they live as static config in
`next.config.ts` instead.

### Trends are measured daily, because derived state has no past

Flags are recomputed from scratch every time and never versioned, so "how many accounts were
dormant last month" is a question the register genuinely cannot answer from its own tables. The
daily job writes a `RegisterSnapshot` row of the headline counts, and the dashboard charts those.

The consequence is deliberate and stated on the chart itself: **history starts at the first run
and cannot be backfilled.** A day the job did not run has no row, and inventing one — by
interpolating, or by reconstructing it from the audit trail — would be fabricating a measurement
nobody took. The chart plots the days that exist and says so when there are fewer than two.

Snapshots are estate-wide, so the chart is only rendered for viewers whose aggregate scope is
unrestricted; a vendor owner limited to their own vendors gets the rest of the dashboard without
a trend covering vendors they cannot see.

### The email digest notifies once per condition, never once a day

Recalculating flags is idempotent by design — safe to run constantly — but a naive "email
everyone with an active flag" job would resend the same alert every single day for as long as the
condition holds, which trains vendor owners to ignore it. `NotificationLog` records `(entity,
condition)` pairs already alerted on; the digest only emails a pair with no row yet, and deletes
the row once the underlying flag or review state clears, so the same condition can fire again if
it recurs later. See `src/lib/notifications/digest.ts`.

---

## How it is put together

```
prisma/schema.prisma          the relational model
prisma/migrations/            includes the append-only trigger
src/lib/
  audit.ts                    the audit backbone — every mutation writes through here
  flags.ts                    dormant / unverifiable / expiry / review rule engine
  matching.ts                 email and fuzzy-name identity matching
  leaver.ts                   leaver cases and the leaver report
  canonical-fields.ts         the field vocabulary imports map onto
  register-query.ts           filter/sort for the register, shared with exports
  export.ts                   CSV and Excel generation
  auth/policy.ts              pure RBAC decisions (unit-tested)
  auth/guards.ts              server-side enforcement
  notifications/digest.ts     the daily email digest, and its notify-once logic
  notifications/email.ts      Resend API wrapper
  snapshots.ts                daily history of the headline counts, for trends
  freshness.ts                how stale a vendor's upload is, vs its review cycle
  import/
    parse.ts                  CSV/paste parsing and the messy-date reader
    normalise.ts              mapping application and validation
    stage.ts                  staging and the diff
    commit.ts                 the transactional commit
src/app/                      Next.js App Router pages and server actions
```

Stack: Next.js 15 (App Router, server components and server actions), TypeScript, Prisma,
PostgreSQL, Tailwind. RBAC is enforced server-side in every action and route handler — the UI only
hides what the server would refuse anyway.

---

## Known limitations

Distinct from [What is pending](#what-is-pending): these are properties of what *is* built.

- Evidence files are written to the local filesystem under `EVIDENCE_STORAGE_DIR`. For a real
  deployment point this at durable, encrypted, backed-up storage.
- Encryption at rest is a deployment concern, met by the database and disk configuration rather
  than by application code. Transport security likewise expects TLS termination in front of the app.
- `npm audit` reports advisories in build-time transitive dependencies (postcss, esbuild, sharp)
  pulled in by Next.js and Vitest. None are in the runtime path; they clear as those upstream
  packages update.
- Fuzzy name matching loads all people into memory to score a batch. That is fine for a register
  of this size and would need an index-backed approach at hundreds of thousands of people.
- Flag recalculation writes one row at a time rather than in bulk. Deliberate at the scale this
  register is sized for (low thousands of accounts); it would want batching well before ten
  thousand.
- Trend snapshots are estate-wide. There is no per-vendor trend, and adding one means a row per
  vendor per day for a breakdown nobody has yet asked to slice.
- Bulk register actions apply to the rows ticked on the page you are looking at, not to
  "everything matching the current filter" — which is the safer default, but means filtering
  down first on a large result set.
- On the free hosting tier the app sleeps when idle, so the first request after a quiet spell
  takes around 50 seconds. Fine for occasional use; visibly broken-looking to a first-time
  auditor. `~$7/month` removes it.
