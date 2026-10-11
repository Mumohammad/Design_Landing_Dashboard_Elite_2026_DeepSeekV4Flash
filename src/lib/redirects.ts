// ─────────────────────────────────────────────────────────────────────────────
// Centralized cross-deployment routing configuration — the SINGLE source of
// truth for every redirect in the app.
//
// This app is deployed as TWO Vercel projects from the same repository:
//
//   1. LANDING deployment  (https://elite-dashboard-blush.vercel.app)
//      — public marketing + auth ENTRY points only. It must NEVER serve
//        /dashboard and must NEVER own a Supabase session.
//
//   2. DASHBOARD deployment (https://elite-dashboard-n9cpw9utj-elitesaasc-5643.vercel.app)
//      — the authenticated application. ALL auth flows complete here, because
//        Supabase SSR session cookies are host-scoped and *.vercel.app is on
//        the Public Suffix List: a cookie set on the landing host can never be
//        read by the dashboard host.
//
// RESOLUTION RULES
//   • DEPLOYMENT_ROLE set ("landing" | "dashboard") → multi-deployment mode:
//       PUBLIC_LANDING_URL   (full URL incl. path) or the production default
//       PUBLIC_DASHBOARD_URL (origin only)          or the production default
//     Every redirect this module produces is ABSOLUTE and resolves exactly to:
//       https://elite-dashboard-blush.vercel.app/landing
//       https://elite-dashboard-n9cpw9utj-elitesaasc-5643.vercel.app/dashboard
//   • DEPLOYMENT_ROLE unset → single-host mode (local dev, previews, sandbox):
//       every value is a RELATIVE same-origin path, and the server-side
//       next.config redirects / proxy keep single-host behavior intact.
//
// CLIENT SAFETY: client components may import this module. Non-NEXT_PUBLIC env
// vars are not inlined into client bundles, so client code transparently gets
// the relative (single-host) values — which is always safe, because the
// server-side redirects (next.config / proxy / route handlers) enforce the
// correct absolute destinations.
// ─────────────────────────────────────────────────────────────────────────────

export const DEPLOYMENT_ROLE = process.env.DEPLOYMENT_ROLE
export const IS_LANDING_DEPLOYMENT = DEPLOYMENT_ROLE === "landing"
export const IS_DASHBOARD_DEPLOYMENT = DEPLOYMENT_ROLE === "dashboard"

// Client bundles cannot read DEPLOYMENT_ROLE (it is not NEXT_PUBLIC), but they
// CAN see NEXT_PUBLIC_DASHBOARD_URL / NEXT_PUBLIC_LANDING_URL. When those are
// present the client is running under the two-deployment topology and client
// redirects must be ABSOLUTE; otherwise (local dev, previews, sandbox) the
// relative same-origin values are used.
const HAS_CLIENT_ORIGINS =
  Boolean(process.env.NEXT_PUBLIC_DASHBOARD_URL) &&
  Boolean(process.env.NEXT_PUBLIC_LANDING_URL)

/** True in the two-Vercel-project production topology; false in single-host mode. */
export const IS_MULTI_DEPLOYMENT =
  Boolean(DEPLOYMENT_ROLE) || HAS_CLIENT_ORIGINS

// Production values required by the routing spec (used when DEPLOYMENT_ROLE is
// set and the corresponding env var is missing — fail-closed to the exact
// production URLs rather than a relative path that could hit the wrong host).
const PROD_LANDING_URL = "https://elite-dashboard-blush.vercel.app/landing"
const PROD_DASHBOARD_ORIGIN = "https://elite-dashboard-n9cpw9utj-elitesaasc-5643.vercel.app"

const LANDING_PATH = process.env.PUBLIC_LANDING_PATH ?? "/landing"
export const DASHBOARD_PATH = process.env.DASHBOARD_PATH ?? "/dashboard"

// Parse PUBLIC_LANDING_URL (may be origin-only or include the /landing path).
function landingUrlFromEnv(raw: string): string {
  try {
    const parsed = new URL(raw)
    const path = parsed.pathname.replace(/\/$/, "")
    return `${parsed.origin}${path || LANDING_PATH}`
  } catch {
    return raw.replace(/\/$/, "")
  }
}

