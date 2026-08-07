import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests truncate every table, so they must never point at the dev database.
    // Create it once with:
    //   createdb access_register_test && \
    //   DATABASE_URL=<test url> npx prisma migrate deploy
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://register:register@localhost:5432/access_register_test?schema=public",
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The acceptance tests share one Postgres database, so they must not race.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
