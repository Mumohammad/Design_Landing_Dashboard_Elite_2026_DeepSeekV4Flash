// Run after `pnpm build` and `pnpm start --port 3107` with the isolated local
// Supabase stack. Creates a disposable owner/workspace; the next local reset
// removes fixtures. Never writes to a hosted project or records MFA secrets.
import { chromium, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"

process.loadEnvFile(".env.local")
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "58321") {
  throw new Error("This verification requires the isolated local Supabase project")
}
const appUrl = process.env.LOCAL_APP_URL ?? "http://localhost:3107"
if (!["http://localhost:3107", "http://localhost:3108"].includes(appUrl)) throw new Error("Local app target required")
const admin = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

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
let stage = "fixture creation"
try {
  const id = randomUUID()
  const email = `release-${id}@example.test`
  let password = `${randomBytes(20).toString("base64url")}1a`
  const owner = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { _invite_provisioned: true },
  })
  if (owner.error) throw new Error("Auth fixture failed")
  const company = await admin.rpc("provision_company_atomic", {
    p_auth_user_id: owner.data.user.id,
    p_company: { name: "Disposable browser verification", domain: `${id}.test`, slug: id },
  })
  if (company.error) throw new Error("Company fixture failed")
  if ((await admin.from("users").update({must_change_password:true}).eq("auth_user_id",owner.data.user.id)).error) throw new Error("Required-password fixture failed")

  browser = await chromium.launch({ headless: true })
  if (process.env.VERIFY_PASSWORD_FLOWS === "1") {
    stage = "new-password and recovery browser verification"
    const { verifyNewPasswordFlows } = await import("./verify-local-password-policy.mjs")
    await verifyNewPasswordFlows(browser, admin, appUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  }
  const page = await browser.newPage()
  page.setDefaultTimeout(20_000)
  let pageErrors = 0
  page.on("pageerror", () => { pageErrors++ })
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
  stage = "dashboard main landmark settles"
  await expect(page.locator("main")).toHaveCount(1, { timeout: 20_000 })
  stage = "dashboard executive region settles"
  const executive = page.getByRole("region", { name: "Executive KPIs", exact: true })
  await expect(executive).toHaveCount(1, { timeout: 20_000 })
  stage = "dashboard total drivers data loads"
  await expect(executive.getByRole("link", { name: "Total Drivers", exact: true })).toBeVisible({ timeout: 20_000 })
  stage = "persisted MFA state"
  const profile = await admin.from("users").select("two_factor_enabled")
    .eq("auth_user_id", owner.data.user.id).single()
  if (profile.error || profile.data.two_factor_enabled !== true || pageErrors !== 0) {
    throw new Error("Persisted MFA state or browser runtime check failed")
  }
  if (process.env.VERIFY_APPROVALS === "1") {
    stage = "approvals queue paging and privacy browser verification"
    const { verifyApprovalsInbox } = await import("./verify-local-approvals.mjs")
    await verifyApprovalsInbox(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_EXPENSES === "1") {
    stage = "expense overview browser verification"
    const { verifyExpensesOverview } = await import("./verify-local-expenses.mjs")
    await verifyExpensesOverview(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_RECEIVABLE_CRUD === "1") {
    stage = "manual receivable retry browser verification"
    const { verifyReceivableCrud } = await import("./verify-local-receivables.mjs")
    await verifyReceivableCrud(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_INVOICE_CRUD === "1") {
    stage = "invoice CRUD browser verification"
    const { verifyInvoiceCrud } = await import("./verify-local-invoices.mjs")
    await verifyInvoiceCrud(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_JOURNAL_CRUD === "1") {
    stage = "journal CRUD browser verification"
    const { verifyJournalCrud } = await import("./verify-local-journals.mjs")
    await verifyJournalCrud(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_BANK_CRUD === "1") {
    stage = "bank CRUD browser verification"
    const { verifyBankCrud } = await import("./verify-local-banks.mjs")
    await verifyBankCrud(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_OPERATIONS_CRUD === "1") {
    stage = "operations CRUD browser verification"
    const { verifyOperationsCrud } = await import("./verify-local-operations.mjs")
    await verifyOperationsCrud(page, admin, company.data.id, appUrl)
  }
  if (process.env.VERIFY_OVERVIEWS === "1") {
    stage = "large overview search, export, pagination, and read recovery"
    const { verifyOverviews } = await import("./verify-local-overviews.mjs")
    await verifyOverviews(page, admin, company.data.id, owner.data.user.id, appUrl)
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
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  stage = "returning owner dashboard landmarks settle"
  await expect(page.locator("main")).toHaveCount(1, { timeout: 20_000 })
  await expect(executive).toHaveCount(1, { timeout: 20_000 })
  await expect(executive.getByRole("link", { name: "Total Drivers", exact: true })).toBeVisible({ timeout: 20_000 })
  if (pageErrors !== 0) throw new Error("Browser runtime check failed")
  console.log("PASS: owner sign-in → MFA enrollment → persisted MFA → dashboard data → sign-out → returning-user MFA challenge; no browser runtime errors")
} catch (error) {
  // Avoid logging assertion values, credentials, factor secrets or page bodies.
  const failureKind = /strict mode violation/.test(error.message) ? "ambiguous-locator"
    : /Timeout/.test(error.name) ? "timeout"
    : /Execution context was destroyed|navigation|interrupted/i.test(error.message) ? "navigation"
    : /Target.*closed|page.*closed/i.test(error.message) ? "closed-page"
    : "assertion-or-service"
  console.error(JSON.stringify({ result: "FAIL", stage, errorType: error.name, failureKind }))
  process.exitCode = 1
} finally {
  await browser?.close()
}
