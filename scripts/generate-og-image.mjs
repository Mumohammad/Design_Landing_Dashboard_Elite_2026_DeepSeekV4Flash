// Dev helper: generate public/og-cover.png (1200×630) — brand + dashboard mock.
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: 'Segoe UI', Arial, sans-serif; }
  .wrap { width: 1200px; height: 630px; display: flex; align-items: center; gap: 56px; padding: 56px 72px;
    background: radial-gradient(1200px 500px at 85% -10%, rgba(232,125,62,.28), transparent 55%),
                radial-gradient(900px 500px at -10% 110%, rgba(30,90,153,.55), transparent 60%),
                linear-gradient(135deg, #0B2A4A 0%, #0F3A66 55%, #14477E 100%);
    color: #fff; position: relative; }
  .grid { position: absolute; inset: 0; background-image:
      radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px);
    background-size: 22px 22px; }
  .left { flex: 0 0 560px; position: relative; z-index: 1; }
  .logo { display: inline-flex; align-items: center; gap: 16px; }
  .mono { width: 64px; height: 64px; border-radius: 18px; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #1E5A99, #E87D3E); font-size: 26px; font-weight: 800; box-shadow: 0 14px 30px rgba(0,0,0,.35); }
  .brand { font-size: 34px; font-weight: 800; letter-spacing: .5px; }
  .brandAr { font-size: 20px; font-weight: 700; color: rgba(255,255,255,.75); margin-top: 2px; }
  h1 { margin-top: 34px; font-size: 44px; line-height: 1.18; font-weight: 800; }
  .sub { margin-top: 18px; font-size: 20px; line-height: 1.5; color: rgba(255,255,255,.78); max-width: 520px; }
  .chips { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25);
    background: rgba(255,255,255,.08); font-size: 15px; font-weight: 600; }
  .right { flex: 1; position: relative; z-index: 1; display: flex; gap: 18px; align-items: stretch; }
  .side { width: 104px; border-radius: 16px; background: rgba(6,26,43,.85); border: 1px solid rgba(255,255,255,.12);
    padding: 14px 12px; display: flex; flex-direction: column; gap: 10px; }
  .side .row { height: 12px; border-radius: 6px; background: rgba(255,255,255,.16); }
  .side .row.on { background: linear-gradient(90deg, #1E5A99, #E87D3E); }
  .side .brand { font-size: 12px; color: #fff; margin-bottom: 4px; }
  .panel { flex: 1; background: rgba(255,255,255,.97); border-radius: 16px; padding: 18px; color: #10243B;
    display: flex; flex-direction: column; gap: 12px; box-shadow: 0 30px 60px rgba(0,0,0,.35); }
  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .kpi { border: 1px solid #e3e9f0; border-radius: 12px; padding: 12px; }
  .kpi .l { font-size: 11px; color: #64748b; font-weight: 600; }
  .kpi .v { font-size: 21px; font-weight: 800; margin-top: 3px; }
  .kpi .d { font-size: 10px; font-weight: 700; margin-top: 4px; color: #10b981; }
  .chart { flex: 1; border: 1px solid #e3e9f0; border-radius: 12px; padding: 12px; display: flex; align-items: flex-end; gap: 8px; }
  .bar { flex: 1; border-radius: 5px 5px 0 0; background: linear-gradient(180deg, #1E5A99, #7FB0E8); }
  .bar.top { background: linear-gradient(180deg, #1E5A99, #E87D3E); }
</style>
</head>
<body>
<div class="wrap">
  <div class="grid"></div>
  <div class="left">
    <div class="logo">
      <div class="mono">ED</div>
      <div>
        <div class="brand">Elite Development</div>
        <div class="brandAr">نخبة التطوير</div>
      </div>
    </div>
    <h1>Enterprise Logistics<br />Operations Platform</h1>
    <p class="sub">Drivers · Fleet · Vehicles · Orders · Payroll · Compliance · Reporting — one operational system.</p>
    <div class="chips">
      <span class="chip">Driver 360°</span>
      <span class="chip">Payroll</span>
      <span class="chip">Cost Control</span>
      <span class="chip">Arabic + English</span>
    </div>
  </div>
  <div class="right">
    <div class="side">
      <div class="brand">ED</div>
      <div class="row on"></div>
      <div class="row"></div>
      <div class="row"></div>
      <div class="row"></div>
      <div class="row"></div>
      <div class="row"></div>
    </div>
    <div class="panel">
      <div class="kpis">
        <div class="kpi"><div class="l">Active drivers</div><div class="v">1,248</div><div class="d">▲ 4.2%</div></div>
        <div class="kpi"><div class="l">Vehicles</div><div class="v">386</div><div class="d">▲ 1.1%</div></div>
        <div class="kpi"><div class="l">Monthly orders</div><div class="v">18,420</div><div class="d">▲ 8.7%</div></div>
        <div class="kpi"><div class="l">Monthly payroll</div><div class="v">SAR 2.4M</div><div class="d" style="color:#e11d48">▼ 2.3%</div></div>
      </div>
      <div class="chart">
        <div class="bar" style="height:42%"></div>
        <div class="bar" style="height:55%"></div>
        <div class="bar" style="height:48%"></div>
        <div class="bar" style="height:64%"></div>
        <div class="bar" style="height:58%"></div>
        <div class="bar top" style="height:82%"></div>
        <div class="bar" style="height:70%"></div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: "networkidle0" })
  await page.screenshot({ path: "public/og-cover.png", type: "png" })
  await browser.close()
  console.log("saved public/og-cover.png")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
