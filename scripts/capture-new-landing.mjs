// Dev helper: capture screenshots of the new landing page (AR + EN, desktop + mobile).
import puppeteer from "puppeteer-core"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  })
  const page = await browser.newPage()

  for (const [width, name] of [
    [1440, "desktop"],
    [390, "mobile"],
  ]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    for (const locale of ["ar", "en"]) {
      await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle2", timeout: 60000 })
      await page.evaluate((l) => localStorage.setItem("elite-locale", l), locale)
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 })
      await sleep(1800)
      await page.screenshot({ path: `public/_screens/new-landing-${locale}-${name}-top.png` })
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await sleep(1500)
      await page.screenshot({ path: `public/_screens/new-landing-${locale}-${name}-bottom.png` })
      console.log("saved", locale, name)
    }
  }
  await browser.close()
  console.log("done")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
