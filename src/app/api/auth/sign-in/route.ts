// POST /api/auth/sign-in — server-side sign-in with SSR cookie session
// (audit fix H2).
//
// Why this route exists: the login form previously called Supabase directly
// from the browser with NO application rate limit (rateLimitSignIn was
// defined but never called). This route:
//   1. Rate-limits per IP FIRST (10/min, shared Postgres/Upstash backend,
//      fail-closed → 503 when the backend is unavailable).
//   2. Establishes the session SERVER-SIDE via @supabase/ssr
//      createServerClient, writing the sb-* auth cookies onto the JSON
//      response. A plain supabase-js call would authenticate but set no
//      cookies — the user would be "signed in" yet bounced back to
//      /auth/sign-in. Acceptance: after a successful POST, /dashboard
//      loads without redirect.
//   3. Returns a single generic AUTH004 envelope on bad credentials —
//      never leaks whether the email exists.
// Supabase's built-in GoTrue rate limits stay enabled underneath as the
// second layer.

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { z } from "zod"
import {
  rateLimitSignIn,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/auth/rate-limit"
import { handleError } from "@/lib/errors"
import { ERROR_CODES } from "@/lib/errors/error-codes"
import { logger } from "@/lib/logger"

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
})

function ipFromRequest(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

function jsonError(
  code: keyof typeof ERROR_CODES,
  status?: number,
  extraHeaders?: Record<string, string>
): NextResponse {
  const def = ERROR_CODES[code]
  return NextResponse.json(
    { code: def.code, message_ar: def.messageAr, message_en: def.messageEn },
    { status: status ?? def.httpStatus, headers: extraHeaders }
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Rate limit FIRST — fail closed (503) if the backend is unavailable.
  const ip = ipFromRequest(req)
  let rl
  try {
    rl = await rateLimitSignIn(ip)
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      const envelope = handleError(err)
      return NextResponse.json(
        {
          code: envelope.code,
          message_ar: envelope.message_ar,
          message_en: envelope.message_en,
        },
        { status: 503 }
      )
    }
    throw err
  }
  if (!rl.success) {
    const e = new RateLimitError(rl.resetAt, 10)
    const envelope = handleError(e)
    return NextResponse.json(
      {
        code: envelope.code,
        message_ar: envelope.message_ar,
        message_en: envelope.message_en,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(Math.ceil((rl.resetAt - Date.now()) / 1000), 1)),
        },
      }
    )
  }

  // 2. Validate input.
  let body: z.infer<typeof signInSchema>
  try {
    const parsed = signInSchema.safeParse(await req.json())
    if (!parsed.success) return jsonError("ERR_VALIDATION")
    body = parsed.data
  } catch {
    return jsonError("ERR_VALIDATION")
  }

  // 3. Sign in with the SSR client; cookies are collected and written onto
  //    the response we actually return (server-side session establishment).
  const reqCookies = req.cookies.getAll()
  const collected: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return reqCookies
        },
        setAll(cookiesToSet) {
          collected.push(...cookiesToSet)
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({
    email: body.email.trim(),
    password: body.password,
  })

  if (error || !data.user) {
    // Single generic message — no account enumeration.
    logger.warn(
      { component: "auth/sign-in", ip, code: error?.code ?? "unknown" },
      "Sign-in rejected"
    )
    return jsonError("AUTH004")
  }

  const response = NextResponse.json({ success: true })
  for (const { name, value, options } of collected) {
    response.cookies.set(name, value, options)
  }
  return response
}
