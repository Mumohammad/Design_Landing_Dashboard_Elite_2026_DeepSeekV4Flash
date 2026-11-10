// Dev helper: check the landing page for horizontal overflow at key breakpoints, in both locales.
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
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))

  for (const width of [320, 375, 414, 768, 1024, 1440]) {
    await page.setViewport({ width, height: 900 })
    for (const locale of ["ar", "en"]) {
      await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle2", timeout: 60000 })
      await page.evaluate((l) => {
        localStorage.setItem("elite-locale", l)
      }, locale)
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 })
      await sleep(1200)
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        return {
          scrollW: doc.scrollWidth,
          clientW: doc.clientWidth,
          dir: doc.dir,
          overflowing: doc.scrollWidth > doc.clientWidth + 1,
        }
      })
      const worst = await page.evaluate(() => {
        let w = null
        let max = 0
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.right > document.documentElement.clientWidth + 2 && r.width > 8) {
            const over = r.right - document.documentElement.clientWidth
            if (over > max) {
              max = over
              w = { tag: el.tagName, cls: String(el.className).slice(0, 80), right: Math.round(r.right), over: Math.round(over) }
            }
          }
        })
        return w
      })
      console.log(
        `w=${width} ${locale} ${overflow.dir}: scroll=${overflow.scrollW} client=${overflow.clientW} ${overflow.overflowing ? "OVERFLOW" : "ok"}${worst ? ` worst=${worst.tag}.${worst.cls} right=${worst.right} (+${worst.over}px)` : ""}`
      )
    }
  }
  console.log("Page errors:", errors.length ? errors : "none")
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
