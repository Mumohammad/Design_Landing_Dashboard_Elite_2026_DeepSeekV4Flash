// REQUIRES: pnpm add @supabase/ssr (Phase 2 dependency — install before use)
import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Next 16: this file is `proxy.ts` (renamed from middleware.ts).
// Exported function is `proxy`. See the `matcher` export at the bottom.
// M8 / ADR-019: narrowed matcher — ONLY dashboard/module routes.
// Excludes: /auth, /api, /_next, /favicon.ico, /login, /register, /landing, /.

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
  const response = NextResponse.next({ request })

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

  if (!user) {
    const signInUrl = new URL("/auth/sign-in", request.url)
    signInUrl.searchParams.set("returnTo", request.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }

  // 3. Fetch the custom users row (tenant, role, status, lockout, password).
  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id, role, status, must_change_password, locked_until")
    .eq("auth_user_id", user.id)
    .single<UserProfile>()

  if (!profile) {
    // Auth user exists but the custom users row does not — the sync trigger
    // (schema plan) should have created it. Treat as unauthenticated and
    // force sign-out to avoid a half-state.
    await supabase.auth.signOut()
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_PROFILE_NOT_FOUND")
    return NextResponse.redirect(url)
  }

  // 4. Account status checks.
  if (profile.status === "inactive") {
    await supabase.auth.signOut()
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_ACCOUNT_INACTIVE")
    return NextResponse.redirect(url)
  }

  if (
    profile.status === "locked" &&
    profile.locked_until &&
    new Date(profile.locked_until).getTime() > Date.now()
  ) {
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_ACCOUNT_LOCKED")
    return NextResponse.redirect(url)
  }

  // 5. Must-change-password gate.
  if (profile.must_change_password) {
    const pathname = request.nextUrl.pathname
    const allowed = "/settings/security"
    if (!pathname.startsWith(allowed)) {
      const url = new URL(allowed, request.url)
      url.searchParams.set("require", "change_password")
      return NextResponse.redirect(url)
    }
  }

  // 6. Role guards for /settings/* subroutes.
  const pathname = request.nextUrl.pathname
  for (const [prefix, allowedRoles] of Object.entries(SETTINGS_ROLE_GUARDS)) {
    if (pathname.startsWith(prefix)) {
      if (!allowedRoles.includes(profile.role)) {
        return NextResponse.rewrite(new URL("/auth/errors/forbidden", request.url))
      }
      break
    }
  }

  // 7. Attach tenant + role headers for downstream Server Components.
  //    (Informational only — NOT a security boundary. RLS is the boundary.)
  response.headers.set("x-tenant-id", profile.tenant_id)
  response.headers.set("x-user-role", profile.role)

  return response
}

export const config = {
  // M8 / ADR-019: narrowed matcher. Only dashboard/module routes.
  // Static assets, /auth, /api, /landing, /login, /register, and / are excluded.
  matcher: [
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
    "/platforms/:path*",
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
