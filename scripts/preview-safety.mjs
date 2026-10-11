#!/usr/bin/env node
// Deployment guards: never log response bodies, environment values or tokens.
import { readFileSync } from "node:fs"
import { parseEnv } from "node:util"
import { pathToFileURL } from "node:url"

export const STAGING_REF = "viowrovartosrkqukjxy"
const requiredJobs = ["ci", "pgtap"]
const variables = {
  NEXT_PUBLIC_SUPABASE_URL: "STAGING_SUPABASE_URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "STAGING_SUPABASE_ANON_KEY",
  SUPABASE_SERVICE_ROLE_KEY: "STAGING_SUPABASE_SERVICE_KEY",
}

export function verifyPreviewEnvironment(env, pulled) {
  for (const name of Object.values(variables)) {
    if (!env[name]?.trim()) throw new Error(`MISSING: ${name}`)
  }
  let url
  try { url = new URL(env.STAGING_SUPABASE_URL) } catch { /* fail below */ }
  if (!url || url.href !== `https://${STAGING_REF}.supabase.co/`) {
    throw new Error("Staging URL must identify the explicitly approved staging project")
  }
  // Opaque new-style keys cannot be project-bound by decoding. Real API/E2E
  // verification is still required. Legacy JWT metadata catches obvious mixups,
  // but is not signature verification or proof of credential validity.
  for (const [name, role, prefix] of [
    ["STAGING_SUPABASE_ANON_KEY", "anon", "sb_publishable_"],
    ["STAGING_SUPABASE_SERVICE_KEY", "service_role", "sb_secret_"],
  ]) {
    const value = env[name]
    if (!value.startsWith(prefix)) {
      let payload
      try { payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString()) } catch { /* fail below */ }
      if (!payload || payload.ref !== STAGING_REF || payload.role !== role) {
        throw new Error(`${name} does not match the staging project/key role`)
      }
    }
  }
  if (pulled) {
    for (const [name, stagingName] of Object.entries(variables)) {
      if (pulled[name] !== env[stagingName]) {
        throw new Error(`Vercel Preview ${name} differs from approved staging configuration`)
      }
    }
    try { previewOrigin(pulled.NEXT_PUBLIC_APP_URL) } catch {
      throw new Error("Vercel Preview NEXT_PUBLIC_APP_URL must be a same-project preview origin")
    }
    if (["DEPLOYMENT_ROLE", "PUBLIC_DASHBOARD_URL", "PUBLIC_LANDING_URL",
      "NEXT_PUBLIC_DASHBOARD_URL", "NEXT_PUBLIC_LANDING_URL"].some(name => pulled[name])) {
      throw new Error("Preview must use single-host routing without production auth origins")
    }
    if (pulled.NEXT_PUBLIC_SITE_URL && pulled.NEXT_PUBLIC_SITE_URL !== pulled.NEXT_PUBLIC_APP_URL) {
      throw new Error("Preview must not inherit a foreign site/email origin")
    }
    if (pulled.ZATCA_MODE && pulled.ZATCA_MODE !== "mock") {
      throw new Error("Preview must use offline ZATCA mock mode")
    }
    if (pulled.ZATCA_API_BASE_URL || pulled.ZATCA_PRODUCTION_ENABLED === "true") {
      throw new Error("Preview must not enable external ZATCA submission")
    }
  }
}

// Native Vercel Git builds bypass Actions' pull/config guard. Validate their
// actual build environment too, before Next compiles public values into JS.
// This does not authenticate opaque keys or inspect Supabase Auth URL settings.
export function verifyNativePreviewEnvironment(env) {
  if (env.VERCEL_ENV !== "preview") return
  verifyPreviewEnvironment({
    STAGING_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    STAGING_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    STAGING_SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  }, env)
}

export function selectCiRun(runs, sha, prNumber) {
  return runs.filter(run => run.head_sha === sha && run.event === "pull_request" &&
    run.pull_requests?.some(pr => pr.number === prNumber))
    .sort((a, b) => b.id - a.id)[0]
}

