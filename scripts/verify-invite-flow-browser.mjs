// scripts/verify-invite-flow-browser.mjs
// Browser E2E for the invite accept flow (auth plan 6.x) — closes the loop
// on the bcrypt/token_id upgrade (migration 057) + the accept-invite page.
//
//   A-1  accept-invite page renders with full-name + password + confirm fields
//   A-2  wrong token → generic bilingual error, no account created
//   A-3  correct token → success state with "back to sign-in" link
//   A-4  auth.users + users + tenant_memberships + user_role_assignments rows
//        provisioned with the invite's role; invite marked accepted
//   A-5  new user can sign in through the real UI and reach the dashboard
//   A-6  zero console/page errors during the flow
//
// The invite row is seeded directly via the service-role client with the same
// shape createInvite writes (bcrypt token_hash + token_id, 7-day expiry), so
// the whole accept path is exercised without needing a real Resend email.
//
// Usage: node scripts/verify-invite-flow-browser.mjs
// Requires the dev server running on :3000 (NEXT_PUBLIC_APP_URL).

import { readFileSync } from "node:fs"
import crypto from "node:crypto"
import bcrypt from "bcryptjs"
import puppeteer from "puppeteer-core"

const envRaw = readFileSync(".env.local", "utf8")
const env = {}
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const APP = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
if (!BASE || !KEY) {
  console.error("✗ Missing Supabase env vars in .env.local")
  process.exit(1)
}

const TENANT = "00000000-0000-0000-0000-000000000001" // demo tenant
const RUN = Date.now()
const email = `invite-${RUN}@elite.local`
const fullName = `Invite Probe ${RUN}`
const password = "EliteInvite2026!"

// 45s hard cap on every REST call so a stalled Supabase connection can never
// hang the whole E2E (fetch has no default timeout; seen once at 300s).
const TMO = (ms = 45000) => AbortSignal.timeout(ms)

const rest = async (path, opts = {}) => {
  const { body, ...fetchOpts } = opts
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...fetchOpts,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: opts.signal ?? TMO(),
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}),
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text }
}

let failures = 0
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!cond) failures++
}

// ── Seed the invite exactly as createInvite would (bcrypt + token_id) ──────
const token = crypto.randomUUID()
const tokenId = crypto.randomUUID()
const tokenHash = await bcrypt.hash(token, 10)
const seeded = await rest("/invites", {
  method: "POST",
  body: {
    tenant_id: TENANT,
    email,
    role: "accountant",
    token_id: tokenId,
    token_hash: tokenHash,
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  },
})
const inviteId = Array.isArray(seeded.json) ? seeded.json[0]?.id : seeded.json?.id
ok("seed invite row created (bcrypt token_hash + token_id)", seeded.status === 201 && !!inviteId,
  `status=${seeded.status}${seeded.status !== 201 ? " " + (typeof seeded.text === "string" ? seeded.text : JSON.stringify(seeded.json)).slice(0, 160) : ""}`)
if (!inviteId) {
  console.log("Cannot continue without a seeded invite.")
  process.exit(1)
}

const step = (s) => console.log(`[step ${new Date().toISOString().slice(11, 19)}] ${s}`)

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
})
let browserOpen = true
const closeBrowser = async () => {
  if (browserOpen) {
    browserOpen = false
    try { await browser.close() } catch {}
  }
}
// Never leave the browser subprocess (and Node's event loop) alive on an
// unexpected rejection — that is what turned a failure into a 300s hang.
process.on("unhandledRejection", async (err) => {
  console.error(`✗ unhandled rejection: ${err?.message || err}`)
  await closeBrowser()
  process.exit(2)
})
const page = await browser.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`))
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console: ${m.text()}`)
})

const acceptUrl = (tok, tid) => `${APP}/auth/accept-invite?tid=${encodeURIComponent(tid)}&token=${encodeURIComponent(tok)}`

