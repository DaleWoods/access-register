"use client";

import Link from "next/link";

/**
 * Last-resort boundary. Next.js hides server error messages from the client in
 * production, so this stays deliberately generic — the detail is in the server
 * logs, and permission refusals are handled with a proper page rather than
 * being allowed to reach here.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-16 max-w-lg">
      <div className="card p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          That action could not be completed. Nothing has been changed — imports and edits are
          transactional, so a failure leaves the register exactly as it was.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-slate-400">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
