// Coordinated release acceptance in the explicitly approved staging project.
// Every fixture is synthetic; no production endpoint is accepted. Owner retired in finally.
import { chromium, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"

process.loadEnvFile("supabase/.temp/staging-verification.env")
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
if (url.origin !== "https://viowrovartosrkqukjxy.supabase.co") throw new Error("Isolated staging required")
const appUrl = process.env.VERIFY_APP_URL
const expectedCommit = process.env.VERIFY_COMMIT_SHA
if (!appUrl || !expectedCommit || !/^[0-9a-f]{40}$/.test(expectedCommit)) throw Error("Provide VERIFY_APP_URL and the exact VERIFY_COMMIT_SHA")
const target = new URL(appUrl)
if (target.protocol!=="https:" || !/^elite-dashboard-[a-z0-9]+-elitesaasc-5643\.vercel\.app$/.test(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname!=="/") throw Error("Exact immutable staging deployment required")
const health = await fetch(appUrl + "/api/health")
const body = await health.json()
const policy = (await fetch(appUrl + "/landing")).headers.get("content-security-policy") ?? ""
if (!health.ok || body.version !== expectedCommit || !policy.includes(url.origin) || policy.includes("https://wwfnsbilmyxeawgzicmv.supabase.co")) throw new Error("Exact healthy isolated preview required")
process.env.VERIFY_OVERVIEWS = "0"
process.env.VERIFY_JOURNAL_CRUD = "1"
process.env.VERIFY_INVOICE_CRUD = "1"
const admin = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}})

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...secret.replace(/=+$/, "")]
    .map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, "0")).join("")
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac("sha1", key).update(counter).digest()
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0")
}