// ── A-1: page renders with the three fields ───────────────────────────────
step("A-1 accept-invite page render")
await page.goto(acceptUrl(token, tokenId), { waitUntil: "networkidle0", timeout: 90000 })
await new Promise((r) => setTimeout(r, 1500))
const fields = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll("input"))
  return {
    fullName: inputs.some((i) => i.type === "text"),
    pwd: inputs.some((i) => i.type === "password"),
    pwdCount: inputs.filter((i) => i.type === "password").length,
    submit: Array.from(document.querySelectorAll("button[type=submit]")).some((b) => /قبول|Accept/.test(b.textContent || "")),
  }
})
ok("A-1 accept-invite form renders (full name + 2 password fields + submit)",
  fields.fullName && fields.pwdCount === 2 && fields.submit,
  `fullName=${fields.fullName} pwdCount=${fields.pwdCount} submit=${fields.submit}`)

// ── A-2: wrong token → generic error, no account ──────────────────────────
step("A-2 wrong-token rejection")
await page.goto(acceptUrl("00000000-0000-0000-0000-000000000000", tokenId), { waitUntil: "networkidle0", timeout: 90000 })
await new Promise((r) => setTimeout(r, 1200))
await page.type("input[type=text]", fullName)
await page.type("input[type=password]", password)
const pass2 = await page.$$("input[type=password]")
await pass2[1].type(password)
await Promise.all([
  page.waitForFunction(() => /Invalid or expired invite token|رمز الدعوة غير صالح|غير صالح/.test(document.body.innerText), { timeout: 30000 }).catch(() => {}),
  page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button[type=submit]")).find((b) => /قبول|Accept/.test(b.textContent || ""))
    if (btn) btn.click()
  }),
])
await new Promise((r) => setTimeout(r, 2000))
const wrongTokErr = await page.evaluate(() =>
  /Invalid or expired invite token|رمز الدعوة غير صالح|غير صالح/.test(document.body.innerText)
)
ok("A-2 wrong token shows generic error (no enumeration)", wrongTokErr)
const wrongUser = await rest(`/users?select=id&email=eq.${encodeURIComponent(email)}`)
ok("A-2b no user created for wrong token", (wrongUser.json ?? []).length === 0)

// ── A-3: correct token → success state ────────────────────────────────────
step("A-3 correct-token accept")
await page.goto(acceptUrl(token, tokenId), { waitUntil: "networkidle0", timeout: 90000 })
await new Promise((r) => setTimeout(r, 1500))
await page.type("input[type=text]", fullName)
const pwds = await page.$$("input[type=password]")
await pwds[0].type(password)
await pwds[1].type(password)
await Promise.all([
  page.waitForFunction(
    () => /acceptInviteSuccessTitle|تم إنشاء الحساب|Account created|تم قبول الدعوة|Invite accepted/.test(document.body.innerText),
    { timeout: 45000 }
  ).catch(() => {}),
  page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button[type=submit]")).find((b) => /قبول|Accept/.test(b.textContent || ""))
    if (btn) btn.click()
  }),
])
await new Promise((r) => setTimeout(r, 3000))
const bodyText = await page.evaluate(() => document.body.innerText)
// Assert the SUCCESS title specifically — the error state also renders a
// back-to-sign-in link, so checking any sign-in link is a false positive.
const successShown = /تم إنشاء الحساب بنجاح|Account created successfully|تم قبول الدعوة|Invite accepted|تم إنشاء حسابك|Your account has been created/.test(bodyText)
ok("A-3 accept succeeds with success state", successShown,
  successShown ? "success state shown" : `page: ${bodyText.replace(/\n+/g, " | ").slice(0, 180)}`)
if (!successShown) {
  // Surface the actual error for debugging before the rest of the flow.
  const errText = await page.evaluate(() => document.body.innerText.match(/Invalid|غير صالح|Failed|فشل|error|خطأ|Could not find|Cannot|[A-Z]{4}\d{3}/i)?.[0] ?? "")
  ok("A-3b (debug) error text", !!errText, errText || "none")
}