export function requiredJobState(jobs) {
  for (const name of requiredJobs) {
    const matches = jobs.filter(job => job.name === name)
    if (matches.length !== 1) return "pending"
    const job = matches[0]
    if (job.status === "completed" && job.conclusion !== "success") {
      throw new Error(`Required CI job ${name} did not pass`)
    }
  }
  return requiredJobs.every(name => jobs.some(job => job.name === name &&
    job.status === "completed" && job.conclusion === "success")) ? "success" : "pending"
}

export function previewOrigin(value) {
  let url
  try { url = new URL(value) } catch { /* fail below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port ||
    url.pathname !== "/" || url.search || url.hash ||
    !/^elite-dashboard-[a-z0-9-]+-elitesaasc-5643\.vercel\.app$/.test(url.hostname) ||
    url.hostname === "elite-dashboard-git-master-elitesaasc-5643.vercel.app") {
    throw new Error("PREVIEW_URL must identify an elite-dashboard preview origin")
  }
  return url.origin
}

export function verifySmoke(healthStatus, health, dashboardStatus, location, origin) {
  if (healthStatus !== 200 || health?.status !== "healthy" ||
    health?.checks?.database?.status !== "ok" || health?.checks?.auth?.status !== "ok") {
    throw new Error("Preview health check failed; degraded or malformed responses are not accepted")
  }
  if (dashboardStatus === 401) return
  if (![302, 307].includes(dashboardStatus)) throw new Error("Anonymous dashboard access was not denied")
  let redirect
  try { redirect = new URL(location, origin) } catch { /* fail below */ }
  if (!location || !redirect || redirect.origin !== origin || redirect.pathname !== "/auth/sign-in") {
    throw new Error("Anonymous dashboard redirect must remain on the preview sign-in origin")
  }
}

export async function waitForCi(env, { fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 40 } = {}) {
  const repo = env.GITHUB_REPOSITORY
  const sha = env.PR_HEAD_SHA
  const prNumber = Number(env.PR_NUMBER)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    !Number.isSafeInteger(prNumber) || prNumber <= 0 || !env.GH_TOKEN) {
    throw new Error("Missing or invalid GitHub CI gate configuration")
  }
  const get = async path => {
    const response = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error", signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error(`GitHub CI metadata request failed (HTTP ${response.status})`)
    return response.json()
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const listing = await get(`/actions/workflows/ci.yml/runs?head_sha=${sha}&event=pull_request&per_page=100`)
    const run = selectCiRun(listing.workflow_runs ?? [], sha, prNumber)
    if (run) {
      const result = await get(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
      if (requiredJobState(result.jobs ?? []) === "success") return
      if (run.status === "completed") throw new Error("CI finished without every required build/database job passing")
    }
    if (attempt + 1 < attempts) await pause(15000)
  }
  throw new Error("Timed out waiting for current-PR CI/database checks; refusing preview deployment")
}

export async function smokePreview(value, fetcher = fetch) {
  const origin = previewOrigin(value)
  const get = path => fetcher(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20000) })
  const healthResponse = await get("/api/health")
  let health
  try { health = await healthResponse.json() } catch { /* fail below */ }
  const dashboard = await get("/dashboard")
  verifySmoke(healthResponse.status, health, dashboard.status, dashboard.headers.get("location"), origin)
}

async function main() {
  switch (process.argv[2]) {
    case "environment": {
      const pulled = process.argv[3] === "--pulled"
        ? parseEnv(readFileSync(".vercel/.env.preview.local", "utf8")) : undefined
      verifyPreviewEnvironment(process.env, pulled)
      break
    }
    case "ci": await waitForCi(process.env); break
    case "smoke": await smokePreview(process.env.PREVIEW_URL); break
    default: throw new Error("Usage: preview-safety.mjs environment [--pulled] | ci | smoke")
  }
  console.log(`Preview ${process.argv[2]} gate passed`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Only these guards' fixed messages may be printed, never third-party
    // bodies/URLs/headers or errors containing environment-file contents.
    const safe = /^(MISSING:|Staging URL must|STAGING_SUPABASE_|Vercel Preview |Preview must|PREVIEW_URL must|Preview health check failed|Anonymous dashboard |Required CI job |Missing or invalid GitHub|GitHub CI metadata request failed|CI finished without|Timed out waiting|Usage:)/
    console.error(safe.test(error.message) ? error.message : "Preview gate failed; inspect configuration/access without exposing secrets")
    process.exitCode = 1
  })
}
