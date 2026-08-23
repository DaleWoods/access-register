import { beforeEach, describe, expect, it } from "vitest";
import { accountLockState, checkIpRateLimit, clientIpFrom, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { authenticateLocal, hashPassword } from "@/lib/auth/session";
import { prisma, resetDatabase } from "./helpers";

/**
 * The register is a public URL holding real people's access data, with no
 * proxy-level protection of its own. These are the two controls standing
 * between that and a brute-forced admin account.
 */

describe("clientIpFrom", () => {
  it("reads the first hop of X-Forwarded-For", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientIpFrom(headers)).toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP, then to a placeholder", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("accountLockState", () => {
  const now = new Date("2026-08-23T12:00:00Z");

  it("is unlocked with no lockedUntil", () => {
    expect(accountLockState(null, now)).toEqual({ locked: false });
  });

  it("is unlocked once the lock has expired", () => {
    expect(accountLockState(new Date("2026-08-23T11:59:00Z"), now)).toEqual({ locked: false });
  });

  it("reports minutes remaining while locked", () => {
    const result = accountLockState(new Date("2026-08-23T12:10:00Z"), now);
    expect(result).toEqual({ locked: true, retryAfterMinutes: 10 });
  });
});

describe("per-IP rate limiting", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows attempts under the threshold and blocks past it", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 19; i++) await recordLoginAttempt(ip, false);

    expect((await checkIpRateLimit(ip)).allowed).toBe(true);

    await recordLoginAttempt(ip, false); // 20th
    const blocked = await checkIpRateLimit(ip);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMinutes).toBeGreaterThan(0);
  });

  it("does not let one IP's failures block a different IP", async () => {
    const attacker = "198.51.100.7";
    const bystander = "198.51.100.8";
    for (let i = 0; i < 25; i++) await recordLoginAttempt(attacker, false);

    expect((await checkIpRateLimit(attacker)).allowed).toBe(false);
    expect((await checkIpRateLimit(bystander)).allowed).toBe(true);
  });

  it("does not count successful attempts against the limit", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < 30; i++) await recordLoginAttempt(ip, true);
    expect((await checkIpRateLimit(ip)).allowed).toBe(true);
  });
});

describe("account lockout end to end", () => {
  const EMAIL = "lockout-target@wosg.example";
  const PASSWORD = "CorrectHorseBattery9";

  beforeEach(async () => {
    await resetDatabase();
    await prisma.appUser.create({
      data: {
        email: EMAIL,
        fullName: "Lockout Target",
        role: "AUDITOR",
        passwordHash: await hashPassword(PASSWORD),
      },
    });
  });

  it("locks the account after five wrong passwords, even to the right password", async () => {
    for (let i = 0; i < 4; i++) {
      const result = await authenticateLocal(EMAIL, "wrong-password");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid");
    }

    // The fifth wrong attempt is the one that trips the lock, and reports it
    // immediately rather than making the person guess a sixth time.
    const fifth = await authenticateLocal(EMAIL, "wrong-password");
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.reason).toBe("locked");
      if (fifth.reason === "locked") expect(fifth.retryAfterMinutes).toBeGreaterThan(0);
    }

    // Now the *correct* password is also refused. A stolen-but-later-changed
    // password must not walk straight past a lockout that is already active.
    const correctButLocked = await authenticateLocal(EMAIL, PASSWORD);
    expect(correctButLocked.ok).toBe(false);
    if (!correctButLocked.ok) expect(correctButLocked.reason).toBe("locked");
  });

  it("resets the counter on a successful sign-in", async () => {
    await authenticateLocal(EMAIL, "wrong-password");
    await authenticateLocal(EMAIL, "wrong-password");

    const success = await authenticateLocal(EMAIL, PASSWORD);
    expect(success.ok).toBe(true);

    const user = await prisma.appUser.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it("never locks out over a wrong email — there is no account to lock", async () => {
    for (let i = 0; i < 10; i++) {
      const result = await authenticateLocal("nobody@wosg.example", "whatever");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid");
    }
  });
});
