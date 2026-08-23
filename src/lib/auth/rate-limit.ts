import "server-only";
import { prisma } from "@/lib/db";

/**
 * Login abuse controls.
 *
 * Two independent limits, because they stop different attacks:
 *   - Per-account lockout stops someone brute-forcing one known email
 *     (typically an admin's).
 *   - Per-IP rate limiting stops someone spraying many guesses across many
 *     emails from one machine, which per-account lockout alone does not catch.
 *
 * Both fail closed: if the database is briefly unreachable, sign-in is
 * refused rather than silently unlimited.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const IP_WINDOW_MINUTES = 15;
const MAX_IP_ATTEMPTS = 20;

/** How long LoginAttempt rows are kept before they are eligible for cleanup. */
const RETENTION_HOURS = 24;

export type IpRateLimitResult = { allowed: true } | { allowed: false; retryAfterMinutes: number };

/**
 * Best-effort client IP. Render sits in front of the app, so this trusts the
 * platform's X-Forwarded-For rather than the raw socket. That is a real trust
 * boundary — it would be spoofable if the app were reachable without going
 * through Render's proxy — but this deployment never is.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export async function checkIpRateLimit(ip: string): Promise<IpRateLimitResult> {
  const windowStart = new Date(Date.now() - IP_WINDOW_MINUTES * 60_000);

  const [failedCount] = await Promise.all([
    prisma.loginAttempt.count({
      where: { ip, succeeded: false, attemptedAt: { gte: windowStart } },
    }),
    // Opportunistic cleanup, cheap at this volume and avoids a separate job.
    prisma.loginAttempt.deleteMany({
      where: { attemptedAt: { lt: new Date(Date.now() - RETENTION_HOURS * 3_600_000) } },
    }),
  ]);

  if (failedCount < MAX_IP_ATTEMPTS) return { allowed: true };
  return { allowed: false, retryAfterMinutes: IP_WINDOW_MINUTES };
}

export async function recordLoginAttempt(ip: string, succeeded: boolean): Promise<void> {
  await prisma.loginAttempt.create({ data: { ip, succeeded } });
}

export type AccountLockState =
  | { locked: false }
  | { locked: true; retryAfterMinutes: number };

/** Whether this account is currently locked out, independent of the password given. */
export function accountLockState(lockedUntil: Date | null, now = new Date()): AccountLockState {
  if (!lockedUntil || lockedUntil <= now) return { locked: false };
  const retryAfterMinutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000));
  return { locked: true, retryAfterMinutes };
}

/**
 * Wrong password: bump the counter, and lock the account if it just tipped
 * over. Returns the resulting lock state so the attempt that causes the lock
 * can report it immediately, rather than the person only finding out on a
 * sixth try.
 */
export async function registerFailedAttempt(userId: string): Promise<AccountLockState> {
  const user = await prisma.appUser.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });

  if (user.failedLoginAttempts < MAX_FAILED_ATTEMPTS) return { locked: false };

  const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
  await prisma.appUser.update({ where: { id: userId }, data: { lockedUntil } });
  return { locked: true, retryAfterMinutes: LOCKOUT_MINUTES };
}

/** Correct password: the slate is clean. */
export async function registerSuccessfulAttempt(userId: string): Promise<void> {
  await prisma.appUser.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
