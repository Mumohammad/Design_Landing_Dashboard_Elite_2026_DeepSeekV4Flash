import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { STAGING_REF, verifyPreviewEnvironment, selectCiRun, requiredJobState, previewOrigin, verifySmoke, waitForCi, smokePreview } from "./preview-safety.mjs"

const jwt = (ref, role) => `fixture.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.fixture`
const config = () => ({
  STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  STAGING_SUPABASE_ANON_KEY: jwt(STAGING_REF, "anon"),
  STAGING_SUPABASE_SERVICE_KEY: jwt(STAGING_REF, "service_role"),
})
const pulled = env => ({ NEXT_PUBLIC_SUPABASE_URL: env.STAGING_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: env.STAGING_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.STAGING_SUPABASE_SERVICE_KEY, NEXT_PUBLIC_APP_URL: "https://elite-dashboard-fixture-elitesaasc-5643.vercel.app" })

test("approved staging configuration matches pulled Vercel runtime/build values", () => {
  const env = config()
  verifyPreviewEnvironment(env, pulled(env))
})
for (const name of Object.keys(config())) test(`missing ${name} fails closed without revealing values`, () => {
  const env = config(); env[name] = ""
  assert.throws(() => verifyPreviewEnvironment(env), { message: `MISSING: ${name}` })
})
test("old project, credential URL, query and local URLs are rejected", () => {
  for (const url of ["https://wwfnsbilmyxeawgzicmv.supabase.co", `https://credential@${STAGING_REF}.supabase.co`, `https://${STAGING_REF}.supabase.co/?query=1`, "http://localhost:54321"]) {
    assert.throws(() => verifyPreviewEnvironment({ ...config(), STAGING_SUPABASE_URL: url }), /approved staging/)
  }
})
for (const name of ["STAGING_SUPABASE_ANON_KEY", "STAGING_SUPABASE_SERVICE_KEY"]) {
  test(`foreign or wrong-role ${name} rejected`, () => {
    assert.throws(() => verifyPreviewEnvironment({ ...config(), [name]: jwt("foreign-project", "anon") }), /project\/key role/)
    assert.throws(() => verifyPreviewEnvironment({ ...config(), [name]: jwt(STAGING_REF, name.endsWith("ANON_KEY") ? "service_role" : "anon") }), /project\/key role/)
  })
}
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) test(`pulled ${name} cannot override approved staging`, () => {
  const env = config()
  assert.throws(() => verifyPreviewEnvironment(env, { ...pulled(env), [name]: "foreign-fixture" }), { message: `Vercel Preview ${name} differs from approved staging configuration` })
})
test("preview rejects missing/local/production app origins", () => {
  for (const NEXT_PUBLIC_APP_URL of [undefined, "http://localhost:3000", "https://elite-dashboard-blush.vercel.app"]) {
    assert.throws(() => verifyPreviewEnvironment(config(), { ...pulled(config()), NEXT_PUBLIC_APP_URL }), /NEXT_PUBLIC_APP_URL must/)
  }
})
test("preview rejects inherited multi-host production routing", () => {
  for (const name of ["DEPLOYMENT_ROLE", "NEXT_PUBLIC_DASHBOARD_URL", "NEXT_PUBLIC_LANDING_URL"]) {
    assert.throws(() => verifyPreviewEnvironment(config(), { ...pulled(config()), [name]: "foreign-fixture" }), /single-host routing/)
  }
})
test("new-style keys are supported without pretending to verify their project binding", () => {
  const env = { ...config(), STAGING_SUPABASE_ANON_KEY: "sb_publishable_fixture", STAGING_SUPABASE_SERVICE_KEY: "sb_secret_fixture" }
  verifyPreviewEnvironment(env, pulled(env))
})
test("preview refuses outbound ZATCA modes and credentials activating a gateway", () => {
  for (const unsafe of [{ ZATCA_MODE: "production" }, { ZATCA_MODE: "sandbox" }, { ZATCA_API_BASE_URL: "fixture" }, { ZATCA_PRODUCTION_ENABLED: "true" }]) {
    assert.throws(() => verifyPreviewEnvironment(config(), { ...pulled(config()), ...unsafe }), /Preview must/)
  }
})

