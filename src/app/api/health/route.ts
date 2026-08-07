import { prisma } from "@/lib/db";

/**
 * Unauthenticated health check for the platform load balancer.
 *
 * It touches the database, because a web process that cannot reach Postgres is
 * not healthy in any useful sense. It deliberately reveals nothing else.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "database unavailable" }, { status: 503 });
  }
}
