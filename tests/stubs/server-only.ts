// Vitest runs everything as plain Node, with no client/server bundle split
// for Next's real "server-only" package to react to. Alias it to this no-op
// for tests only — see vitest.config.ts. Production and `next build` still
// use the real package, which is what actually enforces the boundary.
export {};
