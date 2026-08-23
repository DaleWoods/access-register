import { NextResponse, type NextRequest } from "next/server";

/**
 * A strict, per-request Content-Security-Policy.
 *
 * This is the documented Next.js App Router pattern: generate a nonce, put it
 * in the CSP response header, and forward it to the request so the framework
 * stamps its own inline scripts (RSC payload bootstrapping, etc.) with the
 * same nonce. `strict-dynamic` then lets those nonce'd scripts load further
 * scripts without listing every hostname, while anything an attacker injects
 * — without the nonce — is refused.
 *
 * script-src has no 'unsafe-inline': nothing in this app writes an inline
 * <script> by hand, so there is nothing to weaken it for. style-src keeps
 * 'unsafe-inline' because a couple of progress-bar widths are set via the
 * style attribute — a far smaller risk than an inline script, and not worth
 * a nonce plumbed through client components for.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    font-src 'self';
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Every route except static assets and the Next.js image optimiser, which
    // do not render HTML and gain nothing from a per-request nonce.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
