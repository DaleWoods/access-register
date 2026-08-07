import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/guards";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");

  const entraConfigured = Boolean(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID);

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">Third-Party Access Register</h1>
      <p className="mt-1 text-sm text-slate-600">
        Who has access to what, at what level, and whether they should still have it.
      </p>

      <div className="card mt-6 p-5">
        <LoginForm />

        <p className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-500">
          {entraConfigured
            ? "Single sign-on with Microsoft Entra is configured."
            : "Single sign-on with Microsoft Entra is a later phase. Local sign-in is the MVP fallback."}
        </p>
      </div>
    </div>
  );
}
