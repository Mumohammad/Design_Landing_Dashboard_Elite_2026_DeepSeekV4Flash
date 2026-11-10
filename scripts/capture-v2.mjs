// Dev helper: capture updated landing screenshots (full page + key sections).
import puppeteer from "puppeteer-core"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

for (const locale of ["en", "ar"]) {
  await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle2", timeout: 60000 })
  await page.evaluate((l) => localStorage.setItem("elite-locale", l), locale)
  await page.reload({ waitUntil: "networkidle2", timeout: 60000 })
  await sleep(2000)

  // full page
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(800)
  await page.screenshot({ path: `public/_screens/v2-${locale}-full.png`, fullPage: true })

  // operations section
  await page.evaluate(() => document.querySelector("#operations")?.scrollIntoView({ block: "start" }))
  await sleep(2200)
  await page.screenshot({ path: `public/_screens/v2-${locale}-operations.png` })

  // pricing section
  await page.evaluate(() => document.querySelector("#pricing")?.scrollIntoView({ block: "start" }))
  await sleep(2200)
  await page.screenshot({ path: `public/_screens/v2-${locale}-pricing.png` })

  console.log("saved", locale)
}
await browser.close()
console.log("done")
