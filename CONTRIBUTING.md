# Working on the register

## The user guide is part of the app, not an afterthought

There is a **User guide** tab in the app, served from
[`src/content/user-guide.ts`](./src/content/user-guide.ts). It is the only
documentation most users will ever read.

**A user-facing change is not finished until the guide is updated with it.**
That includes:

- a new screen or navigation entry
- a new or renamed flag, role, field or status
- a change to how a workflow behaves — import, leaver, review, matching
- a new setting, or a changed default
- anything a user could be surprised by

When you touch the guide, bump `GUIDE_UPDATED` to today's date. The page shows
it, so a reader can tell whether the guide predates the behaviour they are
looking at.

### What is enforced automatically

`npm test` fails if the guide falls behind the app in ways a machine can see:

| Check | Fails when |
|---|---|
| Navigation coverage | A nav entry has no section listing it in `covers`. The failure names the missing route. |
| Flag descriptions | A flag exists with no description — it would render in the guide with a blank meaning. |
| Role coverage | A role in `ROLE_LABELS` is not mentioned in the roles section. |
| Load-bearing rules | The guide stops explaining "N/A – not exposed", dormant vs unverifiable, or disappeared accounts. |
| Structure | Duplicate anchor ids, or a section with no title, summary or body. |

### What is derived, so it cannot drift at all

Some of the guide is not written down twice. The page renders it from the same
constants the rest of the app uses:

- the **flag glossary** comes from `FLAG_LABELS` and `FLAG_DESCRIPTIONS` in
  [`src/lib/flags.ts`](./src/lib/flags.ts)
- the **role names** come from `ROLE_LABELS` in
  [`src/lib/auth/policy.ts`](./src/lib/auth/policy.ts)
- the **configured thresholds** shown in the flags section are read live from
  app settings

Add a flag with a description and it appears in the guide by itself. Prefer
extending these over adding prose that repeats them.

### What a machine cannot check

Tests catch structural drift, not staleness of meaning. If you change what a
screen *does* without adding a route or a flag, only you can catch that. Reread
the section covering the screen you changed before opening the pull request.

---

## Before pushing

```bash
npm run typecheck
npm test          # needs the test database, see README
npm run build
```

Tests run against a real PostgreSQL database because the append-only audit
trigger and the transactional import cannot be meaningfully tested against a
mock. They point at `access_register_test` and truncate every table between
tests, so they will never touch working data.

## Things to hold firm on

These are the parts of the design that the acceptance criteria depend on. Change
them only deliberately:

- **The audit trail is append-only**, enforced by a database trigger rather than
  application code. Never add an edit or delete path.
- **Accounts are never hard-deleted.** Removal is `accountStatus = REMOVED`.
- **Blank and "N/A – not exposed" stay distinct**, and only a captured last
  login can make an account dormant.
- **Nothing is removed or matched to a person without a human deciding.** The
  import may suggest; it must never apply a guess.
- **Imports are transactional and idempotent.** Re-importing an unchanged export
  writes no field changes and no audit events.
- **A password reset always clears the login lockout in the same write** —
  from the Admin screen, or via `BOOTSTRAP_ADMIN_FORCE_RESET`. Otherwise the
  new password is refused until the old lockout runs out on its own.
- **The email digest notifies once per condition, not once a day it holds.**
  Every alert kind checks `NotificationLog` before sending and deletes its row
  once the condition clears, so it can fire again if the same thing recurs.
- **Snapshots are measurements, not estimates.** A day the daily job missed has
  no `RegisterSnapshot` row. Never fill a gap by interpolating or by
  reconstructing it from the audit trail — plot the days that exist.
