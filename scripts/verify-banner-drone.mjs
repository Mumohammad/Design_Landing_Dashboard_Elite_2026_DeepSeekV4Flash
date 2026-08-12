import puppeteer from "puppeteer-core"

const CHROME =
  "C:/Program Files/Google/Chrome/Application/chrome.exe"

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
})

async function checkLanding() {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => consoleErrors.push(String(err)))

  await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle2", timeout: 60000 })
  await page.waitForSelector("img[src*='Banner']", { timeout: 15000 }).catch(() => {})

  // Scroll both drone sections into view so lazy images decode.
  await page.evaluate(() => {
    document.getElementById("operations")?.scrollIntoView()
  })
  await new Promise((r) => setTimeout(r, 1500))
  await page.evaluate(() => {
    document.getElementById("driver360")?.scrollIntoView()
  })
  await new Promise((r) => setTimeout(r, 1500))

  const droneImgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .filter((img) => img.src.includes("drone") || img.src.includes("Banner"))
      .map((img) => ({ src: img.src, w: img.naturalWidth, h: img.naturalHeight, broken: img.naturalWidth === 0 }))
  )

  const broken = await page.evaluate(async () => {
    const imgs = Array.from(document.images)
    const results = []
    for (const img of imgs) {
      if (img.complete && img.naturalWidth === 0) results.push(img.src)
    }
    return results
  })

  console.log("LANDING drone/Banner images:", JSON.stringify(droneImgs, null, 2))
  console.log("LANDING broken images:", JSON.stringify(broken))
  console.log("LANDING console errors:", JSON.stringify(consoleErrors))
  await page.close()
}

async function checkVerifyRoute() {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => consoleErrors.push(String(err)))

  await page.goto("http://localhost:3000/verify-document/TEST-DOC-1234", { waitUntil: "networkidle2", timeout: 60000 })

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300))
  const hasCard = await page.evaluate(() => !!document.querySelector(".bg-red-600"))
  console.log("VERIFY route body:", bodyText.replace(/\n+/g, " | ").slice(0, 250))
  console.log("VERIFY red not-found card:", hasCard)
  console.log("VERIFY console errors:", JSON.stringify(consoleErrors))
  await page.close()
}

await checkLanding()
await checkVerifyRoute()
await browser.close()
