import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

/** Readiness: dependent services must actually respond. */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const probe = async (run: () => Promise<void>) => {
    const start = Date.now()
    try {
      await run()
      return { status: "ok" as const, latencyMs: Date.now() - start }
    } catch {
      return { status: "error" as const, latencyMs: Date.now() - start }
    }
  }
  const [database, auth] = await Promise.all([
    probe(async () => {
      if (!url || !service) throw new Error("Unavailable")
      const client = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await client.from("tenants").select("id").limit(1).abortSignal(AbortSignal.timeout(5000))
      if (error) throw new Error("Unavailable")
    }),
    probe(async () => {
      if (!url || !anon) throw new Error("Unavailable")
      const response = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: anon }, signal: AbortSignal.timeout(5000), cache: "no-store",
      })
      if (!response.ok) throw new Error("Unavailable")
    }),
  ])
  const healthy = database.status === "ok" && auth.status === "ok"
  return NextResponse.json({
    status: healthy ? "healthy" : "unhealthy", timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    checks: { app: { status: "ok" }, database, auth },
  }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } })
}
