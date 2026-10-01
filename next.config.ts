import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs"
import { buildCsp } from "./src/lib/security/csp"

// ── Cross-deployment routing ─────────────────────────────────────────────────
// Two Vercel projects deploy this repo: a public LANDING deployment and an
// authenticated DASHBOARD deployment. The deployment role is chosen with the
// DEPLOYMENT_ROLE env var (set per-project in Vercel). Unset = single-host
// mode (local dev, previews, the Freebuff sandbox) — no cross-deployment
// redirects are generated at all in that case.
const DEPLOYMENT_ROLE = process.env.DEPLOYMENT_ROLE
const IS_LANDING_DEPLOYMENT = DEPLOYMENT_ROLE === "landing"
// Fail-closed production defaults — never a relative path that could resolve
// to a dashboard route on the LANDING host (forbidden by the routing spec).
const LANDING_URL = (
  process.env.PUBLIC_LANDING_URL ??
  "https://elite-dashboard-blush.vercel.app/landing"
).replace(/\/$/, "")
const DASHBOARD_ORIGIN = (
  process.env.PUBLIC_DASHBOARD_URL ??
  "https://elite-dashboard-n9cpw9utj-elitesaasc-5643.vercel.app"
).replace(/\/$/, "")
const DASHBOARD_URL = `${DASHBOARD_ORIGIN}${process.env.DASHBOARD_PATH ?? "/dashboard"}`
// Relative dashboard path for single-host mode (local dev / previews).
const DASHBOARD_PATH_FALLBACK = process.env.DASHBOARD_PATH ?? "/dashboard"
const LANDING_PATH = LANDING_URL.slice(LANDING_URL.indexOf("://") + 3).split("/").slice(1).length
  ? "/" + LANDING_URL.slice(LANDING_URL.indexOf("://") + 3).split("/").slice(1).join("/")
  : "/landing"
const LANDING_HOST = LANDING_URL.slice(LANDING_URL.indexOf("://") + 3).split("/")[0]


