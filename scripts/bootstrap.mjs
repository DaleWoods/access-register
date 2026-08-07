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

const log = (message) => console.log(`[bootstrap] ${message}`);

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — cannot start");
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters — cannot start");
  }

  log("applying database migrations");
  run("npx", ["prisma", "migrate", "deploy"]);

  const prisma = new PrismaClient();
  try {
    const adminCount = await prisma.appUser.count({ where: { role: "ADMIN", isActive: true } });

    if (adminCount === 0) {
      const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";

      if (!email || password.length < 12) {
        log(
          "WARNING: no active admin exists and BOOTSTRAP_ADMIN_EMAIL / " +
            "BOOTSTRAP_ADMIN_PASSWORD (12+ chars) are not both set. " +
            "Nobody will be able to sign in.",
        );
      } else {
        // Upsert rather than create: the address may already exist with a
        // non-admin role, or from a previous partial deploy.
        await prisma.appUser.upsert({
          where: { email },
          create: {
            email,
            fullName: process.env.BOOTSTRAP_ADMIN_NAME ?? "Administrator",
            role: "ADMIN",
            passwordHash: await bcrypt.hash(password, 12),
          },
          update: {
            role: "ADMIN",
            isActive: true,
            passwordHash: await bcrypt.hash(password, 12),
          },
        });
        log(`admin account ready: ${email}`);
      }
    } else {
      log(`${adminCount} active admin(s) already present, leaving accounts alone`);
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
