import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runDailyDigest } from "@/lib/notifications/digest";

/**
 * Triggered once a day by a GitHub Actions schedule (see
 * .github/workflows/daily-digest.yml) — this app has no built-in scheduler,
 * so something external has to call in. Protected by a shared secret rather
 * than a session, since the caller is not a signed-in user.
 */

export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });

  const summary = await runDailyDigest();
  return Response.json(summary);
}