let browser
let fixtureUserId
let stage = "fixture creation"
const heartbeat = setInterval(() => console.log(JSON.stringify({ check: "hosted verification", stage })), 45000)
heartbeat.unref()
try {
  const id = randomUUID()
  const email = `release-${id}@example.test`
  let password = `${randomBytes(20).toString("base64url")}1a`
  const owner = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { _invite_provisioned: true },
  })
  if (owner.error) throw new Error("Auth fixture failed")
  fixtureUserId = owner.data.user.id
  const company = await admin.rpc("provision_company_atomic", {
    p_auth_user_id: owner.data.user.id,
    p_company: { name: "Disposable browser verification", domain: `${id}.test`, slug: id },
  })
  if (company.error) throw new Error("Company fixture failed")
  if ((await admin.from("users").update({must_change_password:true}).eq("auth_user_id",owner.data.user.id)).error) throw new Error("Required-password fixture failed")

  browser = await chromium.launch({ headless: true })
  // Explicit context permits the stale-tab and shared-session acceptance checks.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  let pageErrors = 0; const pageErrorKinds = []
  page.on("pageerror", error => { pageErrors++; console.log(JSON.stringify({check:"browser runtime event",stage,route:new URL(page.url()).pathname,name:error.name,reactCode:/Minified React error #(\d+)/.exec(error.message)?.[1]})); pageErrorKinds.push({ name:error.name, reactCode:/Minified React error #(\d+)/.exec(error.message)?.[1], kind:/abort/i.test(error.message)?"aborted":/hydration/i.test(error.message)?"hydration":/chunk|load/i.test(error.message)?"loading":/removeChild|insertBefore|not a child/i.test(error.message)?"dom":/undefined|null/i.test(error.message)?"missing-value":"other" }) })
  page.on("response", response => {
    if (/\/api\/invoices\/[0-9a-f-]+\/pdf$/.test(new URL(response.url()).pathname)) {
      console.log(JSON.stringify({ check: "invoice PDF HTTP", status: response.status(), type: response.headers()["content-type"] }))
    }
  })
  stage = "sign-in and mandatory MFA routing"
  // Exercise these mutation selectors in English; locale-session.spec.ts
  // separately verifies every module in both languages.
  await page.goto(`${appUrl}/auth/sign-in?lang=en`)
  await page.getByLabel(/email|البريد الإلكتروني/i).fill(email)
  await page.getByLabel(/^(password|كلمة المرور)$/i).fill(password)
  await page.getByRole("button", { name: /sign in|تسجيل الدخول/i }).click()
  stage = "required password before privileged MFA enrollment"
  const { verifyRequiredPasswordChange } = await import("./verify-local-password-policy.mjs")
  password = await verifyRequiredPasswordChange(page,admin,owner.data.user.id,appUrl,{responseLoss:true,nextPath:"/settings/mfa"})
  await page.waitForURL(/\/settings\/mfa/)

  stage = "MFA enrollment"
  await page.getByRole("button", { name: /Enable two-factor authentication|تفعيل التحقق الثنائي/ }).click()
  const key = page.locator("p.font-mono")
  await key.waitFor()
  const secret = (await key.innerText()).trim()
  stage = "MFA verification"
  await page.getByLabel(/Enter the code from your authenticator app|أدخل الرمز من تطبيق المصادقة/).fill(totp(secret))
  await page.getByRole("button", { name: /Verify authentication code|تأكيد رمز التحقق/ }).click()
  await page.getByText(/Two-factor authentication enabled successfully|تم تفعيل التحقق الثنائي بنجاح/).waitFor()

  stage = "dashboard navigation"
  await page.goto(`${appUrl}/dashboard`)
  await page.waitForURL(url => url.pathname === "/dashboard")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  stage = "dashboard landmark and data loading"
  await page.locator("main").waitFor()
  await page.getByRole("region", { name: "Executive KPIs" })
    .getByRole("link", { name: /^(Total Drivers|إجمالي السائقين)$/ }).waitFor()
  stage = "persisted MFA state"
  const profile = await admin.from("users").select("two_factor_enabled")
    .eq("auth_user_id", owner.data.user.id).single()
  if (profile.error || profile.data.two_factor_enabled !== true || pageErrors !== 0) {
    throw new Error("Persisted MFA state or browser runtime check failed")
  }
  // VAT needs pristine financial sources and creates no drivers.
  {
    stage="source-backed VAT review and adjusting journals"
    const {verifyVatReviewPosting}=await import("./verify-vat-review-posting.mjs")
    await verifyVatReviewPosting(page,admin,company.data.id,appUrl)
  }
  // Payroll needs a fresh driver roster.
  {
    stage = "payroll preparation on a fresh tenant"
    const { verifyPayrollPreparation } = await import("./verify-payroll-preparation.mjs")
    await verifyPayrollPreparation(page, admin, company.data.id, appUrl)
  }
  {
    stage = "fleet and maintenance atomic lifecycle"
    const { verifyFleetOperations } = await import("./verify-fleet-operations.mjs")
    await verifyFleetOperations(page, admin, company.data.id, appUrl)
  }
  {
    stage = "driver profile operational lifecycle"
    const { verifyDriverProfileOperations } = await import("./verify-local-driver-profile-operations.mjs")
    await verifyDriverProfileOperations(page, admin, company.data.id, appUrl)
  }
  {
    stage="dated driver leave lifecycle and reviewed policy"
    const {verifyDriverLeaveLifecycle}=await import("./verify-driver-leave-lifecycle.mjs")
    await verifyDriverLeaveLifecycle(page,admin,company.data.id,appUrl)
  }
  {
    stage = "driver evidence, retained history and physical card output"
    const { verifyDriverEvidence } = await import("./verify-driver-evidence.mjs")
    await verifyDriverEvidence(page, admin, company.data.id, appUrl)
  }
  {
    stage = "orders and platforms complete CRUD"
    const { verifyOrdersPlatforms } = await import("./verify-local-orders-platforms.mjs")
    await verifyOrdersPlatforms(page, admin, company.data.id, appUrl)
  }
  {
    stage = "user and role management"
    const { verifyUserRoleManagement } = await import("./verify-user-role-management.mjs")
    await verifyUserRoleManagement(page, admin, company.data.id, appUrl)
  }
  {
    stage = "company settings, WPS and payroll references"
    const { verifySettingsCrud } = await import("./verify-settings-crud.mjs")
    await verifySettingsCrud(page, admin, company.data.id, appUrl)
  }
  {
    stage = "pending expense corrections and reviewed approvals"
    const { verifyExpenseCorrections } = await import("./verify-expense-corrections.mjs")
    await verifyExpenseCorrections(page, admin, company.data.id, appUrl)
  }
  {
    stage = "invoice lifecycle and clean PDF hosted acceptance"
    const { verifyInvoiceCrud } = await import("./verify-local-invoices.mjs")
    await verifyInvoiceCrud(page, admin, company.data.id, appUrl)
  }
  {
    stage = "journal CRUD and protected reversal hosted acceptance"
    const { verifyJournalCrud } = await import("./verify-local-journals.mjs")
    await verifyJournalCrud(page, admin, company.data.id, appUrl)
  }
  {
    stage = "financial statements, CSV and print"
    const { verifyFinancialStatements } = await import("./verify-financial-statements.mjs")
    await verifyFinancialStatements(page, admin, company.data.id, appUrl)
  }
  {
    stage = "accounting complete pages, pickers, receipts and exports"
    const { verifyAccountingPages } = await import("./verify-accounting-pages.mjs")
    await verifyAccountingPages(page, admin, company.data.id, appUrl)
  }
  {
    stage = "bank account CRUD"
    const { verifyBankCrud } = await import("./verify-local-banks.mjs")
    await verifyBankCrud(page, admin, company.data.id, appUrl)
  }
  {
    stage = "receivable lifecycle"
    const { verifyReceivableCrud } = await import("./verify-local-receivables.mjs")
    await verifyReceivableCrud(page, admin, company.data.id, appUrl)
  }
  {
    stage = "full expense overview and approval lifecycle"
    const { verifyExpensesOverview } = await import("./verify-local-expenses.mjs")
    await verifyExpensesOverview(page, admin, company.data.id, appUrl)
  }
  {
    stage = "applications versioned reviews and immutable history"
    const { verifyApplicationReviews } = await import("./verify-application-reviews.mjs")
    await verifyApplicationReviews(page, admin, company.data.id, appUrl)
  }
  {
    stage = "approval inbox decisions"
    const { verifyApprovalsInbox } = await import("./verify-local-approvals.mjs")
    await verifyApprovalsInbox(page, admin, company.data.id, appUrl)
  }
  {
    stage = "VAT complete totals and classifications"
    const { verifyVatPosition } = await import("./verify-local-vat-position.mjs")
    await verifyVatPosition(page, admin, company.data.id, appUrl)
  }
  {
    stage = "audit privacy, filtered export and failure recovery"
    const { verifyAuditPrivacy } = await import("./verify-audit-privacy.mjs")
    await verifyAuditPrivacy(page, admin, company.data.id, appUrl, owner.data.user.id)
  }
  {
    stage = "platform administrator global user lifecycle and protected boundaries"
    const { verifyPlatformAdminUsers } = await import("./verify-platform-admin-users.mjs")
    await verifyPlatformAdminUsers(page, admin, company.data.id, appUrl, owner.data.user.id)
  }
  {
    stage = "all dashboard modules and shared English/Arabic session"
    const { verifyModuleLocales } = await import("./verify-module-locales.mjs")
    await verifyModuleLocales(page, url.href, appUrl)
  }
  stage = "sign-out denies dashboard access"
  await page.goto(`${appUrl}/auth/sign-out`)
  await page.waitForURL(/\/landing$/)
  await page.goto(`${appUrl}/dashboard`)
  await page.waitForURL(/\/auth\/sign-in/)
  if ((await admin.from("users").update({must_change_password:true}).eq("auth_user_id",owner.data.user.id)).error) throw new Error("Returning password requirement fixture failed")

  stage = "returning owner requires MFA challenge"
  await page.getByLabel(/email|البريد الإلكتروني/i).fill(email)
  await page.getByLabel(/^(password|كلمة المرور)$/i).fill(password)
  await page.getByRole("button", { name: /sign in|تسجيل الدخول/i }).click()
  stage = "returning owner challenge routing"
  await page.waitForURL(/\/auth\/mfa-challenge/)
  const challengeCode = page.getByPlaceholder("000000")
  stage = "returning owner challenge input"
  await challengeCode.waitFor()
  // A successfully used TOTP cannot be replayed; wait for the next time step.
  await setTimeout(30_000 - (Date.now() % 30_000) + 1_000)
  stage = "returning owner TOTP verification"
  await challengeCode.fill(totp(secret))
  await challengeCode.press("Enter")
  stage = "verified returning owner required password change"
  password = await verifyRequiredPasswordChange(page,admin,owner.data.user.id,appUrl,{locale:"ar",nextPath:"/dashboard"})
  await page.waitForURL(url => url.pathname === "/dashboard")
  stage = "returning owner locale assertion"
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  stage = "returning owner dashboard landmarks"
  await page.locator("main").waitFor()
  await page.getByRole("region", { name: "Executive KPIs" })
    .getByRole("link", { name: /^(Total Drivers|إجمالي السائقين)$/ }).waitFor()
  stage = "browser runtime assertion"
  console.log(JSON.stringify({check:"browser runtime classifications",pageErrors,pageErrorKinds}))
  if (pageErrors !== 0) throw new Error("Browser runtime check failed")
  console.log("PASS: coordinated module workflows, persisted data, clean invoice PDF, owner authentication, MFA, password changes, sign-out and returning-user challenge; no browser runtime errors")
} catch (error) {
  // Avoid logging assertion values, credentials, factor secrets or page bodies.
  const failureKind = /strict mode violation/.test(error.message) ? "ambiguous-locator"
    : /Timeout/.test(error.name) ? "timeout"
    : /Execution context was destroyed|navigation|interrupted/i.test(error.message) ? "navigation"
    : /Target.*closed|page.*closed/i.test(error.message) ? "closed-page"
    : "assertion-or-service"
  console.error(JSON.stringify({ result: "FAIL", stage, errorType: error.name, failureKind, operation:/expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0], callsite:/verify-production-modules\.mjs:(\d+):(\d+)/.exec(error.stack)?.slice(1), verificationStage:error.verificationStage, moduleFailure:/^Owned approval fixture cleanup failed$/.test(error.message)?"cleanup":undefined }))
  process.exitCode = 1
} finally {
  if (browser) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) await page.goto(appUrl + "/auth/sign-out").catch(() => {})
    }
  }
  await browser?.close()
  if (fixtureUserId) {
    const inactive = await admin.from('users').update({status:'inactive'}).eq('auth_user_id',fixtureUserId)
    if (inactive.error) { console.error('Synthetic app access retirement failed'); process.exitCode=1 }
    const retired = await admin.auth.admin.deleteUser(fixtureUserId, true)
    if (retired.error) { console.error("Synthetic auth fixture retirement failed"); process.exitCode = 1 }
  }
}
