import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { REDIRECTS, toAbsoluteUrl } from "@/lib/redirects"

// ─────────────────────────────────────────────────────────────────────────────
// ALL /auth/sign-out — clears the Supabase session on the deployment that owns
// it (the dashboard deployment), then sends the user to the public landing
// page. Works for GET (links such as the sidebar logout button) and POST.
//
// Acceptance test F: logout must land on
//   https://elite-dashboard-blush.vercel.app/landing
// ─────────────────────────────────────────────────────────────────────────────

async function handle(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(
    toAbsoluteUrl(REDIRECTS.landingUrl, request.nextUrl.origin)
  )
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
