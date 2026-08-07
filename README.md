# Third-Party Access Register

A centralised, auditable register of every user account across all WOSG third-party systems.
It answers, at any moment: **who has access to what, at what level, since when, when they last
used it, and whether they should still have it.**

The register is **manually owned**. Data arrives by per-vendor CSV export and manual entry, not
live sync. The app's job is to make that manual process fast, consistent and evidenced.

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

## Acceptance criteria

Each criterion in section 7 of the requirements has a test named after it in
[`tests/acceptance.test.ts`](./tests/acceptance.test.ts).

| # | Criterion | Where it is enforced |
|---|---|---|
| 1 | Importing a vendor CSV twice produces **zero** changes the second time | `lib/import/commit.ts` — unchanged rows touch only `lastSeenInSource`, which is bookkeeping and is deliberately not audited |
| 2 | A disappeared account is surfaced and **never** auto-removed | `DisappearedCandidate.confirmRemove` defaults to `false` and is never pre-ticked |
| 3 | Opening any Person shows **100%** of their accounts | `/people/[id]` queries by `personId` with no vendor filter, and includes removed accounts |
| 4 | A vendor that doesn't expose `last_login` is `unverifiable`, never `dormant` | `lib/flags.ts` — `NOT_EXPOSED` short-circuits the dormancy branch entirely |
| 5 | Every field change is retrievable with who/when/source | `lib/audit.ts` writes one `AuditEvent` per changed field |
| 6 | An auditor can view and export everything and change nothing | `lib/auth/policy.ts` `canWrite()`, enforced server-side by `requireWriter()` |
| 7 | A leaver produces one report of every account with action and evidence | `lib/leaver.ts` `buildLeaverReport()` |

---

## Deploying to Render

This repository contains a [`render.yaml`](./render.yaml) Blueprint, so the
database and the web service are provisioned together from one file.

1. In Render: **New → Blueprint**, pick this repository, **Apply**.
2. Wait for the first deploy. It creates the Postgres instance, applies every
   migration, and creates an admin account.
3. Open the service's **Environment** tab and copy:
   - `BOOTSTRAP_ADMIN_PASSWORD` — the password for the admin account, whose
     email is whatever `BOOTSTRAP_ADMIN_EMAIL` is set to.
   - `SEED_PASSWORD` — the password for the three demo accounts, if you left
     the demo data switched on.
4. Sign in at `https://<your-service>.onrender.com/login`.

Render generates both passwords and shows them nowhere else, so nothing
sensitive is committed to this repository.

### What happens on each deploy

`npm run start:render` runs [`scripts/bootstrap.mjs`](./scripts/bootstrap.mjs)
before the server accepts traffic. It applies pending migrations, ensures an
active admin exists, and loads the demo data **only while the register is
completely empty**. All of it is idempotent, so a restart or redeploy never
reseeds and never resets a password.

`/api/health` is the health check. It runs a query, because a web process that
cannot reach Postgres is not healthy in any useful sense.

### Before you put real data in

- Set `SEED_DEMO_DATA` to `false` and delete the demo vendors from the app.
  Everything seeded uses `@wosg.example` addresses, so it is easy to spot.
- **Leaver evidence uploads are lost on every deploy on the free plan.** Render's
  free instances have ephemeral storage. Uncomment the `disk:` block in
  `render.yaml`, move to a paid instance type, and set `EVIDENCE_STORAGE_DIR`
  to `/var/data/evidence`.
- Render's free Postgres expires after 30 days and free web services sleep when
  idle. Neither is suitable for a register anyone depends on.
- The login form has no rate limiting or lockout. That is acceptable behind
  Entra SSO, which is the phase-2 plan; it is worth adding before this is
  internet-facing with local passwords and real data in it.
- The register holds personal data. Confirm the region in `render.yaml`
  (`frankfurt` by default) is consistent with WOSG's data policy before loading
  anything real, and set a backup schedule on the database.

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

## What is built, and what is not

**Built (the MVP in section 6, plus review cycles):**
vendors and instances · AccessRecord CRUD and manual entry · CSV import with saved mappings and
diff preview · person layer with the cross-vendor view, manual matching, merge and split ·
dormant/unverifiable/expiry flagging · leaver workflow with evidence upload and report ·
append-only audit log · auditor read-only role · CSV and Excel export of any view · dashboard ·
saved views · review cycles with challenge prompts and progress tracking.

**Not built — deliberately, these are later phases in the requirements:**

- **Microsoft Entra SSO.** Local login is the MVP fallback the requirements allow. The session
  layer is already identity-provider agnostic: `createSession()` takes a user and issues the
  cookie, so adding Entra means implementing the OIDC code exchange and calling it. The env
  scaffolding is in `.env.example`.
- **HR reconciliation.** The `hrReference` field and the `Left`/`Unknown` employee statuses are
  in place, and the leavers-with-access report already works off them. What is missing is the
  bulk import of an HR active-employee list to set those statuses automatically.
- **Notifications** (review-due reminders, expiry warnings). Everything they would report on is
  computed and visible in the app; only the sending is absent.
- **Vendor API pulls** — phase 3, and explicitly a spot-check against the manual truth rather
  than a live feed.

### Known limitations

- Evidence files are written to the local filesystem under `EVIDENCE_STORAGE_DIR`. For a real
  deployment point this at durable, encrypted, backed-up storage.
- Encryption at rest is a deployment concern, met by the database and disk configuration rather
  than by application code. Transport security likewise expects TLS termination in front of the app.
- `npm audit` reports advisories in build-time transitive dependencies (postcss, esbuild, sharp)
  pulled in by Next.js and Vitest. None are in the runtime path; they clear as those upstream
  packages update.
- Fuzzy name matching loads all people into memory to score a batch. That is fine for a register
  of this size and would need an index-backed approach at hundreds of thousands of people.
