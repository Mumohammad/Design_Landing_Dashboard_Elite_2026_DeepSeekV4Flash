// REQUIRES: pnpm add @supabase/ssr (Phase 2 dependency — install before use)
import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import crypto from "crypto"
import { safeReturnPath, withLocale } from "@/lib/redirects"

// Next 16: this file is `proxy.ts` (renamed from middleware.ts).
// Exported function is `proxy`. See the `matcher` export at the bottom.
// M8 / ADR-019: narrowed matcher — dashboard/module and platform-admin routes.
// Also handles /auth/sign-in to reuse verified sessions. Other public routes
// and assets remain outside the authentication boundary.

type UserProfile = {
  id: string
  tenant_id: string
  role: string
  status: "active" | "inactive" | "locked"
  must_change_password: boolean
  locked_until: string | null
}

const SETTINGS_ROLE_GUARDS: Record<string, string[]> = {
  "/settings/users": ["general_manager"],
  "/settings/company": ["general_manager"],
  "/settings/security/policy": ["general_manager"],
  "/settings/compliance": ["general_manager"],
  "/settings/system": ["general_manager"],
  "/settings/audit": ["general_manager", "admin", "accountant"],
  "/settings/security/sessions": ["general_manager", "admin"],
}

export async function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID()
  let response = NextResponse.next({ request })
  response.headers.set("X-Request-ID", requestId)
  // Every branch must return refreshed/cleared cookies, including redirects
  // to MFA and sign-in. Otherwise the next request can reuse a stale session.
  const finish = (next: NextResponse = response) => {
    for (const cookie of response.cookies.getAll()) next.cookies.set(cookie)
    next.headers.set("X-Request-ID", requestId)
    next.headers.set("Cache-Control", "private, no-store")
    next.headers.set("Pragma", "no-cache")
    next.headers.set("Expires", "0")
    return next
  }

  // 1. Create the SSR server client bound to this request's cookies.
  //    setAll writes refreshed session cookies back to the response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          const previous = response.cookies.getAll()
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          // Forward refreshed request cookies to Server Components too.
          response = NextResponse.next({ request })
          previous.forEach(cookie => response.cookies.set(cookie))
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // 2. Read the session. getUser() validates the JWT server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (request.nextUrl.pathname === "/auth/sign-in") {
    if (user && !request.nextUrl.searchParams.has("error")) {
      let destination = safeReturnPath(request.nextUrl.searchParams.get("returnTo"))
      const locale = request.nextUrl.searchParams.get("lang")
      if (locale === "en" || locale === "ar") destination = withLocale(destination, locale)
      return finish(NextResponse.redirect(new URL(destination, request.url)))
    }
    return finish()
  }

  if (!user) {
    const signInUrl = new URL("/auth/sign-in", request.url)
    signInUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return finish(NextResponse.redirect(signInUrl))
  }

  const pathname = request.nextUrl.pathname

  // Platform administrators are allowlisted independently of tenant roles.
  // Require a verified AAL2 session before rendering any console page.
  if (pathname.startsWith("/platform/admin")) {
    const { data: platformAdmin, error: platformAdminError } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (platformAdminError || !platformAdmin) {
      return finish(NextResponse.rewrite(new URL("/auth/errors/forbidden", request.url)))
    }

    const { data: aal, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (aalError || !aal) {
      const url = new URL("/auth/errors/internal-server-error", request.url)
      url.searchParams.set("error", "MFA_ASSURANCE_UNAVAILABLE")
      url.searchParams.set("returnTo", pathname)
      return finish(NextResponse.redirect(url))
    }

    if (aal.currentLevel !== "aal2") {
      if (aal.nextLevel === "aal2") {
        const url = new URL("/auth/mfa-challenge", request.url)
        url.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`)
        return finish(NextResponse.redirect(url))
      }
      const url = new URL("/auth/errors/forbidden", request.url)
      url.searchParams.set("error", "MFA_ENROLLMENT_REQUIRED")
      return finish(NextResponse.redirect(url))
    }

    return finish()
  }

  // 3. Fetch the custom users row (tenant, role, status, lockout, password).
  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id, role, status, must_change_password, locked_until")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .single<UserProfile>()

  if (!profile) {
    // Auth user exists but the custom users row does not — the sync trigger
    // (schema plan) should have created it. Treat as unauthenticated and
    // force sign-out to avoid a half-state.
    await supabase.auth.signOut()
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_PROFILE_NOT_FOUND")
    return finish(NextResponse.redirect(url))
  }

  // 4. Account status checks.
  if (profile.status === "inactive") {
    await supabase.auth.signOut()
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_ACCOUNT_INACTIVE")
    return finish(NextResponse.redirect(url))
  }

  if (
    profile.status === "locked" &&
    profile.locked_until &&
    new Date(profile.locked_until).getTime() > Date.now()
  ) {
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_ACCOUNT_LOCKED")
    return finish(NextResponse.redirect(url))
  }

  // Path of the current request — shared by the gates below (declared once).
  // 5. Must-change-password gate.
  if (profile.must_change_password) {
    const allowed = "/settings/security"
    if (!pathname.startsWith(allowed)) {
      const url = new URL(allowed, request.url)
      url.searchParams.set("require", "change_password")
      return finish(NextResponse.redirect(url))
    }
  }

  // 5.5. MFA gate (AAL2) — enforces the TOTP layer at the routing boundary.
  //
  //    getAuthenticatorAssuranceLevel() semantics:
  //      - nextLevel === "aal2" ONLY when the user holds a verified TOTP factor
  //      - currentLevel === "aal1" means the session never stepped up
  //
  //    Rules:
  //      a) Verified factor + session still aal1 → force /auth/mfa-challenge
  //         (step-up) before any module page. That page is outside this
  //         proxy's matcher and no-ops to /dashboard when no verified factor
  //         exists — so no redirect loop is possible.
  //      b) Privileged roles (general_manager, admin) with NO verified factor
  //         → pushed to /settings/mfa to enroll (that route is exempted below
  //         so enrollment itself is never blocked).
  //
  //    Failure mode: all assurance lookup failures fail closed.
  if (pathname !== "/auth/mfa-challenge" && pathname !== "/settings/mfa") {
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const privileged = profile.role === "general_manager" || profile.role === "admin"

    if (aalError || !aal) {
      const url = new URL("/auth/errors/internal-server-error", request.url)
      url.searchParams.set("error", "MFA_ASSURANCE_UNAVAILABLE")
      url.searchParams.set("returnTo", pathname)
      return finish(NextResponse.redirect(url))
    } else {
      const hasVerifiedFactor = aal.nextLevel === "aal2"

      if (hasVerifiedFactor && aal.currentLevel === "aal1") {
        const url = new URL("/auth/mfa-challenge", request.url)
        url.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`)
        return finish(NextResponse.redirect(url))
      }

      if (privileged && !hasVerifiedFactor) {
        const url = new URL("/settings/mfa", request.url)
        url.searchParams.set("require", "mfa_enroll")
        return finish(NextResponse.redirect(url))
      }
    }
  }

  // 6. Role guards for /settings/* subroutes.
  for (const [prefix, allowedRoles] of Object.entries(SETTINGS_ROLE_GUARDS)) {
    if (pathname.startsWith(prefix)) {
      if (!allowedRoles.includes(profile.role)) {
        return finish(NextResponse.rewrite(new URL("/auth/errors/forbidden", request.url)))
      }
      break
    }
  }

  return finish()
}

export const config = {
  // M8 / ADR-019: narrowed matcher. Dashboard/module + platform-admin routes.
  // Static assets, other /auth pages, /api and marketing pages are excluded.
  matcher: [
    "/auth/sign-in",
    "/dashboard/:path*",
    "/drivers/:path*",
    "/vehicles/:path*",
    "/attendance/:path*",
    "/payroll/:path*",
    "/violations/:path*",
    "/expenses/:path*",
    "/maintenance/:path*",
    "/invoices/:path*",
    "/accounting/:path*",
    "/orders/:path*",
    "/payments/:path*",
    "/approvals/:path*",
    "/platforms/:path*",
    "/platform/admin/:path*",
    "/hr/:path*",
    "/applications/:path*",
    "/templates/:path*",
    "/reports/:path*",
    "/users/:path*",
    "/roles/:path*",
    "/audit-log/:path*",
    "/security/:path*",
    "/settings/:path*",
  ],
}
