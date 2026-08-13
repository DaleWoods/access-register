/**
 * The in-app user guide.
 *
 * Content lives here as data rather than as markup so that
 * `tests/user-guide.test.ts` can prove it stays in step with the app: every
 * navigation entry must be covered by a section, and the flag glossary and role
 * list are derived from the same constants the app itself renders, so they
 * cannot drift.
 *
 * See CONTRIBUTING.md — a user-facing change is not finished until this file
 * and GUIDE_UPDATED are updated with it.
 */

export const GUIDE_UPDATED = "2026-08-08";

export type GuideCallout = {
  tone: "info" | "warn" | "tip";
  title?: string;
  body: string;
};

export type GuideSection = {
  id: string;
  title: string;
  /** One-line summary shown in the contents list. */
  summary: string;
  /**
   * Navigation hrefs this section documents. The coverage test fails if a
   * navigation entry has no section claiming it.
   */
  covers: string[];
  /** Roles that can use what this section describes. */
  roles?: ("Admin" | "Vendor owner" | "Auditor")[];
  paragraphs: string[];
  steps?: { title: string; body: string }[];
  points?: { term: string; body: string }[];
  callouts?: GuideCallout[];
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "what-this-is",
    title: "What the register is for",
    summary: "The question the register exists to answer, and where its data comes from.",
    covers: [],
    paragraphs: [
      "The register is a single, auditable list of every account your people hold in third-party systems — payment portals, courier sites, dev tooling, analytics, brand partner sites. It answers one question at any moment: who has access to what, at what level, since when, when they last used it, and whether they should still have it.",
      "The data is owned by people, not by machines. It arrives through per-vendor CSV exports and manual entry, not live sync. The app's job is to make that manual process fast, consistent, and evidenced — so that when an auditor asks how you know a leaver's access was removed, there is a dated, attributed answer.",
    ],
    callouts: [
      {
        tone: "info",
        title: "Two ideas worth learning first",
        body: "Blank and “N/A – not exposed” are different things, and nothing is ever removed or matched to a person without a human deciding. Everything else follows from those two.",
      },
    ],
  },
  {
    id: "roles",
    title: "Roles and what each can do",
    summary: "Admin, vendor owner and auditor, and where the boundaries sit.",
    covers: ["/admin"],
    paragraphs: [
      "Every screen enforces your role on the server, not just in what it shows you. Hiding a button and refusing the action are separate things, and the app does both.",
    ],
    points: [
      {
        term: "Admin",
        body: "Everything: manage vendors and instances, run imports, edit any record, manage app users, open review cycles, and change the rule-engine thresholds.",
      },
      {
        term: "Vendor owner",
        body: "View and edit accounts for the vendors assigned to them, run those vendors' imports, and complete their reviews. Other vendors are invisible on record-level screens. Whole-estate totals on the dashboard can be shown read-only, which an admin controls in settings.",
      },
      {
        term: "Auditor",
        body: "Read and export everything, change nothing. Write actions are refused by the server, not merely hidden. This role exists so audit sign-off does not require handing out edit rights.",
      },
    ],
    callouts: [
      {
        tone: "info",
        title: "Signing in",
        body: "Local email and password for now. Single sign-on with Microsoft Entra is a later phase. If you are locked out, another admin can reset your password on the Admin screen.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    summary: "The audit-relevant counts, each a link into the underlying accounts.",
    covers: ["/"],
    paragraphs: [
      "The dashboard is the standing view of where the estate is uncomfortable. Every tile is a saved filter over the register rather than a separate calculation, so clicking one shows exactly the accounts behind the number — and you can export precisely that.",
      "Leavers with access is the headline figure. It is the count of accounts belonging to people marked as having left, and the number an auditor will ask about first.",
    ],
    callouts: [
      {
        tone: "tip",
        body: "Recalculate flags re-runs the rule engine over every account. Use it after changing the dormancy threshold or a vendor's exposure settings.",
      },
    ],
  },
  {
    id: "register",
    title: "Register",
    summary: "Every account row, filterable on any field, with saved views and export.",
    covers: ["/register"],
    roles: ["Admin", "Vendor owner", "Auditor"],
    paragraphs: [
      "One row per account on one system. Filter and sort on any field; every filter lands in the URL, so a view is shareable, bookmarkable and saveable, and an export always contains exactly what is on screen.",
      "Open any row to see its full detail and its complete history — who changed what, when, and through which process.",
    ],
    points: [
      {
        term: "A value",
        body: "The data, captured from an import or entered by hand.",
      },
      {
        term: "Not captured",
        body: "Shown in amber italics. The vendor does publish this field, but nobody has recorded it yet. This is outstanding work.",
      },
      {
        term: "N/A – not exposed",
        body: "Shown as a grey chip. This vendor will never publish this field, so no amount of work will fill it in. Both states are filterable separately.",
      },
    ],
    callouts: [
      {
        tone: "warn",
        title: "Why the distinction matters",
        body: "Conflating them is how a register quietly rots: a blank that means “nobody has looked” gets treated like a blank that means “this cannot be known”. It also decides whether an account can be called dormant at all.",
      },
      {
        tone: "tip",
        title: "Saved views",
        body: "Save a filter combination you use often. Personal by default; tick Share to make it available to everyone.",
      },
    ],
  },
  {
    id: "flags",
    title: "Flags",
    summary: "What the rule engine marks automatically, and what each flag means.",
    covers: [],
    paragraphs: [
      "Flags are derived, never typed. The rule engine recalculates them whenever a record changes, and an admin can re-run it across the whole register from the dashboard. Filter the register by any flag to work through them.",
    ],
    callouts: [
      {
        tone: "warn",
        title: "Dormant versus unverifiable",
        body: "An account can only be called dormant if its last login is actually visible. Where a vendor does not publish last login, its accounts are unverifiable — an honest “we cannot tell” — and never dormant. Confirm the need for those directly with the account holder.",
      },
    ],
  },
  {
    id: "people",
    title: "People",
    summary: "One record per human, and the cross-vendor view of everything they hold.",
    covers: ["/people"],
    paragraphs: [
      "A person is a real human; an account belongs to one. Opening a person shows every account they hold across every vendor, live and removed, with status, role, last login and flags. This is the most important screen in the app and the one the leaver process runs from.",
      "Matching is never perfect, so you can merge a duplicate into a person, or split an account back out. A merged record is kept as a tombstone rather than deleted, so its history still resolves.",
    ],
    points: [
      {
        term: "Alternate emails",
        body: "The addresses this person uses in other systems. Future imports match on these too, which is how one human's accounts stay together across vendors that know them by different addresses.",
      },
      {
        term: "Employee status",
        body: "Active, Left or Unknown. Setting someone to Left immediately flags every live account they hold.",
      },
    ],
  },
  {
    id: "import",
    title: "Import",
    summary: "Upload a vendor export, map its columns once, review the diff, then commit.",
    covers: ["/import"],
    roles: ["Admin", "Vendor owner"],
    paragraphs: [
      "There is no live connection to any vendor. Data arrives because somebody exports it from the vendor's own admin screens and uploads that file here, one vendor at a time. This is the main way the register is kept current.",
      "Start either from the Import tab and pick the vendor, or from Vendors by pressing Upload data on the one you are working through — that lands here with the vendor already chosen. Either way it is deliberately a review step rather than a sync: nothing touches the register until you press Commit.",
    ],
    steps: [
      {
        title: "1. Choose the vendor and the data",
        body: "Pick the vendor, and the instance if that vendor has several portals. Coming from a vendor's Upload data button, both are already filled in. Upload a CSV exported from the vendor, or paste straight from a spreadsheet. Scoping to an instance matters: one portal's export must not mark another portal's accounts as disappeared.",
      },
      {
        title: "2. Confirm the column mapping",
        body: "Line the export's columns up with the register's fields. The mapping is saved against the vendor, so next month's import is already mapped. Columns you do not need can be ignored.",
      },
      {
        title: "3. Review the diff",
        body: "Three buckets. New accounts not seen before. Changed accounts, showing the exact before and after for each field. Disappeared accounts — in the register but absent from this file. Rows that could not be read are listed separately with the reason.",
      },
      {
        title: "4. Decide about people",
        body: "Rows matched to a person by email are linked automatically. A close name match is offered as a suggestion with a similarity score for you to accept. Anything else stays unmatched and is flagged for follow-up. Bulk actions handle a first import into an empty register.",
      },
      {
        title: "5. Commit",
        body: "Everything applies in a single transaction: it either all lands or none of it does. The batch and every field change are written to the audit trail.",
      },
    ],
    callouts: [
      {
        tone: "warn",
        title: "Disappeared accounts are never removed automatically",
        body: "An account missing from an export usually means it was removed at source — but it can also mean a partial export. Each one needs an explicit tick before it is marked Removed.",
      },
      {
        tone: "tip",
        title: "Re-importing is safe",
        body: "Importing the same unchanged export twice produces no changes the second time. If the preview says the file matches the register exactly, that is the system working, not a failure.",
      },
      {
        tone: "info",
        title: "Nothing is guessed",
        body: "The register will leave an account unmatched rather than assume whose it is. Unmatched accounts are invisible to the leaver process, so they are worth clearing.",
      },
    ],
  },
  {
    id: "vendors",
    title: "Vendors and instances",
    summary: "Each third-party system, who owns it, and which fields it actually exposes.",
    covers: ["/vendors"],
    roles: ["Admin", "Vendor owner"],
    paragraphs: [
      "A vendor is a third-party system. Give each one an accountable owner: they get its accounts to review and can run its imports.",
      "Use instances where one vendor has several portals or tenants — a separate payment portal per retail brand, for example. Imports and the disappeared check are scoped per instance.",
      "The vendor list doubles as a record of which vendors are up to date. Each row shows when its data was last uploaded, ageing to amber past ninety days, and carries an Upload data button that takes you straight into the import with that vendor selected. Vendors captured by hand show “Entered by hand” instead, because there is no export to upload for them.",
    ],
    points: [
      {
        term: "Fields this vendor exposes",
        body: "The most consequential setting in the app. Unticking a field marks it “N/A – not exposed” on every one of that vendor's accounts. Unticking last login makes them unverifiable rather than dormant. Re-ticking demotes N/A back to blank — outstanding work — rather than inventing a value. Every one of those transitions is audited.",
      },
      {
        term: "Review frequency",
        body: "How often this vendor's accounts should be reviewed. Drives the overdue-review flag.",
      },
      {
        term: "Saved column mappings",
        body: "How this vendor's export columns line up with the register's fields, so routine imports need no re-mapping.",
      },
    ],
  },
  {
    id: "leavers",
    title: "Leavers",
    summary: "Work every account a leaver holds as an evidenced checklist.",
    covers: ["/leavers"],
    roles: ["Admin", "Vendor owner"],
    paragraphs: [
      "Opening a leaver case marks the person as having left and snapshots every account they hold — across every vendor — into a checklist. Removed accounts are included so the report is a complete picture.",
      "Work down the list. Each row takes an action and an evidence note, and optionally a file: a confirmation screenshot, an email, a ticket PDF. Choosing Removed also sets the account to Removed in the register and writes it to history.",
      "When every row is actioned you can close the case. The result is a single report — every account, the action taken, the evidence, who did it and when — exportable as CSV or Excel. That report is the audit proof the process ran.",
    ],
    callouts: [
      {
        tone: "tip",
        body: "The Leavers screen also lists people marked as having left who still hold live access and have no open case. That list should normally be empty.",
      },
      {
        tone: "warn",
        title: "Evidence files on the free hosting plan",
        body: "Uploaded evidence is stored on the container's local disk, which is wiped on every deployment. Evidence notes are in the database and safe. Until the app moves to a plan with a persistent disk, treat the note as the record and keep files elsewhere.",
      },
    ],
  },
  {
    id: "reviews",
    title: "Review cycles",
    summary: "Periodic access reviews with challenge prompts and progress tracking.",
    covers: ["/reviews"],
    roles: ["Admin", "Vendor owner"],
    paragraphs: [
      "An admin opens a cycle with a due date. Every live account is pulled in and assigned to its vendor's owner. Each reviewer records keep, downgrade or remove against their accounts, with notes.",
      "Progress is tracked per vendor and overall. Closing the cycle produces the exportable audit record.",
    ],
    points: [
      {
        term: "Challenge prompts",
        body: "Each account carries the awkward questions worth asking: dormant, dormancy unverifiable, no justification recorded, permission level above the named role, never reviewed before, or the holder has left. The point of a review is not to click keep two hundred times.",
      },
      {
        term: "Remove",
        body: "Sets the account to Removed in the register straight away. Downgrade records the decision — apply the new permission on the account once the vendor has actioned it.",
      },
    ],
  },
  {
    id: "audit",
    title: "Audit trail",
    summary: "Every change ever made, and why it cannot be edited.",
    covers: ["/audit"],
    roles: ["Admin", "Vendor owner", "Auditor"],
    paragraphs: [
      "Every create, edit, removal, import commit, review outcome and leaver action writes a row here: what changed, from what to what, who did it, when, and through which process. Filter by entity, by process, or by searching the values themselves. Each record and each person also shows its own history in place.",
      "The trail cannot be edited or deleted by anyone, including an administrator. That is enforced by the database itself, not by application code, so the guarantee holds even against direct database access.",
    ],
    callouts: [
      {
        tone: "info",
        body: "Accounts are never destroyed either. Removal sets the status to Removed and keeps the history, so “what did they used to have” stays answerable.",
      },
    ],
  },
  {
    id: "exports",
    title: "Exports",
    summary: "Getting data out for auditors, in CSV or Excel.",
    covers: [],
    roles: ["Admin", "Vendor owner", "Auditor"],
    paragraphs: [
      "Any view can be exported as CSV or as a real Excel workbook, including by an auditor. Exports honour the filters and sort you have applied, so what you download is what you were looking at.",
      "The register export spells out “N/A - not exposed” in full rather than leaving a blank cell, so the distinction survives into a spreadsheet. A person's footprint and a leaver report can be exported from their own screens, and the leaver report carries a header block naming the person, their manager and the case dates so the file stands alone as evidence.",
    ],
  },
  {
    id: "admin",
    title: "Admin settings",
    summary: "App users, roles, and the thresholds the rule engine uses.",
    covers: ["/admin"],
    roles: ["Admin"],
    paragraphs: [
      "Add app users, set their role, disable them, or reset a password. The system will not let you remove the last active admin.",
    ],
    points: [
      {
        term: "Dormancy threshold",
        body: "How many months without a login before an account is flagged dormant. Twelve by default.",
      },
      {
        term: "Expiry warning window",
        body: "How far ahead account and password expiries are surfaced. Thirty days by default.",
      },
      {
        term: "Fuzzy name match threshold",
        body: "How similar a name must be before the import suggests it as a match. Suggestions always need a human to accept them, whatever this is set to.",
      },
      {
        term: "Vendor owner aggregate access",
        body: "Whether vendor owners see whole-estate totals read-only, or only their own vendors.",
      },
    ],
    callouts: [
      {
        tone: "tip",
        body: "Changing a threshold recalculates every flag immediately, so the register reflects the new rule at once.",
      },
    ],
  },
  {
    id: "not-yet",
    title: "What is not built yet",
    summary: "Later phases, so nobody waits for something that is not there.",
    covers: [],
    paragraphs: [
      "These are deliberately later-phase, not oversights.",
    ],
    points: [
      {
        term: "Microsoft Entra single sign-on",
        body: "Local email and password for now. The session layer is already provider-agnostic, so adding it does not disturb anything else.",
      },
      {
        term: "HR reconciliation",
        body: "The HR reference field and employee statuses exist, and the leavers-with-access report already works from them. What is missing is bulk-importing an HR active-employee list to set those statuses automatically.",
      },
      {
        term: "Notifications",
        body: "Review-due reminders and expiry warnings. Everything they would report on is already visible in the app; only the sending is absent.",
      },
      {
        term: "Vendor API pulls",
        body: "A later spot-check against the manual truth, not a live feed. The register stays manually owned by design.",
      },
    ],
  },
  {
    id: "about-this-guide",
    title: "About this guide",
    summary: "How it is kept current, and how to take a copy away.",
    covers: ["/guide"],
    paragraphs: [
      "This guide lives inside the app rather than in a separate document, so it is always the version that matches what you are looking at. The date in the header is when it was last revised.",
      "Use Print or save as PDF to take a copy — for an induction pack, or to attach to an audit submission. The contents list and navigation are left out of the printed version.",
    ],
    callouts: [
      {
        tone: "info",
        title: "It cannot quietly fall behind",
        body: "The build fails if a screen is added to the navigation without a section here covering it, if a flag exists with no explanation, or if a role goes undescribed. The flag list and role names on this page are generated from the same definitions the rest of the app uses, so they are never a second copy that can go stale.",
      },
      {
        tone: "tip",
        body: "Something unclear or missing? That is a defect in the guide. Say so, and it gets fixed alongside the code.",
      },
    ],
  },
];
