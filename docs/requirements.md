# Third-Party Access Register — Application Requirements

> **The original brief, reproduced verbatim and deliberately frozen.**
>
> This is the record of what was asked for, so it is not edited as the app
> changes. A spec that gets updated to match whatever was built stops being
> something you can check the build against.
>
> For what has actually been built against it — clause by clause, including
> where the build went further than the brief — see
> [Requirements traceability](../README.md#requirements-traceability) in the
> root README.

**Purpose:** A centralised, auditable register of every user account across all WOSG
third-party systems. Answers, at any moment: *who has access to what, at what level, since
when, when they last used it, and whether they should still have it.* Primary driver is
audit and accountability — catching accounts that outlived the person's need for them
(leavers, dormant accounts, over-privileged access).

**Build note for Claude Code:** the register is **manually owned** — data comes in via
per-vendor exports (CSV) and manual entry, not live sync. Automated pulls (vendor APIs) and
HR reconciliation are explicitly later-phase. Every account row carries the same trust
level, and the app's job is to make the manual process fast, consistent, and evidenced.

---

## 1. App users & roles

The people who use the register (distinct from the accounts being registered).

| Role | Can do |
|---|---|
| **Admin** | Everything: manage vendors, run imports, edit any record, manage app users, configure rules |
| **Vendor owner** | View/edit accounts for the vendors assigned to them; complete reviews for those vendors |
| **Auditor (read-only)** | View everything and export; change nothing. This role must exist for audit sign-off |

- Authentication should support **SSO via Microsoft Entra (OIDC)** — WOSG is a Microsoft
  365 shop. Local login acceptable as a fallback for MVP.
- Role-based access control throughout; a vendor owner must not see or edit vendors they
  don't own except in read-only aggregate reports (configurable).

---

## 2. Data model

Suggested entities, fields, and types. Relationships noted underneath each.

### Vendor
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| name | string | e.g. Adyen, Jira, DPD |
| category | enum | Payments / Courier / Dev tooling / Analytics / Brand partner / Hosting / Other |
| description | text | |
| owner_user_id | FK → AppUser | Accountable vendor owner |
| capture_method | enum | csv_export / api / manual_read |
| exposes_last_login | bool | Whether the vendor's export includes last login |
| exposes_password_expiry | bool | |
| review_frequency_months | int | Default 3 |
| notes | text | |

### VendorInstance *(optional — for vendors with multiple portals/tenants/accounts)*
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| vendor_id | FK → Vendor | |
| name | string | e.g. "Adyen – Goldsmiths", "Adyen – Mappin & Webb" |
| notes | text | |

*A Vendor has many VendorInstances (zero is fine — nullable on AccessRecord).*

### Person *(the canonical human — one per real person)*
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| full_name | string | |
| primary_email | string | Main match key |
| alternate_emails | string[] | For matching across systems |
| person_type | enum | Employee / Contractor / Partner / Service account |
| employee_status | enum | Active / Left / Unknown |
| department | string | nullable |
| line_manager | string | nullable |
| hr_reference | string | nullable — links to HR reconciliation |
| start_date / leave_date | date | nullable |

*A Person has many AccessRecords. This link is what powers the cross-vendor view of one
human's whole footprint — the core of the leaver process.*

### AccessRecord *(the register row — one account on one system)*
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| vendor_id | FK → Vendor | |
| instance_id | FK → VendorInstance | nullable |
| person_id | FK → Person | nullable until matched |
| raw_username | string | As it appears in the vendor system |
| raw_email | string | As it appears in the vendor system |
| role | string | Named role in the system |
| permission_level | string | Freeform, where role isn't specific enough |
| account_status | enum | Active / Disabled / Removed |
| account_created | date | nullable |
| account_expiry | date | nullable |
| password_expiry | date | nullable |
| last_login | date | nullable |
| justification | text | Why they have this access |
| source | enum | csv_export / api / manual_read |
| first_seen | datetime | When first captured |
| last_seen_in_source | datetime | Last import that still contained this account |
| last_confirmed | datetime | Last time a human confirmed the row is correct |
| flags | string[] | e.g. dormant, unmatched, leaver_with_access |

### ImportBatch
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| vendor_id | FK → Vendor | |
| imported_by | FK → AppUser | |
| imported_at | datetime | |
| source_filename | string | |
| mapping_id | FK → ColumnMapping | |
| row_count | int | |
| summary | json | new / updated / disappeared counts |

### ColumnMapping *(reusable per vendor)*
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| vendor_id | FK → Vendor | |
| mapping | json | `{ "source_column": "canonical_field" }` |

### ReviewCycle & ReviewItem
- **ReviewCycle:** id, name (e.g. "Q1 2026"), type (quarterly/annual), opened_at, due_at,
  status (open/closed).
- **ReviewItem:** id, cycle_id, access_record_id, reviewer_user_id, outcome
  (keep / downgrade / remove), notes, reviewed_at.

### AuditEvent *(append-only)*
| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| entity_type | string | Vendor / AccessRecord / Person / … |
| entity_id | uuid | |
| field | string | nullable for create/delete |
| old_value / new_value | text | |
| changed_by | FK → AppUser | "system" for imports |
| change_source | enum | manual / import / leaver_process / review |
| changed_at | datetime | |

*Immutable. Every create/update/delete anywhere writes one of these. This is the audit
backbone — do not allow edits or deletes on it.*

---

## 3. Functional requirements

### 3.1 Vendor & instance management
- CRUD for vendors and instances.
- Record capture method and which fields each vendor exposes (drives the "N/A – not
  exposed" behaviour below).
- Assign an owner to each vendor.

### 3.2 The register (accounts)
- CRUD for AccessRecords, plus manual single-entry for vendors with no export.
- List view with **filter and sort on every field**; saved views.
- Field-meaning rule: where a vendor doesn't expose a field, store an explicit
  **"N/A – not exposed"** state, distinct from **blank** (= not yet captured). Blank means
  outstanding work; N/A means the data will never exist. This distinction must be visible
  and filterable.

### 3.3 Person / identity layer
- One Person per real human; an AccessRecord links to a Person.
- **Cross-vendor view:** open a Person and see every account they hold across all vendors,
  with status, role, and last login. This is the single most important screen.
- Manual merge/split of Persons (matching is never perfect).

### 3.4 Import pipeline *(core feature — build this carefully)*
1. User selects a vendor and uploads a CSV (or pastes tabular data).
2. App applies the saved **ColumnMapping** for that vendor, or prompts the user to create
   one (drag/select source column → canonical field). Mapping is saved for reuse.
3. Rows are normalised into canonical fields in a **staging area** — nothing is committed
   yet.
4. **Diff preview** against the current register for that vendor, in three buckets:
   - **New** — accounts not previously seen.
   - **Changed** — existing accounts with changed fields (highlight what changed, e.g.
     role, last_login).
   - **Disappeared** — accounts in the register but absent from this import → candidate for
     "removed at source." User confirms whether to mark Removed.
5. User reviews and commits. On commit: create/update records, set `last_seen_in_source`,
   write an ImportBatch and AuditEvents for every change.
- Imports must be **idempotent** — re-importing the same file changes nothing.

### 3.5 Identity matching & dedup
- On import, match each row to an existing Person by primary/alternate email first, then
  fuzzy name match as a fallback.
- Match to an existing AccessRecord by (vendor + instance + raw_username/raw_email).
- Unmatched rows are flagged `unmatched` and surfaced for a human to link or create a
  Person. Never silently guess.

### 3.6 HR reconciliation *(later phase)*
- Import an HR active-employee list.
- Report every **Active AccessRecord whose Person is Left / not on the HR list** →
  the **"leavers with access"** report. This is the headline audit output.

### 3.7 Dormant & expiry flagging (rule engine)
- Rule: `last_login older than N months` → flag `dormant` (N configurable, default 12).
- Vendors that don't expose last login → flag affected accounts `unverifiable` rather than
  dormant.
- Surface upcoming **account_expiry** and **password_expiry** within a configurable window.

### 3.8 Leaver workflow
- Enter/select a Person → app lists **every account across every vendor**.
- Work through as a checklist: mark each account Removed, add evidence note (e.g.
  confirmation reference / screenshot upload), timestamp.
- Produces a **leaver report** (all accounts, action taken, evidence) as audit proof.

### 3.9 Review cycles
- Admin opens a ReviewCycle (quarterly/annual) with a due date.
- Each vendor owner gets their accounts to review; per account they record
  keep / downgrade / remove + notes.
- Progress tracking per vendor and overall; closing the cycle produces an exportable
  audit record.
- Challenge prompts surfaced during review: dormant, no justification, permission above
  role, never previously reviewed.

### 3.10 Audit trail / history
- Every change anywhere writes an append-only AuditEvent.
- View full history per AccessRecord and per Person (who changed what, when, via which
  process).

### 3.11 Dashboard & reports
- Accounts per vendor (active vs removed); dormant count; unmatched-to-person count;
  leavers-with-access; accounts overdue review; upcoming expiries.
- **Export any view to CSV/Excel** for auditors.

### 3.12 Notifications *(later phase)*
- Review cycle due reminders; expiry approaching; new dormant accounts detected on import.

---

## 4. Non-functional requirements

- **Security:** RBAC enforced server-side; SSO via Entra/OIDC; least privilege.
- **Data protection:** the register holds names and emails (personal data) — access
  controlled, encrypted at rest and in transit, defined retention policy, hosted in line
  with WOSG data policy.
- **Auditability:** append-only audit log; no hard deletes of AccessRecords (soft-delete /
  status = Removed, history retained).
- **Reliability:** imports transactional (all-or-nothing per batch); backups.
- **Usability:** the import diff-preview and the per-person cross-vendor view are the two
  screens that must be excellent; everything else can be plain.

---

## 5. Suggested tech stack (flexible)

Given a TypeScript-friendly build and Entra SSO:
- **Frontend:** React + Next.js, TypeScript.
- **Backend/API:** Node + TypeScript (Next.js API routes or a small Express/Fastify service).
- **DB:** PostgreSQL with Prisma ORM (the relational model above maps cleanly).
- **Auth:** OIDC against Microsoft Entra.
- **CSV parsing:** a well-tested library server-side; validate and preview before commit.

Not prescriptive — but the relational model, transactional imports, and append-only audit
log are the parts to hold firm on whatever stack is chosen.

---

## 6. Phasing

**MVP:** vendors + instances, AccessRecord CRUD + manual entry, CSV import with saved
mapping + diff preview, Person layer with cross-vendor view and manual matching, dormant/
expiry flags, leaver workflow, append-only audit log, auditor read-only role, CSV/Excel
export.

**Phase 2:** ReviewCycle workflow, HR reconciliation + leavers-with-access report,
notifications, Entra SSO.

**Phase 3:** vendor API pulls for reconciliation (spot-check against the manual truth, not
a live feed), advanced dashboards.

---

## 7. Key acceptance criteria

- Importing a vendor CSV twice produces **zero** changes the second time (idempotent).
- An account present in the register but absent from a new import is surfaced as
  "disappeared" and **never** auto-removed without confirmation.
- Opening any Person shows **100%** of their accounts across all vendors.
- A vendor that doesn't expose last_login shows its accounts as `unverifiable`, never as
  `dormant`.
- Every field change is retrievable in that record's history with who/when/source.
- An auditor account can view and export everything and can change nothing.
- Marking a person as a leaver produces a single report listing every account and the
  action + evidence recorded against each.