// ── A-4: provisioning verified at the DB level ────────────────────────────
step("A-4 DB provisioning checks")
// Look the auth user up via the users row's auth_user_id FK (the admin API's
// ?email= filter is unreliable across pages).
let authUid = null
const userRow0 = await rest(`/users?select=auth_user_id&email=eq.${encodeURIComponent(email)}`)
const u0 = (userRow0.json ?? [])[0]
if (u0?.auth_user_id) {
  const authRes = await fetch(`${BASE}/auth/v1/admin/users/${u0.auth_user_id}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  const authUser = await authRes.json().catch(() => ({}))
  if (authUser?.id) authUid = authUser.id
}
ok("A-4a auth.users entry created (email confirmed by invite)",
  !!authUid, authUid ? `uid=${authUid.slice(0, 8)}` : "missing")

const userRow = await rest(`/users?select=id,role,status,tenant_id,email,full_name_en&email=eq.${encodeURIComponent(email)}`)
const u = (userRow.json ?? [])[0]
ok("A-4b users row provisioned with invite role + tenant",
  !!u && u.role === "accountant" && u.status === "active" && u.tenant_id === TENANT,
  u ? `role=${u.role} status=${u.status} name=${u.full_name_en}` : "missing")

let membershipOk = false
let memDetail = "skipped (no user)"
if (u?.id) {
  const mem = await rest(`/tenant_memberships?select=id&user_id=eq.${u.id}`)
  memDetail = Array.isArray(mem.json) ? `rows=${mem.json.length}` : `http ${mem.status}`
  membershipOk = Array.isArray(mem.json) && mem.json.length > 0
}
ok("A-4c tenant_memberships row created", membershipOk, memDetail)

let assignmentOk = false
let asgDetail = "skipped (no user)"
if (u?.id) {
  const asg = await rest(`/user_role_assignments?select=id&user_id=eq.${u.id}`)
  asgDetail = Array.isArray(asg.json) ? `rows=${asg.json.length}` : `http ${asg.status}`
  assignmentOk = Array.isArray(asg.json) && asg.json.length > 0
}
ok("A-4d user_role_assignments row created", assignmentOk, asgDetail)

const inv = await rest(`/invites?select=id,status,accepted_at,accepted_by&id=eq.${inviteId}`)
const iRow = (inv.json ?? [])[0]
ok("A-4e invite marked accepted (replay-proof)", iRow?.status === "accepted" && !!iRow.accepted_at,
  iRow ? `status=${iRow.status} acceptedBy=${iRow.accepted_by ? iRow.accepted_by.slice(0, 8) : "—"}` : "missing")

// ── A-5: sign in as the new user through the real UI ──────────────────────
step("A-5 sign-in as provisioned user")
await page.goto(`${APP}/auth/sign-in`, { waitUntil: "networkidle0", timeout: 90000 })
await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 })
await page.type("input[type=email]", email)
await page.type("input[type=password]", password)
await Promise.all([
  page.waitForFunction(() => document.body.innerText.includes("dashboard") || /الرئيسية|لوحة/.test(document.body.innerText) || window.location.pathname.includes("dashboard"), { timeout: 45000 }).catch(() => {}),
  page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /تسجيل الدخول|Sign in|دخول/.test(b.textContent || ""))
    if (btn) btn.click()
  }),
])
await new Promise((r) => setTimeout(r, 4000))
const signedIn = await page.evaluate(() =>
  window.location.pathname.includes("dashboard") || /الرئيسية|لوحة التحكم|Dashboard/.test(document.body.innerText)
)
ok("A-5 new user signs in and reaches the dashboard", signedIn, `url=${await page.url()}`)

// ── A-6: console errors ───────────────────────────────────────────────────
const realErrors = pageErrors.filter((e) => !e.includes("Download the React DevTools"))
ok("A-6 zero console/page errors", realErrors.length === 0, `errors=${realErrors.length}`)

console.log(failures === 0 ? "\n✅ ALL INVITE-FLOW CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
await closeBrowser()

// ── Cleanup: delete the provisioned user + invite ─────────────────────────
step("cleanup")
if (authUid) {
  await fetch(`${BASE}/auth/v1/admin/users/${authUid}`, {
    method: "DELETE",
    signal: TMO(),
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).catch(() => {})
}
if (u?.id) {
  await rest(`/users?id=eq.${u.id}`, { method: "DELETE" })
}
await rest(`/invites?id=eq.${inviteId}`, { method: "DELETE" })
console.log("cleanup done")
process.exit(failures === 0 ? 0 : 1)