const sha = "a".repeat(40)
const run = { id: 1, head_sha: sha, event: "pull_request", pull_requests: [{ number: 68 }], run_attempt: 1 }
test("CI selection binds exact head and PR, not old-head/push/unrelated green runs", () => {
  assert.equal(selectCiRun([run, { ...run, id: 2 }, { ...run, id: 3, head_sha: "b".repeat(40) }, { ...run, id: 4, event: "push" }, { ...run, id: 5, pull_requests: [{ number: 67 }] }], sha, 68).id, 2)
  assert.equal(selectCiRun([{ ...run, pull_requests: [] }], sha, 68), undefined)
})
const jobs = () => ["ci", "pgtap"].map(name => ({ name, status: "completed", conclusion: "success" }))
test("both build and database jobs must pass; authenticated E2E remains a separate merge gate", () => {
  assert.equal(requiredJobState(jobs()), "success")
  assert.equal(requiredJobState([jobs()[0]]), "pending")
  assert.equal(requiredJobState([{ ...jobs()[0], status: "in_progress" }, jobs()[1]]), "pending")
})
for (const conclusion of ["failure", "skipped", "cancelled", "neutral", "timed_out"]) test(`required ${conclusion} check is not green`, () => {
  assert.throws(() => requiredJobState([jobs()[0], { ...jobs()[1], conclusion }]), /did not pass/)
})
test("CI API uses latest run attempt, fails on unavailable/missing jobs, never exposes response bodies", async () => {
  const env = { GITHUB_REPOSITORY: "owner/repo", GH_TOKEN: "fixture-not-a-credential", PR_HEAD_SHA: sha, PR_NUMBER: "68" }
  const urls = []
  await waitForCi(env, { attempts: 1, fetcher: async url => { urls.push(url); return { ok: true, json: async () => urls.length === 1 ? { workflow_runs: [{ ...run, run_attempt: 2 }] } : { jobs: jobs() } } } })
  assert.match(urls[1], /attempts\/2\/jobs/)
  await assert.rejects(waitForCi(env, { attempts: 1, fetcher: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
  await assert.rejects(waitForCi(env, { attempts: 1, fetcher: async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) }) }), /Timed out/)
  await assert.rejects(waitForCi(env, { attempts: 1, fetcher: async () => ({ ok: true, json: async () => ({ workflow_runs: [{ ...run, status: "completed" }], jobs: [] }) }) }), /CI finished without/)
})

const origin = "https://elite-dashboard-fixture-elitesaasc-5643.vercel.app"
const health = { status: "healthy", checks: { database: { status: "ok" }, auth: { status: "ok" } } }
test("smoke passes only healthy DB/auth and denied anonymous dashboard", () => {
  verifySmoke(200, health, 307, "/auth/sign-in?returnTo=%2Fdashboard", origin)
  verifySmoke(200, health, 401, null, origin)
})
test("degraded, unavailable, malformed and failed database responses fail smoke", () => {
  for (const value of [undefined, {}, { ...health, status: "degraded" }, { ...health, checks: { database: { status: "error" }, auth: { status: "ok" } } }]) {
    assert.throws(() => verifySmoke(200, value, 307, "/auth/sign-in", origin), /health check failed/)
  }
  assert.throws(() => verifySmoke(500, health, 307, "/auth/sign-in", origin), /health check failed/)
})
test("rendered dashboard, arbitrary and cross-deployment redirects are rejected", () => {
  assert.throws(() => verifySmoke(200, health, 200, null, origin), /not denied/)
  for (const location of [null, "/landing", "https://elite-dashboard-blush.vercel.app/auth/sign-in"]) {
    assert.throws(() => verifySmoke(200, health, 307, location, origin), /preview sign-in origin/)
  }
})
test("missing URL, production alias, master branch alias and URL credentials cannot be smoked", () => {
  assert.equal(previewOrigin(origin), origin)
  for (const value of [undefined, "https://elite-dashboard-blush.vercel.app", "https://elite-dashboard-git-master-elitesaasc-5643.vercel.app", origin.replace("https://", "https://credential@"), origin + "/path"]) {
    assert.throws(() => previewOrigin(value), /preview origin/)
  }
})
test("smoke requests are GET-only and never follow redirects", async () => {
  const paths = []
  await smokePreview(origin, async (url, options) => {
    paths.push(new URL(url).pathname)
    assert.equal(options.redirect, "manual")
    assert.equal(options.method, undefined)
    return url.endsWith("health") ? { status: 200, json: async () => health } : { status: 307, headers: new Headers({ location: "/auth/sign-in" }) }
  })
  assert.deepEqual(paths, ["/api/health", "/dashboard"])
})
test("workflow checks staging before Vercel pull/build/deploy and runs real CI/smoke guards", () => {
  const text = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")
  const preview = text.split("  production:")[0]
  for (const command of ["preview-safety.mjs ci", "preview-safety.mjs environment", "preview-safety.mjs environment --pulled", "preview-safety.mjs smoke"]) assert.ok(preview.includes(command))
  assert.ok(preview.indexOf("preview-safety.mjs environment") < preview.indexOf("vercel pull"))
  assert.ok(preview.indexOf("environment --pulled") < preview.indexOf("vercel build"))
  assert.ok(!preview.includes("CI checks should be green"))
  assert.ok(!preview.includes("--prod"))
  assert.ok(!preview.includes("http://localhost:3000"))
})
