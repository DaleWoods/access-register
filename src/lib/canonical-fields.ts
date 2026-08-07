/**
 * The canonical field vocabulary an import maps onto.
 *
 * Every vendor CSV looks different; a ColumnMapping records
 * `{ "<their header>": "<canonical key>" }` so the same export can be
 * re-imported later without re-mapping. This file is the single source of
 * truth for what a canonical key means, how it is parsed, and how it is
 * compared during the diff.
 */

export type CanonicalKind = "string" | "date" | "accountStatus";

export type CanonicalField = {
  key: string;
  label: string;
  kind: CanonicalKind;
  /** Column on AccessRecord this writes to. */
  column: string;
  /** Companion FieldState column, for fields a vendor may not expose. */
  stateColumn?: string;
  /** Included in the change diff and audited. */
  diffable: boolean;
  help?: string;
  /** Header fragments we auto-suggest a mapping from. */
  aliases: string[];
};

export const CANONICAL_FIELDS: CanonicalField[] = [
  {
    key: "rawUsername",
    label: "Username (as in vendor system)",
    kind: "string",
    column: "rawUsername",
    diffable: true,
    help: "Identity key. At least one of username / email is required per row.",
    aliases: ["username", "user name", "login", "user id", "userid", "account", "user"],
  },
  {
    key: "rawEmail",
    label: "Email (as in vendor system)",
    kind: "string",
    column: "rawEmail",
    diffable: true,
    help: "Identity key and the primary way rows are matched to a Person.",
    aliases: ["email", "e-mail", "mail", "email address", "upn"],
  },
  {
    key: "fullName",
    label: "Person full name",
    kind: "string",
    column: "__personName",
    diffable: false,
    help: "Not stored on the account row; used to match or create a Person.",
    aliases: ["name", "full name", "display name", "displayname", "user full name"],
  },
  {
    key: "role",
    label: "Role",
    kind: "string",
    column: "role",
    diffable: true,
    aliases: ["role", "group", "profile", "job role", "user role", "access level"],
  },
  {
    key: "permissionLevel",
    label: "Permission level",
    kind: "string",
    column: "permissionLevel",
    diffable: true,
    aliases: ["permission", "permissions", "permission level", "rights", "scope"],
  },
  {
    key: "accountStatus",
    label: "Account status",
    kind: "accountStatus",
    column: "accountStatus",
    diffable: true,
    help: "Parsed to Active / Disabled / Removed. Unrecognised values default to Active.",
    aliases: ["status", "account status", "state", "enabled", "active"],
  },
  {
    key: "accountCreated",
    label: "Account created",
    kind: "date",
    column: "accountCreated",
    stateColumn: "accountCreatedState",
    diffable: true,
    aliases: ["created", "created at", "created on", "account created", "start date"],
  },
  {
    key: "accountExpiry",
    label: "Account expiry",
    kind: "date",
    column: "accountExpiry",
    stateColumn: "accountExpiryState",
    diffable: true,
    aliases: ["expiry", "expires", "expiry date", "account expiry", "valid until"],
  },
  {
    key: "passwordExpiry",
    label: "Password expiry",
    kind: "date",
    column: "passwordExpiry",
    stateColumn: "passwordExpiryState",
    diffable: true,
    aliases: ["password expiry", "password expires", "pwd expiry", "password expiration"],
  },
  {
    key: "lastLogin",
    label: "Last login",
    kind: "date",
    column: "lastLogin",
    stateColumn: "lastLoginState",
    diffable: true,
    aliases: ["last login", "last logon", "last sign in", "last signin", "last access", "last active"],
  },
  {
    key: "justification",
    label: "Justification",
    kind: "string",
    column: "justification",
    diffable: true,
    aliases: ["justification", "reason", "business reason", "notes", "comment"],
  },
];

export const CANONICAL_BY_KEY = new Map(CANONICAL_FIELDS.map((f) => [f.key, f]));

/** Canonical keys that participate in the "changed" diff and get audit rows. */
export const DIFFABLE_KEYS = CANONICAL_FIELDS.filter((f) => f.diffable).map((f) => f.key);

/** Date fields carry a FieldState so "N/A - not exposed" survives round trips. */
export const STATEFUL_FIELDS = CANONICAL_FIELDS.filter((f) => f.stateColumn);

/**
 * Which vendor flag governs each stateful field. When a vendor does not expose
 * a field, its accounts get NOT_EXPOSED rather than a misleading blank.
 */
export const VENDOR_EXPOSURE_FLAG: Record<string, string> = {
  lastLogin: "exposesLastLogin",
  passwordExpiry: "exposesPasswordExpiry",
  accountExpiry: "exposesAccountExpiry",
  accountCreated: "exposesAccountCreated",
};

/** Best-guess mapping for a source header, used to pre-fill the mapping screen. */
export function suggestCanonicalKey(header: string): string | null {
  const norm = header.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
  if (!norm) return null;

  for (const field of CANONICAL_FIELDS) {
    if (field.aliases.includes(norm)) return field.key;
  }
  // Fall back to a containment match, longest alias first so "last login"
  // beats "login" when a header contains both.
  const scored = CANONICAL_FIELDS.flatMap((field) =>
    field.aliases.map((alias) => ({ key: field.key, alias })),
  ).sort((a, b) => b.alias.length - a.alias.length);

  for (const { key, alias } of scored) {
    if (norm.includes(alias)) return key;
  }
  return null;
}
