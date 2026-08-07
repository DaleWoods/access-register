import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/auth/policy";
import { signOut } from "@/app/actions/auth";

export const metadata: Metadata = {
  title: "Third-Party Access Register",
  description: "Who has access to what, at what level, since when, and whether they should still have it.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/register", label: "Register" },
  { href: "/people", label: "People" },
  { href: "/import", label: "Import" },
  { href: "/vendors", label: "Vendors" },
  { href: "/leavers", label: "Leavers" },
  { href: "/reviews", label: "Reviews" },
  { href: "/audit", label: "Audit trail" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en-GB">
      <body className="min-h-screen">
        {user ? (
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
              <Link href="/" className="text-sm font-bold tracking-tight">
                Access Register
              </Link>
              <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href} className="text-slate-600 hover:text-slate-900">
                    {item.label}
                  </Link>
                ))}
                {user.role === "ADMIN" ? (
                  <Link href="/admin" className="text-slate-600 hover:text-slate-900">
                    Admin
                  </Link>
                ) : null}
              </nav>
              <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                <span>
                  {user.fullName}
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                    {ROLE_LABELS[user.role]}
                  </span>
                </span>
                <form action={signOut}>
                  <button type="submit" className="text-slate-600 hover:text-slate-900">
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>
        ) : null}
        <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
