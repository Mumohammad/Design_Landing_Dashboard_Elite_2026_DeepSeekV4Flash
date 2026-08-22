/**
 * Deployment health-check endpoint.
 *
 * GET /api/health → 200 OK with structured JSON.
 *
 * Verifies:
 *   1. Application is alive (always 200)
 *   2. Database connectivity (Supabase read)
 *   3. Auth service availability (Supabase auth)
 *
 * Used by:
 *   - CI/CD deployment smoke tests
 *   - Vercel monitoring
 *   - Uptime monitors
 *   - Post-deploy verification scripts
 *
 * Does NOT expose: env values, stack traces, internal IPs, secrets.
 */

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

interface HealthCheck {
  status: "healthy" | "degraded" | "unhealthy"
  timestamp: string
  version: string
  checks: {
    app: { status: "ok"; uptime: number }
    database: { status: "ok" | "error"; latencyMs?: number; error?: string }
    auth: { status: "ok" | "error"; latencyMs?: number; error?: string }
  }
}

const startTime = Date.now()

export async function GET() {
  const checks: HealthCheck["checks"] = {
    app: { status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) },
    database: { status: "ok" },
    auth: { status: "ok" },
  }

  let overallStatus: HealthCheck["status"] = "healthy"

  // ── Database check ────────────────────────────────────────────────────────
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey)
      const dbStart = Date.now()
      const { error } = await supabase.from("tenants").select("id").limit(1)
      checks.database.latencyMs = Date.now() - dbStart

      if (error) {
        checks.database.status = "error"
        checks.database.error = "Query failed"
        overallStatus = "degraded"
      }
    } else {
      checks.database.status = "error"
      checks.database.error = "Environment not configured"
      overallStatus = "degraded"
    }
  } catch {
    checks.database.status = "error"
    checks.database.error = "Connection failed"
    overallStatus = "degraded"
  }

  // ── Auth service check ────────────────────────────────────────────────────
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey)
      const authStart = Date.now()
      const { error } = await supabase.auth.getSession()
      checks.auth.latencyMs = Date.now() - authStart

      if (error) {
        checks.auth.status = "error"
        checks.auth.error = "Auth service unavailable"
        overallStatus = "degraded"
      }
    } else {
      checks.auth.status = "error"
      checks.auth.error = "Environment not configured"
      overallStatus = "degraded"
    }
  } catch {
    checks.auth.status = "error"
    checks.auth.error = "Auth service unreachable"
    overallStatus = "degraded"
  }

  const response: HealthCheck = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "unknown",
    checks,
  }

  // Log health check for monitoring
  if (overallStatus !== "healthy") {
    logger.warn({ health: response }, "[HEALTH] Unhealthy check")
  }

  const statusCode = overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 200 : 503

  return NextResponse.json(response, {
    status: statusCode,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
