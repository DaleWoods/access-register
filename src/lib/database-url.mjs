/**
 * Compose the effective Postgres connection string.
 *
 * Render hands us a bare connection string via `fromDatabase`, with no room to
 * add query parameters. Two of them matter when the register shares a database
 * instance with another application:
 *
 *   schema           keeps every table this app owns — including Prisma's own
 *                    migration history — inside its own namespace, so it can
 *                    never collide with the other app's tables.
 *   connection_limit caps this app's connection pool so it cannot exhaust a
 *                    shared instance's connections and starve its neighbour.
 *
 * Both are only added when absent, so a fully-specified DATABASE_URL always
 * wins. Written as plain JavaScript with no dependencies because the deploy
 * bootstrap runs it before any build step exists.
 */

/** Conservative default: enough for this app, gentle on a shared instance. */
const DEFAULT_CONNECTION_LIMIT = "5";

/**
 * Applied when DATABASE_URL names no schema of its own. Defaulting here rather
 * than only in render.yaml means pasting a bare connection string is enough to
 * get correct isolation — no query string to remember, and no dependency on a
 * platform env var having been wired up.
 *
 * Development and test connection strings carry an explicit `?schema=public`,
 * so they are unaffected.
 */
const DEFAULT_SCHEMA = "access_register";

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function composeDatabaseUrl(env = process.env) {
  const base = (env.DATABASE_URL ?? "").trim();
  if (!base) return null;

  // Deliberately string-based rather than via the URL class: re-serialising a
  // parsed URL can alter percent-encoding in the password and break auth.
  const query = base.includes("?") ? base.slice(base.indexOf("?") + 1) : "";
  const has = (key) => new RegExp(`(^|&)${key}=`).test(query);

  const extra = [];

  const schema = (env.DATABASE_SCHEMA ?? DEFAULT_SCHEMA).trim();
  if (schema && !has("schema")) extra.push(`schema=${encodeURIComponent(schema)}`);

  const limit = (env.DATABASE_CONNECTION_LIMIT ?? DEFAULT_CONNECTION_LIMIT).trim();
  if (limit && !has("connection_limit")) {
    extra.push(`connection_limit=${encodeURIComponent(limit)}`);
  }

  // Prisma needs telling when it is talking to a transaction-mode pooler,
  // otherwise it caches prepared statements the pooler will not honour.
  if (/-pooler\./.test(base) && !has("pgbouncer")) extra.push("pgbouncer=true");

  if (extra.length === 0) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${extra.join("&")}`;
}

/**
 * The connection string to use for schema migrations.
 *
 * Neon (and other Postgres poolers) publish two endpoints: a pooled one whose
 * host carries a `-pooler` suffix, and a direct one without it. Prisma Migrate
 * cannot run through a transaction-mode pooler — it needs session state for
 * advisory locks and DDL — so migrations are pointed at the direct endpoint
 * while the running app keeps using whatever it was given.
 *
 * A connection string with no pooler in it is returned unchanged, so this is a
 * no-op everywhere else.
 *
 * @param {string} url
 * @returns {string}
 */
export function toDirectDatabaseUrl(url) {
  return url
    .replace(/-pooler\./, ".")
    .replace(/([?&])pgbouncer=true(&|$)/, (_m, before, after) => (after ? before : ""))
    .replace(/[?&]$/, "");
}

/**
 * The same value with credentials masked, for logging.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function redactDatabaseUrl(url) {
  if (!url) return "(unset)";
  return url.replace(/\/\/([^:@/]+)(:[^@/]*)?@/, "//$1:***@");
}
