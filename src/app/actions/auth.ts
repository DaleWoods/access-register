"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateLocal, createSession, destroySession } from "@/lib/auth/session";
import { checkIpRateLimit, clientIpFrom, recordLoginAttempt } from "@/lib/auth/rate-limit";

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email address and password" };

  const ip = clientIpFrom(await headers());

  // Checked before touching any account, so a spray across many made-up
  // emails from one machine is stopped even though no single account ever
  // reaches its own lockout threshold.
  const ipLimit = await checkIpRateLimit(ip);
  if (!ipLimit.allowed) {
    return {
      error: `Too many sign-in attempts from this network. Try again in ${ipLimit.retryAfterMinutes} minutes.`,
    };
  }

  const result = await authenticateLocal(email, password);
  await recordLoginAttempt(ip, result.ok);

  if (!result.ok) {
    if (result.reason === "locked") {
      return {
        error: `This account is temporarily locked after repeated failed attempts. Try again in ${result.retryAfterMinutes} minutes, or ask an admin to reset your password.`,
      };
    }
    return { error: "Those credentials were not recognised" };
  }

  await createSession(result.user);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}
