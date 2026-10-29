import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeReturnPath, DASHBOARD_PATH, toAbsoluteUrl } from "@/lib/redirects"

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/confirm — completes ALL Supabase token flows:
//   • email signup confirmation   (token_hash + type=signup)
//   • password recovery           (token_hash + type=recovery)
//   • magic link                  (token_hash + type=magiclink)
//   • email change                (token_hash + type=email_change)
//
// This endpoint is the ONLY place token_hash flows complete, and it must be
// deployed on the DASHBOARD deployment: it writes the session cookies, and
// those cookies are host-scoped (*.vercel.app is on the Public Suffix List).
//
// Supabase URL configuration (Dashboard → Auth → URL Configuration):
//   Site URL  → PUBLIC_DASHBOARD_URL
//   Redirect URLs must include:
//     {PUBLIC_DASHBOARD_URL}/auth/confirm
//     {PUBLIC_DASHBOARD_URL}/auth/callback
//     {PUBLIC_DASHBOARD_URL}/auth/reset-password
// and every email template must point at {PUBLIC_DASHBOARD_URL}/auth/confirm.
//
// Query params:
//   token_hash, type — required (standard Supabase OTP params)
//   returnTo         — optional relative path; user lands there after
//                      confirmation (relative paths only, open-redirect-safe)
//   next             — legacy alias of returnTo
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "signup"
    | "recovery"
    | "magiclink"
    | "email_change"
    | null

  const landingFallback = toAbsoluteUrl(`/auth/sign-in?error=auth_link_invalid`, origin)
  const returnTo = safeReturnPath(
    searchParams.get("returnTo") ?? searchParams.get("next") ?? DASHBOARD_PATH
  )

  if (!tokenHash || !type) {
    // Malformed link — send the visitor to the public landing page.
    return NextResponse.redirect(landingFallback)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    // Expired or already-used link — back to sign-in with an error marker
    // (the sign-in page maps ?error codes to friendly messages).
    return NextResponse.redirect(
      toAbsoluteUrl(`/auth/sign-in?error=auth_link_expired`, origin)
    )
  }

  // For recovery links, land the user on the reset-password form (still on
  // the dashboard deployment, where the fresh session cookie lives).
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/auth/reset-password`)
  }

  return NextResponse.redirect(`${origin}${returnTo}`)
}
