import { PrismaClient } from "@prisma/client";
// Plain JS helper, shared with the deploy bootstrap which runs under bare
// node before any build step exists.
import { composeDatabaseUrl } from "./database-url.mjs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Applies the schema and connection-limit parameters when the platform
    // supplies a bare connection string. See database-url.mjs.
    datasourceUrl: composeDatabaseUrl() ?? undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Transaction client type, for helpers that must run inside an import commit. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
