// Dev helper: capture Driver 360 section (light + dark, EN + AR).
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

for (const theme of ["light", "dark"]) {
  for (const locale of ["en", "ar"]) {
    await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle2", timeout: 60000 })
    await page.evaluate((l) => localStorage.setItem("elite-locale", l), locale)
    await page.evaluate((t) => {
      const root = document.documentElement
      if (t === "dark") root.classList.add("dark")
      else root.classList.remove("dark")
    }, theme)
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 })
    await sleep(2000)
    await page.evaluate(() => document.querySelector("#driver360")?.scrollIntoView({ block: "start" }))
    await sleep(2500)
    await page.screenshot({ path: `public/_screens/v3-driver360-${theme}-${locale}.png` })
    console.log("saved", theme, locale)
  }
}
await browser.close()
console.log("done")
