"use server";

import { redirect } from "next/navigation";
import { authenticateLocal, createSession, destroySession } from "@/lib/auth/session";

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email address and password" };

  const user = await authenticateLocal(email, password);
  if (!user) return { error: "Those credentials were not recognised" };

  await createSession(user);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}
