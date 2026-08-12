// Dev helper: generate public/drone-elite.webp — a clean, brand-owned drone
// visual (no third-party branding) rendered via Chrome and optimized with sharp.
import puppeteer from "puppeteer-core"
import sharp from "sharp"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 900px; height: 900px; overflow: hidden; background: #081c33; }
</style>
</head>
<body>
<svg width="900" height="900" viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="#16487f" />
      <stop offset="55%" stop-color="#0b264f" />
      <stop offset="100%" stop-color="#071a33" />
    </radialGradient>
    <radialGradient id="glowOrange" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2EBB77" stop-opacity="0.38" />
      <stop offset="100%" stop-color="#2EBB77" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glowBlue" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#4FA97F" stop-opacity="0.45" />
      <stop offset="100%" stop-color="#4FA97F" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2E9E6B" />
      <stop offset="45%" stop-color="#1B7A4B" />
      <stop offset="100%" stop-color="#0F4629" />
    </linearGradient>
    <linearGradient id="bag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F6FAF3" />
      <stop offset="60%" stop-color="#E9F1E4" />
      <stop offset="100%" stop-color="#D8E4D0" />
    </linearGradient>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.6" fill="rgba(255,255,255,0.07)" />
    </pattern>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="14" />
    </filter>
    <filter id="shadow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="22" />
    </filter>
  </defs>

  <rect width="900" height="900" fill="url(#bg)" />
  <rect width="900" height="900" fill="url(#dots)" />

  <!-- ambient glows -->
  <ellipse cx="450" cy="330" rx="330" ry="260" fill="url(#glowBlue)" />
  <ellipse cx="450" cy="600" rx="280" ry="220" fill="url(#glowOrange)" filter="url(#soft)" />

  <!-- radar ring -->
  <circle cx="450" cy="400" r="215" fill="none" stroke="#2EBB77" stroke-opacity="0.22" stroke-width="2" stroke-dasharray="6 10" />
  <circle cx="450" cy="400" r="160" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1.5" />

  <!-- floor shadow -->
  <ellipse cx="450" cy="715" rx="150" ry="26" fill="rgba(0,0,0,0.4)" filter="url(#shadow)" />

  <!-- rotors -->
  <g>
    <line x1="450" y1="400" x2="300" y2="305" stroke="rgba(255,255,255,0.22)" stroke-width="5" />
    <line x1="450" y1="400" x2="600" y2="305" stroke="rgba(255,255,255,0.22)" stroke-width="5" />
    <line x1="450" y1="400" x2="320" y2="475" stroke="rgba(255,255,255,0.22)" stroke-width="5" />
    <line x1="450" y1="400" x2="580" y2="475" stroke="rgba(255,255,255,0.22)" stroke-width="5" />
  </g>
  <g fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.35)" stroke-width="2.5">
    <ellipse cx="300" cy="305" rx="55" ry="11" transform="rotate(24 300 305)" />
    <ellipse cx="300" cy="305" rx="55" ry="11" transform="rotate(114 300 305)" />
    <ellipse cx="600" cy="305" rx="55" ry="11" transform="rotate(-24 600 305)" />
    <ellipse cx="600" cy="305" rx="55" ry="11" transform="rotate(-114 600 305)" />
    <ellipse cx="320" cy="475" rx="55" ry="11" transform="rotate(8 320 475)" />
    <ellipse cx="320" cy="475" rx="55" ry="11" transform="rotate(98 320 475)" />
    <ellipse cx="580" cy="475" rx="55" ry="11" transform="rotate(-8 580 475)" />
    <ellipse cx="580" cy="475" rx="55" ry="11" transform="rotate(-98 580 475)" />
  </g>
  <g fill="#3DCE8C">
    <circle cx="300" cy="305" r="9" />
    <circle cx="600" cy="305" r="9" />
    <circle cx="320" cy="475" r="9" />
    <circle cx="580" cy="475" r="9" />
  </g>
  <g fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2.5">
    <circle cx="300" cy="305" r="61" />
    <circle cx="600" cy="305" r="61" />
    <circle cx="320" cy="475" r="61" />
    <circle cx="580" cy="475" r="61" />
  </g>

  <!-- drone body -->
  <g>
    <path d="M 505 396 L 505 438 Q 505 452 491 456 L 409 456 Q 395 452 395 438 L 395 396 Q 395 380 409 376 L 491 376 Q 505 380 505 396 Z"
          fill="url(#body)" stroke="rgba(255,255,255,0.22)" stroke-width="3" />
    <!-- top label -->
    <rect x="408" y="381" width="84" height="26" rx="7" fill="rgba(255,255,255,0.94)" />
    <text x="450" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="800" fill="#14502F" letter-spacing="1">ED</text>
    <!-- green accent stripe -->
    <rect x="440" y="420" width="20" height="5" rx="2.5" fill="#3DCE8C" />
    <!-- camera gimbal -->
    <circle cx="450" cy="462" r="14" fill="#0d2c1e" stroke="rgba(255,255,255,0.25)" stroke-width="2.5" />
    <circle cx="450" cy="462" r="5" fill="#3DCE8C" />
  </g>

  <!-- straps -->
  <line x1="422" y1="456" x2="416" y2="512" stroke="#5a5a5a" stroke-width="5" stroke-linecap="round" />
  <line x1="478" y1="456" x2="484" y2="512" stroke="#5a5a5a" stroke-width="5" stroke-linecap="round" />

  <!-- delivery bag -->
  <g>
    <rect x="378" y="512" width="144" height="168" rx="18" fill="url(#bag)" stroke="#14502F" stroke-width="6" />
    <!-- inner frame -->
    <rect x="390" y="524" width="120" height="144" rx="12" fill="none" stroke="#14502F" stroke-opacity="0.55" stroke-width="2.5" />
    <text x="450" y="576" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#14502F" letter-spacing="1">ED</text>
    <rect x="424" y="592" width="52" height="5" rx="2.5" fill="#2EBB77" />
    <text x="450" y="624" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#14502F" letter-spacing="3">ELITE</text>
    <!-- green bottom band -->
    <rect x="378" y="650" width="144" height="30" rx="10" fill="#14502F" />
    <rect x="378" y="662" width="144" height="18" fill="#14502F" />
    <text x="450" y="672" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#E9F1E4">نخبة التطوير</text>
  </g>

  <!-- sparkles -->
  <g fill="#ffffff">
    <path d="M 168 210 l 3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" opacity="0.55" />
    <path d="M 742 250 l 2.5 7 7 2.5 -7 2.5 -2.5 7 -2.5 -7 -7 -2.5 7 -2.5 Z" opacity="0.45" />
    <path d="M 130 640 l 2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 Z" opacity="0.4" />
    <path d="M 762 600 l 2.5 7 7 2.5 -7 2.5 -2.5 7 -2.5 -7 -7 -2.5 7 -2.5 Z" opacity="0.5" />
  </g>
  <g fill="#3DCE8C">
    <circle cx="218" cy="470" r="4" opacity="0.75" />
    <circle cx="690" cy="420" r="3" opacity="0.65" />
    <circle cx="240" cy="330" r="3" opacity="0.55" />
  </g>
</svg>
</body>
</html>`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: "networkidle0" })
const shot = await page.screenshot({ type: "png" })
await browser.close()

await sharp(shot).resize(900, 900).webp({ quality: 84 }).toFile("public/drone-elite.webp")
console.log("Written public/drone-elite.webp")
