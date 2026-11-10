// Dev helper: fetch the missing delivery-platform wordmark logos (noon,
// keemart, noon-electronics) by loading each site in a real Chrome browser
// (bypasses bot protection) and extracting header logos.
// Output: public/platform-logos/{name}.png
import { writeFile } from "node:fs/promises"
import puppeteer from "puppeteer-core"
import sharp from "sharp"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const OUT = "C:/Users/Zbook/Downloads/shadcn-dashboard-landing-template-main (1)/shadcn-dashboard-landing-template-main/nextjs-version/public/platform-logos"

const sites = [
  { name: "noon", url: "https://www.noon.com" },
  { name: "keemart", url: "https://keemart.com" },
  { name: "noon-electronics", url: "https://www.noon.com/noon-electronics" },
]

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  })

  for (const site of sites) {
    try {
      const page = await browser.newPage()
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      )
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 6000))

      const result = await page.evaluate(async () => {
        const isBotBlocked =
          /just a moment|cf-browser-verification|cloudflare/i.test(document.title) ||
          (document.body && document.body.innerHTML.includes("cf-challenge")) ||
          (document.body && document.body.innerHTML.includes("challenge-form"))
        if (isBotBlocked) return { blocked: true }

        const candidates = []
        document.querySelectorAll("header img, nav img, [class*='logo'] img, a img, img[src*='logo']").forEach((el) => {
          const src = el.getAttribute("src") || el.getAttribute("data-src") || ""
          if (src && src.length > 4) {
            candidates.push({ kind: "img", src: new URL(src, location.href).href })
          }
        })

        document.querySelectorAll("svg").forEach((el) => {
          const html = el.outerHTML
          if (html.length > 800) {
            const w = el.getAttribute("width")
            const h = el.getAttribute("height")
            const vw = el.getAttribute("viewBox")
            const numW = w ? parseInt(w) : 0
            const numH = h ? parseInt(h) : 0
            if (numW >= 60 || numH >= 40 || (vw && vw.split(" ")[2] && parseInt(vw.split(" ")[2]) >= 60)) {
              candidates.push({ kind: "svg", size: html.length, html })
            }
          }
        })
        return { blocked: false, candidates: candidates.slice(0, 15) }
      })

      if (result.blocked) {
        console.log(`${site.name}: BLOCKED by bot protection`)
      } else {
        const svgCandidates = result.candidates.filter((c) => c.kind === "svg")
        const imgCandidates = result.candidates.filter((c) => c.kind === "img")
        console.log(`\n=== ${site.name} ===  imgs:${imgCandidates.length} svgs:${svgCandidates.length}`)
        console.log("img urls:", imgCandidates.map((c) => c.src).join("\n  "))

        let saved = false
        if (svgCandidates.length) {
          const best = svgCandidates.sort((a, b) => b.size - a.size)[0]
          if (best.html.includes("<text") || best.html.split("<path").length > 2) {
            const png = await sharp(Buffer.from(best.html), { density: 96 }).png().toBuffer()
            await writeFile(`${OUT}/${site.name}.png`, png)
            console.log(`Saved ${site.name}.png (from inline svg, ${png.length} bytes)`)
            saved = true
          }
        }
        if (!saved && imgCandidates.length) {
          const svgImgs = imgCandidates.filter((c) => c.src.endsWith(".svg"))
          const target = svgImgs[0] || imgCandidates[0]
          try {
            const res = await page.evaluate(async (url) => {
              const r = await fetch(url)
              if (!r.ok) return null
              const ct = r.headers.get("content-type") || ""
              if (ct.includes("svg") || url.endsWith(".svg")) return { kind: "svg", text: await r.text() }
              const buf = await r.arrayBuffer()
              return { kind: "img", b64: Buffer.from(buf).toString("base64") }
            }, target.src)
            if (res && res.kind === "svg" && res.text.trim().startsWith("<svg")) {
              const png = await sharp(Buffer.from(res.text), { density: 96 }).png().toBuffer()
              await writeFile(`${OUT}/${site.name}.png`, png)
              console.log(`Saved ${site.name}.png (from img svg, ${png.length} bytes)`)
              saved = true
            } else if (res && res.kind === "img") {
              const buf = Buffer.from(res.b64, "base64")
              const png = await sharp(buf).png().toBuffer()
              await writeFile(`${OUT}/${site.name}.png`, png)
              console.log(`Saved ${site.name}.png (from img tag, ${png.length} bytes)`)
              saved = true
            }
          } catch (e) {
            console.log("img fetch error:", e.message)
          }
        }
        if (!saved) console.log(`No usable logo found for ${site.name}`)
      }
      await page.close()
    } catch (err) {
      console.error(`Error for ${site.name}:`, err.message)
    }
  }

  await browser.close()
  console.log("\nDone.")
}

main()
