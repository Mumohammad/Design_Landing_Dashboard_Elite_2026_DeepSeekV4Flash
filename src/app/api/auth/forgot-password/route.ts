// POST /api/auth/forgot-password — rate-limited password recovery email
// (audit fix H2).
//
// Why this route exists: the forgot-password page previously called
// resetPasswordForEmail directly from the browser with NO application rate
// limit (email-bombing vector). This route rate-limits per IP FIRST
// (3/hour, shared backend, fail-closed → 503), then asks Supabase to send
// the recovery email.
//
// Non-enumeration: resetPasswordForEmail does not reveal whether the email
// exists, and this route always answers 200 with the same envelope on
// success paths — never leak account existence.
// Supabase's built-in GoTrue rate limits stay enabled underneath as the
// second layer.

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"
import {
  rateLimitForgotPassword,
  RateLimitUnavailableError,
} from "@/lib/auth/rate-limit"
import { handleError } from "@/lib/errors"
import { ERROR_CODES } from "@/lib/errors/error-codes"
import { authCallbackUrlWithReturn } from "@/lib/redirects"
import { logger } from "@/lib/logger"

const forgotSchema = z.object({
  email: z.string().email(),
})

function ipFromRequest(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Rate limit FIRST — fail closed (503) if the backend is unavailable.
  const ip = ipFromRequest(req)
  let rl
  try {
    rl = await rateLimitForgotPassword(ip)
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
    const def = ERROR_CODES.AUTH_RATE_LIMITED
    return NextResponse.json(
      { code: def.code, message_ar: def.messageAr, message_en: def.messageEn },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(Math.ceil((rl.resetAt - Date.now()) / 1000), 1)),
        },
      }
    )
  }

  // 2. Validate input.
  let email: string
  try {
    const parsed = forgotSchema.safeParse(await req.json())
    if (!parsed.success) {
      const def = ERROR_CODES.ERR_VALIDATION
      return NextResponse.json(
        { code: def.code, message_ar: def.messageAr, message_en: def.messageEn },
        { status: def.httpStatus }
      )
    }
    email = parsed.data.email.trim()
  } catch {
    const def = ERROR_CODES.ERR_VALIDATION
    return NextResponse.json(
      { code: def.code, message_ar: def.messageAr, message_en: def.messageEn },
      { status: def.httpStatus }
    )
  }

  // 3. Send the recovery email (server-side; redirectTo is allow-listed by
  //    Supabase and validated in redirects.ts).
  let redirectTo: string
  try {
    redirectTo = authCallbackUrlWithReturn()
  } catch {
    return NextResponse.json({ error: "Password recovery temporarily unavailable" }, { status: 503 })
  }
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  })

  if (error) {
    // Logged server-side; the client still gets the neutral success envelope
    // below so responses do not enumerate accounts.
    logger.warn(
      { component: "auth/forgot-password", ip, message: error.message },
      "Recovery email request failed"
    )
  }

  return NextResponse.json({ success: true })
}
