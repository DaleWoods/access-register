import { describe, expect, it } from "vitest";
import {
  composeDatabaseUrl,
  redactDatabaseUrl,
  toDirectDatabaseUrl,
} from "@/lib/database-url.mjs";

/**
 * The register shares a Postgres instance with another application in
 * production, so these are the rules that keep the two apart.
 */

const BARE = "postgresql://bis:s3cr3t@dpg-abc123-a/bis";

/** The helper returns null only when DATABASE_URL is absent; assert otherwise. */
function must(value: string | null): string {
  if (value === null) throw new Error("expected a connection string");
  return value;
}

describe("composeDatabaseUrl", () => {
  it("adds the schema so tables cannot collide with the other app's", () => {
    const url = must(
      composeDatabaseUrl({ DATABASE_URL: BARE, DATABASE_SCHEMA: "access_register" }),
    );
    expect(url).toContain("schema=access_register");
  });

  it("caps the connection pool by default on a shared instance", () => {
    expect(must(composeDatabaseUrl({ DATABASE_URL: BARE }))).toContain("connection_limit=5");
  });

  it("never rewrites credentials", () => {
    const url = must(
      composeDatabaseUrl({
        DATABASE_URL: "postgresql://user:p%40ss+word@host/db",
        DATABASE_SCHEMA: "access_register",
      }),
    );
    expect(url.startsWith("postgresql://user:p%40ss+word@host/db")).toBe(true);
  });

  it("joins with & when the URL already has a query string", () => {
    const url = must(
      composeDatabaseUrl({
        DATABASE_URL: `${BARE}?sslmode=require`,
        DATABASE_SCHEMA: "access_register",
      }),
    );
    expect(url).toContain("?sslmode=require&");
    expect(url).toContain("schema=access_register");
    expect(url.match(/\?/g)).toHaveLength(1);
  });

  it("leaves an explicit schema alone", () => {
    const url = must(
      composeDatabaseUrl({
        DATABASE_URL: `${BARE}?schema=chosen_by_hand`,
        DATABASE_SCHEMA: "access_register",
      }),
    );
    expect(url).toContain("schema=chosen_by_hand");
    expect(url).not.toContain("access_register");
  });

  it("leaves an explicit connection limit alone", () => {
    const url = must(composeDatabaseUrl({ DATABASE_URL: `${BARE}?connection_limit=20` }));
    expect(url).toContain("connection_limit=20");
    expect(url).not.toContain("connection_limit=5");
  });

  it("returns null when nothing is configured, so start-up can refuse", () => {
    expect(composeDatabaseUrl({})).toBeNull();
  });

  it("masks the password for logging", () => {
    const redacted = redactDatabaseUrl(composeDatabaseUrl({ DATABASE_URL: BARE }));
    expect(redacted).not.toContain("s3cr3t");
    expect(redacted).toContain("bis:***@");
  });
});

describe("pooled connection strings (Neon, Supabase)", () => {
  const POOLED =
    "postgresql://reg:pw@ep-cool-bird-123-pooler.eu-central-1.aws.neon.tech/register?sslmode=require";

  it("tells Prisma when it is talking to a pooler", () => {
    expect(must(composeDatabaseUrl({ DATABASE_URL: POOLED }))).toContain("pgbouncer=true");
  });

  it("does not add pgbouncer for a direct endpoint", () => {
    const direct = POOLED.replace("-pooler.", ".");
    expect(must(composeDatabaseUrl({ DATABASE_URL: direct }))).not.toContain("pgbouncer");
  });

  it("routes migrations to the direct endpoint, which a pooler cannot serve", () => {
    const runtime = must(composeDatabaseUrl({ DATABASE_URL: POOLED }));
    const migration = toDirectDatabaseUrl(runtime);

    expect(migration).not.toContain("-pooler.");
    expect(migration).not.toContain("pgbouncer");
    // Everything else survives: credentials, database, ssl, schema.
    expect(migration).toContain("reg:pw@ep-cool-bird-123.eu-central-1.aws.neon.tech/register");
    expect(migration).toContain("sslmode=require");
    expect(migration).toContain("schema=access_register");
  });

  it("leaves a non-pooled string completely alone", () => {
    const plain = must(composeDatabaseUrl({ DATABASE_URL: BARE }));
    expect(toDirectDatabaseUrl(plain)).toBe(plain);
  });
});
