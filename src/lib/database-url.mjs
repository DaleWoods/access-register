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

  const schema = (env.DATABASE_SCHEMA ?? "").trim();
  if (schema && !has("schema")) extra.push(`schema=${encodeURIComponent(schema)}`);

  const limit = (env.DATABASE_CONNECTION_LIMIT ?? DEFAULT_CONNECTION_LIMIT).trim();
  if (limit && !has("connection_limit")) {
    extra.push(`connection_limit=${encodeURIComponent(limit)}`);
  }

  if (extra.length === 0) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${extra.join("&")}`;
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
