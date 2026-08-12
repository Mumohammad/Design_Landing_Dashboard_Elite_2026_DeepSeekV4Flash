import puppeteer from "puppeteer-core"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const OUT = "C:/Users/Zbook/Downloads/shadcn-dashboard-landing-template-main (1)/shadcn-dashboard-landing-template-main/nextjs-version/public/_screens"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  })
  const page = await browser.newPage()

  for (const theme of ["light", "dark"]) {
    await page.goto("http://localhost:3000/landing", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {})
    await sleep(3000)
    await page.evaluate((theme) => {
      localStorage.setItem("elite-ui-theme", theme)
      localStorage.setItem("elite-locale", "en")
      const root = document.documentElement
      root.classList.remove("light", "dark")
      root.classList.add(theme)
    }, theme)
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {})
    await sleep(3500)
    await page.screenshot({ path: `${OUT}/landing-${theme}-top.png` })
    await page.evaluate(() => document.querySelector("#showcase")?.scrollIntoView())
    await sleep(1500)
    await page.screenshot({ path: `${OUT}/landing-${theme}-showcase.png` })
    // CTA section is at the bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await sleep(2000)
    await page.screenshot({ path: `${OUT}/landing-${theme}-cta.png` })
    console.log("saved", theme)
  }
  await browser.close()
  console.log("done")
}
main().catch((e) => { console.error(e); process.exit(1) })
