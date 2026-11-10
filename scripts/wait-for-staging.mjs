import { setTimeout } from "node:timers/promises"

const target = process.env.BASE_URL
const staging = process.env.STAGING_SUPABASE_URL?.replace(/\/$/, "")
const commit = process.env.STAGING_EXPECTED_COMMIT
if (!target || staging !== "https://viowrovartosrkqukjxy.supabase.co" || !/^[a-f0-9]{40}$/.test(commit ?? "")) {
  throw new Error("An isolated staging URL and exact expected commit are required")
}
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  try {
    const [health, landing] = await Promise.all([
      fetch(new URL("/api/health", target), { signal: AbortSignal.timeout(10_000), cache: "no-store" }),
      fetch(new URL("/landing", target), { signal: AbortSignal.timeout(10_000), cache: "no-store" }),
    ])
    const body = health.headers.get("content-type")?.includes("application/json") ? await health.json() : null
    const policy = landing.headers.get("content-security-policy") ?? ""
    if (health.ok && landing.ok && body?.status === "healthy" && body.version === commit &&
      policy.includes(staging) && !policy.includes("https://wwfnsbilmyxeawgzicmv.supabase.co")) {
      console.log("Staging app, backend and expected commit verified")
      process.exit(0)
    }
  } catch { /* The preview may still be building; never print headers or bodies. */ }
  await setTimeout(5_000)
}
throw new Error("The isolated staging preview did not become ready for the requested commit")