const landingEnv =
  process.env.PUBLIC_LANDING_URL ??
  process.env.NEXT_PUBLIC_LANDING_URL ??
  process.env.NEXT_PUBLIC_SITE_URL
const dashboardEnv =
  process.env.PUBLIC_DASHBOARD_URL ?? process.env.NEXT_PUBLIC_DASHBOARD_URL

const landingUrl = IS_MULTI_DEPLOYMENT
  ? landingUrlFromEnv(landingEnv ?? PROD_LANDING_URL)
  : LANDING_PATH

const dashboardOrigin = IS_MULTI_DEPLOYMENT
  ? (dashboardEnv ?? PROD_DASHBOARD_ORIGIN).replace(/\/$/, "")
  : ""

export const REDIRECTS = {
  /** Public marketing entry point. */
  landingUrl,
  /** Marketing auth entry. Keeps host-scoped sessions on the existing auth host. */
  platformUrl: IS_MULTI_DEPLOYMENT ? `${new URL(landingUrl).origin}/platform` : "/platform",
  /** The one and only dashboard destination (requirement: never blush/dashboard). */
  dashboardUrl: `${dashboardOrigin}${DASHBOARD_PATH}`,
  /** Sign-in — lives on the DASHBOARD deployment in multi-deployment mode. */
  signInUrl: `${dashboardOrigin}/auth/sign-in`,
  /** Company registration — a public auth entry point on the LANDING deployment. */
  registerUrl: "/platform/register",
  /** OAuth (PKCE) completion — MUST run on the dashboard deployment. */
  authCallbackUrl: `${dashboardOrigin}/auth/callback`,
  /** Email confirmation / recovery / magic-link token completion (dashboard). */
  authConfirmUrl: `${dashboardOrigin}/auth/confirm`,
  /** Password reset form (dashboard — the fresh session cookie lives there). */
  authResetPasswordUrl: `${dashboardOrigin}/auth/reset-password`,
  /** Invite acceptance form (dashboard). */
  authAcceptInviteUrl: `${dashboardOrigin}/auth/accept-invite`,
  /** Logout sink — clears cookies on the dashboard, then → landing. */
  signOutUrl: `${dashboardOrigin}/auth/sign-out`,
} as const

/** Carry a non-secret language preference across independent deployment hosts. */
export function withLocale(url: string, locale: "ar" | "en"): string {
  const parsed = new URL(url, "https://relative.invalid")
  parsed.searchParams.set("lang", locale)
  return /^https?:\/\//i.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/**
 * Resolve a possibly-relative redirect target against the request origin.
 * Server-side only (proxy, route handlers): in single-host mode REDIRECTS
 * values are relative and must be made absolute for NextResponse.redirect().
 */
export function toAbsoluteUrl(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `${origin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`
}

/**
 * Absolute Supabase email-link redirectTo target.
 *
 * Supabase only accepts redirectTo values that are registered in its Redirect
 * URLs allow-list, and it requires them to be absolute (scheme + host).
 * Use this for resetPasswordForEmail / signInWithOtp / signInWithOAuth.
 */
export function authCallbackUrlWithReturn(): string {
  if (/^https?:\/\//i.test(REDIRECTS.authConfirmUrl)) {
    return REDIRECTS.authConfirmUrl
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/confirm`
  }
  return REDIRECTS.authConfirmUrl
}

/** Attach ?returnTo=… to the landing URL (open-redirect-safe). */
export function landingUrlWithReturn(returnTo?: string | null): string {
  if (!returnTo) return REDIRECTS.landingUrl
  // Only same-site relative paths are eligible as return targets.
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return REDIRECTS.landingUrl
  }
  const joiner = REDIRECTS.landingUrl.includes("?") ? "&" : "?"
  return `${REDIRECTS.landingUrl}${joiner}returnTo=${encodeURIComponent(returnTo)}`
}

/** Validate a returnTo/query-provided path (relative, same-site only). */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value) return DASHBOARD_PATH
  if (!value.startsWith("/") || value.startsWith("//")) return DASHBOARD_PATH
  return value
}
