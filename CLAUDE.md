# Notes for Claude working in this repository

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first. The rules below are the ones
easiest to break without noticing.

## Always update the user guide

The app has a **User guide** tab, served from `src/content/user-guide.ts`.

**Treat a user-facing change as incomplete until that file is updated and
`GUIDE_UPDATED` is bumped to today's date.** This is a standing instruction from
the owner of this repository, not a per-task request — do it without being asked
each time, and mention in your summary that you did.

A change is user-facing if it adds or alters a screen, a flag, a role, a field,
a status, a workflow, a setting, or a default.

`npm test` enforces the structural half of this (navigation coverage, flag
descriptions, role coverage, the load-bearing rules, anchor uniqueness). It
cannot tell whether the prose still describes what a screen does — that part is
on you, so reread the section covering anything you changed.

Prefer deriving over duplicating: the flag glossary, the role list and the
configured thresholds are rendered from the app's own constants, so extending
`FLAG_LABELS`/`FLAG_DESCRIPTIONS` or `ROLE_LABELS` documents itself.

## Do not weaken these

They are what the acceptance criteria in the requirements rest on:

- The audit trail is append-only, enforced by a PostgreSQL trigger. There must
  be no code path that edits or deletes an `AuditEvent`.
- `AccessRecord` is never hard-deleted — removal is `accountStatus = REMOVED`.
- Blank and "N/A – not exposed" are distinct states. An account can only be
  called `dormant` when its last login is actually captured; where the vendor
  does not expose it the flag is `unverifiable`.
- Imports never remove an account or attach it to a person without an explicit
  human decision. Fuzzy name matches are suggestions only.
- Import commits are transactional and idempotent.

## Verifying changes

Run `npm run typecheck`, `npm test` and `npm run build`. The tests need a real
PostgreSQL database (`access_register_test`); they truncate every table, so
never point them at a database holding real data.

For anything touching the deploy path, exercise the real start command with a
bare `DATABASE_URL` rather than assuming — `scripts/bootstrap.mjs` runs before
the server and has caught several deploy failures that unit tests could not.
