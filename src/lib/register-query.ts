import type { Prisma } from "@prisma/client";

/**
 * Turns the register list-view querystring into a Prisma query.
 *
 * The list view and every export share this, so a CSV an auditor downloads is
 * always exactly the rows they were looking at — filters, sort and all.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export const SORTABLE_COLUMNS = [
  { key: "vendor", label: "Vendor" },
  { key: "instance", label: "Instance" },
  { key: "person", label: "Person" },
  { key: "rawUsername", label: "Username" },
  { key: "rawEmail", label: "Email" },
  { key: "role", label: "Role" },
  { key: "permissionLevel", label: "Permission level" },
  { key: "accountStatus", label: "Status" },
  { key: "accountCreated", label: "Created" },
  { key: "accountExpiry", label: "Account expiry" },
  { key: "passwordExpiry", label: "Password expiry" },
  { key: "lastLogin", label: "Last login" },
  { key: "justification", label: "Justification" },
  { key: "source", label: "Source" },
  { key: "firstSeen", label: "First seen" },
  { key: "lastSeenInSource", label: "Last seen in source" },
  { key: "lastConfirmed", label: "Last confirmed" },
] as const;

export type SortKey = (typeof SORTABLE_COLUMNS)[number]["key"];

const DATE_FILTERS = [
  "lastLogin",
  "accountCreated",
  "accountExpiry",
  "passwordExpiry",
  "firstSeen",
  "lastSeenInSource",
  "lastConfirmed",
] as const;

const STATE_FILTERS = [
  ["lastLoginState", "lastLoginState"],
  ["accountCreatedState", "accountCreatedState"],
  ["accountExpiryState", "accountExpiryState"],
  ["passwordExpiryState", "passwordExpiryState"],
] as const;

function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found && found.length ? found : undefined;
}

function many(params: SearchParams, key: string): string[] {
  const value = params[key];
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(",");
  return list.map((v) => v.trim()).filter(Boolean);
}

function parseDay(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type RegisterFilters = {
  where: Prisma.AccessRecordWhereInput;
  orderBy: Prisma.AccessRecordOrderByWithRelationInput[];
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

export function buildRegisterQuery(
  params: SearchParams,
  /** Vendor ids this user may see; null means unrestricted. */
  allowedVendorIds: string[] | null,
): RegisterFilters {
  const and: Prisma.AccessRecordWhereInput[] = [];

  if (allowedVendorIds) and.push({ vendorId: { in: allowedVendorIds } });

  const q = one(params, "q");
  if (q) {
    and.push({
      OR: [
        { rawUsername: { contains: q, mode: "insensitive" } },
        { rawEmail: { contains: q, mode: "insensitive" } },
        { role: { contains: q, mode: "insensitive" } },
        { permissionLevel: { contains: q, mode: "insensitive" } },
        { justification: { contains: q, mode: "insensitive" } },
        { person: { fullName: { contains: q, mode: "insensitive" } } },
        { person: { primaryEmail: { contains: q, mode: "insensitive" } } },
        { vendor: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const vendorIds = many(params, "vendorId");
  if (vendorIds.length) and.push({ vendorId: { in: vendorIds } });

  const instanceIds = many(params, "instanceId");
  if (instanceIds.length) and.push({ instanceId: { in: instanceIds } });

  const personId = one(params, "personId");
  if (personId) and.push({ personId });

  const statuses = many(params, "accountStatus");
  if (statuses.length) {
    and.push({ accountStatus: { in: statuses as Prisma.EnumAccountStatusFilter["in"] } });
  }

  const sources = many(params, "source");
  if (sources.length) {
    and.push({ source: { in: sources as Prisma.EnumCaptureMethodFilter["in"] } });
  }

  // Flags are AND-ed: "dormant AND unmatched" narrows, which is what an
  // auditor chasing a specific problem actually wants.
  for (const flag of many(params, "flag")) and.push({ flags: { has: flag } });
  for (const flag of many(params, "notFlag")) and.push({ NOT: { flags: { has: flag } } });

  if (one(params, "unmatched") === "1") and.push({ personId: null });
  if (one(params, "hasJustification") === "0") and.push({ justification: "" });

  const employeeStatuses = many(params, "employeeStatus");
  if (employeeStatuses.length) {
    and.push({
      person: { employeeStatus: { in: employeeStatuses as Prisma.EnumEmployeeStatusFilter["in"] } },
    });
  }

  const personTypes = many(params, "personType");
  if (personTypes.length) {
    and.push({ person: { personType: { in: personTypes as Prisma.EnumPersonTypeFilter["in"] } } });
  }

  const department = one(params, "department");
  if (department) and.push({ person: { department: { contains: department, mode: "insensitive" } } });

  const role = one(params, "role");
  if (role) and.push({ role: { contains: role, mode: "insensitive" } });

  // Explicit "N/A - not exposed" vs "blank" filtering, so both are reachable.
  for (const [param, column] of STATE_FILTERS) {
    const values = many(params, param);
    if (values.length) {
      and.push({ [column]: { in: values } } as Prisma.AccessRecordWhereInput);
    }
  }

  for (const field of DATE_FILTERS) {
    const from = parseDay(one(params, `${field}From`));
    const to = parseDay(one(params, `${field}To`), true);
    if (from || to) {
      and.push({
        [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
      } as Prisma.AccessRecordWhereInput);
    }
    if (one(params, `${field}IsNull`) === "1") {
      and.push({ [field]: null } as Prisma.AccessRecordWhereInput);
    }
  }

  const sort = (one(params, "sort") ?? "vendor") as SortKey;
  const dir = one(params, "dir") === "desc" ? "desc" : "asc";
  const orderBy = buildOrderBy(sort, dir);

  const page = Math.max(1, Number.parseInt(one(params, "page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(10, Number.parseInt(one(params, "pageSize") ?? "50", 10) || 50),
  );

  return {
    where: and.length ? { AND: and } : {},
    orderBy,
    sort,
    dir,
    page,
    pageSize,
  };
}

function buildOrderBy(
  sort: SortKey,
  dir: "asc" | "desc",
): Prisma.AccessRecordOrderByWithRelationInput[] {
  const nulls = dir === "asc" ? "last" : ("first" as const);

  switch (sort) {
    case "vendor":
      return [{ vendor: { name: dir } }, { rawUsername: "asc" }];
    case "instance":
      return [{ instance: { name: dir } }, { rawUsername: "asc" }];
    case "person":
      return [{ person: { fullName: dir } }, { vendor: { name: "asc" } }];
    case "accountCreated":
    case "accountExpiry":
    case "passwordExpiry":
    case "lastLogin":
    case "lastSeenInSource":
    case "lastConfirmed":
      return [{ [sort]: { sort: dir, nulls } }];
    default:
      return [{ [sort]: dir }];
  }
}

/** Rebuild a querystring with one parameter replaced. Used by table headers. */
export function withParam(
  params: SearchParams,
  key: string,
  value: string | null,
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === key || v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item) search.append(k, item);
    }
  }
  if (value !== null && value !== "") search.set(key, value);
  // Changing a filter or the sort invalidates the current page number.
  if (key !== "page") search.delete("page");
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function toQueryString(params: SearchParams): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) if (item) search.append(k, item);
  }
  return search.toString();
}
