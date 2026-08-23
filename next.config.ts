import type { NextConfig } from "next";

/**
 * Headers with no per-request content (unlike the CSP, which needs a fresh
 * nonce every time and lives in src/middleware.ts instead).
 */
const SECURITY_HEADERS = [
  // Browsers already know from the response, but this stops a downgrade if
  // this ever sat behind a proxy that could serve it over plain HTTP.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Stops a scanner or a browser guessing a JSON export is executable HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt-and-braces alongside the CSP's frame-ancestors for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  // The register's URLs carry vendor and person ids; don't leak them to
  // whatever site a link is clicked through to.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses the camera, microphone, location or payment APIs.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // CSV exports and evidence uploads travel through server actions.
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
