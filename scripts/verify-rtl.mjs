// Dev helper: verify RTL/LTR sidebar placement on the landing preview and the real dashboard.
// Requires the dev server on :3000. Pass credentials via env:
//   EMAIL=... PASSWORD=... node scripts/verify-rtl.mjs
import puppeteer from "puppeteer-core"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const EMAIL = process.env.EMAIL
const PASSWORD = process.env.PASSWORD

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rectInfo(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { missing: sel }
    const r = el.getBoundingClientRect()
    const frame = el.closest("[dir]") || el.offsetParent
    const fr = frame ? frame.getBoundingClientRect() : null
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      frameLeft: fr ? Math.round(fr.left) : 0,
      frameRight: fr ? Math.round(fr.right) : window.innerWidth,
      frameDir: frame ? (frame.getAttribute("dir") || document.documentElement.dir) : document.documentElement.dir,
    }
  }, selector)
}

async function waitFor(page, sel, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true
    await sleep(300)
  }
  return false
}

async function setInput(page, selector, value) {
  // Native-setter + input event so React Hook Form sees the change.
  const ok = await page.evaluate((sel, val) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, selector, value)
  if (!ok) throw new Error(`setInput: element not found for ${selector}`)
  const actual = await page.evaluate((sel) => document.querySelector(sel)?.value, selector)
  console.log(`  ${selector} value:`, JSON.stringify(actual))
}

async function clickToggle(page, texts) {
  return page.evaluate((ts) => {
    const btns = [...document.querySelectorAll("header button, header [role='button']")]
    const target = btns.find((b) => ts.includes(b.textContent.trim()))
    if (target) {
      target.click()
      return true
    }
    return JSON.stringify(btns.map((b) => b.textContent.trim()))
  }, texts)
}

function judge(info) {
  if (!info || info.missing) return "?? (element missing)"
  const rtl = info.frameDir === "rtl"
  const onStart = rtl ? info.frameRight - info.right <= 8 : info.left - info.frameLeft <= 8
  return `${onStart ? "START" : "END"} ${onStart ? "PASS" : "FAIL"} | aside=[${info.left},${info.right}] frame=[${info.frameLeft},${info.frameRight}] dir=${info.frameDir}`
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error("Set EMAIL and PASSWORD env vars (see scripts/create-gm-test-user.mjs)")
    process.exit(1)
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  })
  const page = await browser.newPage()
  const consoleErrors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => consoleErrors.push(String(err)))

  // ── Landing page ──
  await page.goto("http://localhost:3000/landing", { waitUntil: "domcontentloaded", timeout: 25000 })
  await waitFor(page, "aside.sidebar-gradient")
  await sleep(1500)
  console.log("LANDING AR :", judge(await rectInfo(page, "aside.sidebar-gradient")))

  await clickToggle(page, ["EN"])
  await waitFor(page, "aside.sidebar-gradient")
  await sleep(1500)
  console.log("LANDING EN :", judge(await rectInfo(page, "aside.sidebar-gradient")))

  await clickToggle(page, ["عربي"])
  await waitFor(page, "aside.sidebar-gradient")
  await sleep(1500)
  console.log("LANDING AR2:", judge(await rectInfo(page, "aside.sidebar-gradient")))

  // ── Real dashboard ──
  let loggedIn = false
  for (let attempt = 1; attempt <= 4 && !loggedIn; attempt++) {
    if (attempt > 1) console.log(`Retry login attempt ${attempt}...`)
    await page.goto("http://localhost:3000/auth/sign-in", { waitUntil: "networkidle2", timeout: 60000 })
    const inputReady = await waitFor(page, 'input[type="email"]', 30000)
    console.log("Sign-in form ready:", inputReady, "| url:", page.url())
    if (!inputReady) {
      await page.screenshot({ path: "public/_screens/signin-load.png" }).catch(() => {})
      continue
    }
    // Give React hydration time to attach the onSubmit handler.
    await sleep(4000)
    await setInput(page, 'input[type="email"]', EMAIL)
    await setInput(page, 'input[type="password"]', PASSWORD)
    await page.evaluate(() => {
      const form = document.querySelector("form")
      if (form) form.requestSubmit()
    })

    for (let i = 0; i < 30; i++) {
      await sleep(1000)
      if (!page.url().includes("/auth/sign-in")) {
        loggedIn = true
        break
      }
    }
    console.log("URL after login:", page.url(), loggedIn ? "(OK)" : "(STILL ON SIGN-IN)")
    if (!loggedIn) {
      const err = await page.evaluate(() => document.querySelector(".text-destructive")?.textContent ?? "no visible error")
      console.log("Form error:", err)
    }
  }

  const sideSel = "[data-slot='sidebar-container']"
  await waitFor(page, sideSel, 15000)
  console.log("DASH   AR :", judge(await rectInfo(page, sideSel)))

  await clickToggle(page, ["EN", "ع"])
  await sleep(1800)
  console.log("DASH   EN :", judge(await rectInfo(page, sideSel)))

  await clickToggle(page, ["عربي", "ع"])
  await sleep(1800)
  console.log("DASH   AR2:", judge(await rectInfo(page, sideSel)))

  console.log("\nConsole errors:", consoleErrors.length ? consoleErrors : "none")
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