const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
  // Dev-only: allow the Freebuff/Daytona preview proxy hosts to request
  // dev assets and the HMR endpoint. Without this, Next 16 returns 403 for
  // every /_next/* request made through the proxy host (which is not the
  // hostname the dev server was started with). Never used in production.
  allowedDevOrigins: ["daytonaproxy01.net", "**.daytonaproxy01.net"],
  turbopack: {
    // Fix for Turbopack on Windows: multiple lockfiles in parent dirs make
    // Next infer the wrong workspace root, which breaks the PostCSS worker
    // (node exits 0xc0000142 during CSS compile). Pin the project root.
    root: process.platform === 'win32' ? '.' : undefined,
  },


  // NOTE: Locale is handled client-side via LocaleProvider (localStorage +
  // lang/dir attributes). The legacy `i18n` config block was removed — it is
  // unsupported in App Router and generated bogus /ar/* prerender routes.


  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ui.shadcn.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
    formats: ['image/webp', 'image/avif'],
  },


  // Headers for better security and performance
  async headers() {
    const headers = [
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=()',
      },
      {
        key: 'Content-Security-Policy',
        // Single source of truth in src/lib/security/csp.ts — vitest parses
        // the produced header to keep the Supabase img-src origin locked in
        // (Prompt M2 regression guard).
        value: buildCsp({
          isDev: process.env.NODE_ENV === 'development',
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];


    // HSTS is only safe over real HTTPS deployments; skip it on localhost.
    if (process.env.NODE_ENV === 'production') {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }


    return [
      {
        source: '/(.*)',
        headers,
      },
    ];
  },


  // Redirects for better SEO + cross-deployment routing
  async redirects() {
    // Single-host mode (DEPLOYMENT_ROLE unset): local dev, previews, sandbox.
    // Everything stays same-origin — no cross-deployment rules.
    if (!DEPLOYMENT_ROLE) {
      return [      { source: '/', destination: LANDING_PATH, permanent: true },
      { source: '/login', destination: '/auth/sign-in', permanent: false },
      { source: '/register', destination: '/platform/register', permanent: false },
      { source: '/home', destination: DASHBOARD_PATH_FALLBACK, permanent: true },
      // Legacy /dashboard/* module URLs (unified dashboard tree was retired in
      // favour of the grouped (dashboard) route group) — map old paths to the
      // matching module routes so existing bookmarks keep working.
      { source: '/dashboard/analytics', destination: '/reports', permanent: true },
      { source: '/dashboard/drivers', destination: '/drivers', permanent: true },
      { source: '/dashboard/vehicles', destination: '/vehicles', permanent: true },
      { source: '/dashboard/accounting', destination: '/accounting', permanent: true },
      { source: '/dashboard/reports', destination: '/reports', permanent: true },
      { source: '/dashboard/team', destination: '/users', permanent: true },
      { source: '/dashboard/api-keys', destination: '/security', permanent: true },
      { source: '/dashboard/settings', destination: '/settings', permanent: true },
      ]
    }

    if (IS_LANDING_DEPLOYMENT) {
      // ── LANDING deployment: public pages + auth ENTRY only ──────────
      // It must never serve /dashboard or own auth sessions. All auth
      // completion happens on the dashboard deployment (cookies on
      // *.vercel.app are isolated by the Public Suffix List, so a session
      // created here could never be read there).
      return [
        // Any /dashboard request on the landing deployment → the real
        // dashboard deployment. "Wrong-domain /dashboard" becomes
        // structurally impossible (acceptance test J).
        {
          source: '/dashboard',
          destination: DASHBOARD_URL,
          permanent: false,
        },
        {
          source: '/dashboard/:path*',
          destination: `${DASHBOARD_ORIGIN}/dashboard/:path*`,
          permanent: false,
        },
        // Auth entry points forward to the dashboard deployment, where the
        // session cookies will actually live. (Query strings are preserved.)
        {
          source: '/auth/sign-in',
          destination: `${DASHBOARD_ORIGIN}/auth/sign-in`,
          permanent: false,
        },
        {
          source: '/auth/forgot-password',
          destination: `${DASHBOARD_ORIGIN}/auth/forgot-password`,
          permanent: false,
        },
        {
          source: '/auth/reset-password',
          destination: `${DASHBOARD_ORIGIN}/auth/reset-password`,
          permanent: false,
        },
        {
          source: '/auth/mfa-challenge',
          destination: `${DASHBOARD_ORIGIN}/auth/mfa-challenge`,
          permanent: false,
        },
        {
          source: '/auth/accept-invite',
          destination: `${DASHBOARD_ORIGIN}/auth/accept-invite`,
          permanent: false,
        },
        {
          source: '/auth/callback',
          destination: `${DASHBOARD_ORIGIN}/auth/callback`,
          permanent: false,
        },
        {
          source: '/auth/confirm',
          destination: `${DASHBOARD_ORIGIN}/auth/confirm`,
          permanent: false,
        },
        {
          source: '/auth/sign-out',
          destination: `${DASHBOARD_ORIGIN}/auth/sign-out`,
          permanent: false,
        },
        // Legacy/auxiliary entry points.
        { source: '/', destination: LANDING_URL, permanent: true },
        { source: '/login', destination: `${DASHBOARD_ORIGIN}/auth/sign-in`, permanent: false },
        { source: '/register', destination: '/platform/register', permanent: false },
        { source: '/home', destination: DASHBOARD_URL, permanent: true },
      ]
    }

    // ── DASHBOARD deployment (DEPLOYMENT_ROLE=dashboard) ───────────────
    // NOTE: there is deliberately NO static '/landing' redirect here. The
    // proxy (src/proxy.ts) owns /landing on this host: authenticated
    // visitors → /dashboard (requirement E), unauthenticated visitors →
    // the absolute public landing URL. A static redirect would fire before
    // the proxy and break that auth-aware behavior.
    return [
      { source: '/', destination: LANDING_URL, permanent: false },
      { source: '/login', destination: '/auth/sign-in', permanent: false },
      { source: '/register', destination: '/platform/register', permanent: false },
      { source: '/home', destination: DASHBOARD_URL, permanent: true },
      // Legacy /dashboard/* module URLs (unified dashboard tree was retired in
      // favour of the grouped (dashboard) route group) — map old paths to the
      // matching module routes so existing bookmarks keep working.
      { source: '/dashboard/analytics', destination: '/reports', permanent: true },
      { source: '/dashboard/drivers', destination: '/drivers', permanent: true },
      { source: '/dashboard/vehicles', destination: '/vehicles', permanent: true },
      { source: '/dashboard/accounting', destination: '/accounting', permanent: true },
      { source: '/dashboard/reports', destination: '/reports', permanent: true },
      { source: '/dashboard/team', destination: '/users', permanent: true },
      { source: '/dashboard/api-keys', destination: '/security', permanent: true },
      { source: '/dashboard/settings', destination: '/settings', permanent: true },
    ]
  },
};


export default withSentryConfig(nextConfig, {
  // Automatically tree-shake Sentry logger to reduce bundle size
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Auth token for source map uploads (CI only — never commit)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Upload source maps in production builds
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Automatically inject Sentry in all pages and error handlers
  webpack: {
    automaticVercelMonitors: true,
  },
})
