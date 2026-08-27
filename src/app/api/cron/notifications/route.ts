import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runDailyDigest } from "@/lib/notifications/digest";
import { captureSnapshot } from "@/lib/snapshots";

/**
 * The daily job: record a snapshot of the register's headline counts, then
 * send the email digest.
 *
 * Triggered once a day by a GitHub Actions schedule (see
 * .github/workflows/daily-digest.yml) — this app has no built-in scheduler,
 * so something external has to call in. Protected by a shared secret rather
 * than a session, since the caller is not a signed-in user.
 *
 * The snapshot is taken first and independently of email: trend history is
 * worth keeping even on a day when the digest cannot send, and unlike the
 * digest it can never be caught up later.
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

  const snapshot = await captureSnapshot();
  const summary = await runDailyDigest();
  return Response.json({ ...summary, snapshot });
}
