import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { AppRole } from "@prisma/client";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "ar_session";
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Validate credentials against the local user store.
 *
 * Phase 2 replaces this with an OIDC code exchange against Microsoft Entra;
 * see `src/lib/auth/entra.ts`. Everything downstream of `createSession` is
 * identity-provider agnostic, so only this function changes.
 */
export async function authenticateLocal(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const user = await prisma.appUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  // Always run a hash comparison so a missing user and a wrong password take
  // roughly the same time.
  const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
  const ok = await verifyPassword(password, hash);

  if (!user || !user.passwordHash || !user.isActive || !ok) return null;

  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * The current user, or null. Re-reads the AppUser row on every call so a role
 * change or a deactivation takes effect immediately rather than at token
 * expiry — the cookie is proof of authentication, never of authorisation.
 */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;

    const user = await prisma.appUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return null;

    return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
  } catch {
    return null;
  }
}
