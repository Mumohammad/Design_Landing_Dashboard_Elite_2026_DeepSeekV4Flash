// Run after `pnpm build` and `pnpm start --port 3107` with the isolated local
// Supabase stack. Creates a disposable owner/workspace; the next local reset
// removes fixtures. Never writes to a hosted project or records MFA secrets.
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { createHmac, randomBytes, randomUUID } from "node:crypto"

process.loadEnvFile(".env.local")
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "58321") {
  throw new Error("This verification requires the isolated local Supabase project")
}
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
  const password = `${randomBytes(20).toString("base64url")}1a`
  const owner = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { _invite_provisioned: true },
  })
  if (owner.error) throw new Error("Auth fixture failed")
  const company = await admin.rpc("provision_company_atomic", {
    p_auth_user_id: owner.data.user.id,
    p_company: { name: "Disposable browser verification", domain: `${id}.test`, slug: id },
  })
  if (company.error) throw new Error("Company fixture failed")

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(20_000)
  let pageErrors = 0
  page.on("pageerror", () => { pageErrors++ })
  stage = "sign-in and mandatory MFA routing"
  await page.goto("http://localhost:3107/auth/sign-in")
  await page.getByLabel(/email|البريد الإلكتروني/i).fill(email)
  await page.getByLabel(/^(password|كلمة المرور)$/i).fill(password)
  await page.getByRole("button", { name: /sign in|تسجيل الدخول/i }).click()
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

  stage = "dashboard and persisted MFA state"
  await page.goto("http://localhost:3107/dashboard")
  await page.waitForURL(/\/dashboard$/)
  await page.locator("main").waitFor()
  const profile = await admin.from("users").select("two_factor_enabled")
    .eq("auth_user_id", owner.data.user.id).single()
  if (profile.error || profile.data.two_factor_enabled !== true || pageErrors !== 0) {
    throw new Error("Persisted MFA state or browser runtime check failed")
  }
  console.log("PASS: owner sign-in → MFA enrollment → TOTP verification → dashboard; no browser runtime errors")
} catch (error) {
  // Avoid logging assertion values, credentials, factor secrets or page bodies.
  console.error(JSON.stringify({ result: "FAIL", stage, errorType: error.name }))
  process.exitCode = 1
} finally {
  await browser?.close()
}
