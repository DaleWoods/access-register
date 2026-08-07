/**
 * Deploy-time bootstrap. Runs on every start, before the server accepts traffic.
 *
 * Everything here is idempotent, because a platform restart re-runs it:
 *   1. Apply any pending database migrations.
 *   2. Make sure there is an admin account to sign in as — a freshly
 *      provisioned database has no users, which would lock everyone out.
 *   3. Optionally load the demo data, for a first look at a new deployment.
 *
 * Plain JavaScript on purpose: it runs before the app does, with no build step
 * and no TypeScript loader in the path.
 */

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  composeDatabaseUrl,
  redactDatabaseUrl,
  toDirectDatabaseUrl,
} from "../src/lib/database-url.mjs";

const log = (message) => console.log(`[bootstrap] ${message}`);

/**
 * Long enough to survive a public URL with no rate limiting in front of it.
 * The admin account can do everything, including reading every name and email
 * address in the register.
 */
const MIN_ADMIN_PASSWORD_LENGTH = 12;

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

/**
 * Missing configuration is the single most common reason a first deploy fails,
 * and a stack trace buried in a deploy log is a poor way to find that out. Say
 * plainly what is missing and what to do about it.
 */
function configurationError(lines) {
  console.error(`\n${"=".repeat(72)}`);
  for (const line of lines) console.error(line);
  console.error(`${"=".repeat(72)}\n`);
  process.exit(1);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    configurationError([
      "DATABASE_URL is not set, so the app cannot start.",
      "",
      "It has to be set by hand once. Render only prompts for a sync: false",
      "value during an interactive Blueprint Apply, never on a git push, and",
      "fromDatabase does not resolve a database owned by another Blueprint.",
      "",
      "In the Render dashboard:",
      "  1. Open the database → Connect → copy the Internal Database URL.",
      "  2. Open this service → Environment → add DATABASE_URL and paste it",
      "     exactly as given. No query string to add: this app puts its tables",
      "     in the `access_register` schema on its own.",
      "  3. Manual Deploy → Deploy latest commit.",
      "",
      "The service and the database must be in the same region for an internal",
      "URL to resolve. Otherwise use the External Database URL instead.",
      "",
      "See README.md → Deploying to Render.",
    ]);
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    configurationError([
      "AUTH_SECRET is missing or shorter than 32 characters, so session cookies",
      "cannot be signed and the app will not start.",
      "",
      "render.yaml declares `generateValue: true` for it, so Render normally",
      "creates one automatically. If it is empty, set it manually under",
      "Environment to any random 32+ character string:",
      "  openssl rand -hex 32",
    ]);
  }

  // Everything below — the Prisma CLI, the seed, and this script's own client —
  // reads DATABASE_URL from the environment, so compose it once here and let
  // child processes inherit it.
  //
  // Migrations and seeding go to the direct endpoint: Prisma Migrate cannot run
  // through a transaction-mode pooler. The web server is a separate process and
  // composes its own URL, so it keeps using the pooled endpoint at runtime.
  const runtimeUrl = composeDatabaseUrl();
  process.env.DATABASE_URL = toDirectDatabaseUrl(runtimeUrl);
  log(`database: ${redactDatabaseUrl(process.env.DATABASE_URL)}`);

  log("applying database migrations");
  run("npx", ["prisma", "migrate", "deploy"]);

  const prisma = new PrismaClient();
  try {
    // Make sure the *named* admin exists. Checking for "any admin at all"
    // would be wrong: once demo data has created one, the person the
    // deployment is actually for would never get an account.
    const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";

    if (email) {
      const existing = await prisma.appUser.findUnique({ where: { email } });

      if (!existing) {
        // A register nobody can sign in to is not a working deployment, so a
        // password too weak to create the account fails the deploy rather than
        // warning and coming up green.
        if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
          configurationError([
            `BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
            password.length === 0
              ? "It is not set at all."
              : `The current value is ${password.length} character(s) long.`,
            "",
            `There is no account for ${email} yet, and it cannot be created`,
            "with that password. An admin can read every name and email address",
            "in the register, and this app is reachable on a public URL with no",
            "rate limiting, so a short password is not survivable.",
            "",
            "In the Render dashboard:",
            "  1. Open this service → Environment → BOOTSTRAP_ADMIN_PASSWORD.",
            "  2. Set a value of 12 characters or more. Use Generate rather than",
            "     choosing one, then copy it — it is shown nowhere else.",
            "  3. Manual Deploy → Deploy latest commit.",
            "",
            "If demo data is loaded you can also sign in as admin@wosg.example",
            "using the SEED_PASSWORD value, which is already a full admin.",
          ]);
        }

        await prisma.appUser.create({
          data: {
            email,
            fullName: process.env.BOOTSTRAP_ADMIN_NAME ?? "Administrator",
            role: "ADMIN",
            passwordHash: await bcrypt.hash(password, 12),
          },
        });
        log(`admin account created: ${email}`);
      } else if (existing.role !== "ADMIN" || !existing.isActive) {
        // Restore access without touching the password — it may have been
        // changed in the app since, and a deploy should not undo that.
        await prisma.appUser.update({
          where: { email },
          data: { role: "ADMIN", isActive: true },
        });
        log(`existing account promoted to active admin: ${email}`);
      } else {
        log(`admin account already present, password left alone: ${email}`);
      }
    }

    const adminCount = await prisma.appUser.count({ where: { role: "ADMIN", isActive: true } });
    if (adminCount === 0) {
      configurationError([
        "There are no active admin accounts, so nobody can sign in.",
        "",
        "Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD under",
        `Environment (${MIN_ADMIN_PASSWORD_LENGTH}+ characters), then Manual Deploy.`,
      ]);
    }

    // Demo data is only ever loaded into an empty register, so it can never
    // contaminate real data on a later restart.
    if (process.env.SEED_DEMO_DATA === "true") {
      const vendorCount = await prisma.vendor.count();
      if (vendorCount === 0) {
        log("empty register and SEED_DEMO_DATA=true — loading demo data");
        run("npx", ["tsx", "prisma/seed.ts"]);
      } else {
        log(`register already holds ${vendorCount} vendor(s) — skipping demo data`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  log("ready");
}

main().catch((error) => {
  console.error("[bootstrap] failed:", error);
  process.exit(1);
});
