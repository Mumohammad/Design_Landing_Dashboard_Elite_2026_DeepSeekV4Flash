import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeReturnPath, DASHBOARD_PATH, toAbsoluteUrl } from "@/lib/redirects"

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/callback — completes OAuth (PKCE) sign-in.
//
// Must run on the DASHBOARD deployment: this is where `exchangeCodeForSession`
// writes the host-scoped session cookies. The OAuth provider's redirect URL
// must therefore be exactly:
//     {PUBLIC_DASHBOARD_URL}/auth/callback
// (also registered in Supabase → Auth → URL Configuration → Redirect URLs).
//
// Query params:
//   code     — PKCE authorization code from Supabase Auth
//   returnTo — optional relative path to land on after sign-in
//   next     — legacy alias of returnTo
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")

  const landingFallback = toAbsoluteUrl(`/auth/sign-in?error=auth_link_invalid`, origin)
  const returnTo = safeReturnPath(
    searchParams.get("returnTo") ?? searchParams.get("next") ?? DASHBOARD_PATH
  )

  if (!code) {
    return NextResponse.redirect(landingFallback)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      toAbsoluteUrl(`/auth/sign-in?error=auth_link_expired`, origin)
    )
  }

  return NextResponse.redirect(`${origin}${returnTo}`)
}
