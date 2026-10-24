import type {DriverCard,DriverCardPerson} from "./cards"
const YELLOW="#F8E71C",BLUE="#0AA9CE",BROWN="#8B3A2F",MAROON="#5C2E2E",CONTACT_EMAIL="Info@elitedev.com.sa"
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")
const expiryText=(card:DriverCard)=>card.expires_at?new Date(card.expires_at).toLocaleDateString("en-GB"):""

// Self-contained print document — front + back, identical layout (print-to-PDF
// via the browser dialog keeps the same rendering).
export type DriverCardOutputFormat="pvc"|"a4"
export function buildCardPrintHtml(card: DriverCard, person: DriverCardPerson | null,format:DriverCardOutputFormat="pvc"): string {
  if(format!=="pvc"&&format!=="a4")throw Error("Unsupported driver card output format")
  const name = esc(person?.name ?? "—")
  const phone = esc(person?.phone ?? "—")
  const idNumber = esc(person?.idNumber ?? "—")
  const serial = esc(card.card_serial)
  const expiry = esc(expiryText(card))
  const photo = person?.photoUrl ? esc(person.photoUrl) : ""

  const slot = `position:absolute;top:14px;left:50%;transform:translateX(-50%);width:64px;height:12px;border-radius:8px;background:rgba(0,0,0,0.12);`
  const cardCss = `box-sizing:border-box;transform-origin:top left;transform:scale(0.68031496063,0.679680413);width:300px;height:476px;background:${YELLOW};border-radius:24px;overflow:hidden;position:relative;border:1px solid #d9d9d9;font-family:Arial,Helvetica,sans-serif;`
  const brand = (color: string, size: number) =>
    `<div style="color:${color};font-weight:800;font-size:${size}px;letter-spacing:1.5px;line-height:1.05;text-align:center;">HUNGER<br/>STATION</div>`

  const front = `
  <div style="${cardCss}">
    <div style="${slot}"></div>
    <div style="margin:50px auto 0;width:118px;height:118px;border-radius:18px;background:#fff;border:5px solid ${MAROON};overflow:hidden;display:flex;align-items:center;justify-content:center;">
      ${photo ? `<img src="${photo}" style="width:100%;height:100%;object-fit:contain;" alt="" />` : ""}
    </div>
    <div style="padding:14px 24px 0;font-size:14.5px;font-weight:700;line-height:1.85;">
      <div><span style="color:${BLUE}">Name: </span><span style="color:${BROWN}">${name}</span></div>
      <div><span style="color:${BLUE}">Mobile: </span><span style="color:${BROWN}">${phone}</span></div>
      <div><span style="color:${BLUE}">ID Number: </span><span style="color:${BROWN}">${idNumber}</span></div>
      <div><span style="color:${BLUE}">Rider ID: </span><span style="color:${BROWN}">${serial}</span></div>
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;">
      <svg viewBox="0 0 300 26" preserveAspectRatio="none" style="display:block;width:100%;height:26px;"><path d="M0,20 C70,0 230,26 300,8 L300,26 L0,26 Z" fill="${BLUE}"/></svg>
      <div style="background:${BLUE};padding:6px 0 16px;text-align:center;">
        ${brand("#ffffff", 19)}
        <div style="color:rgba(255,255,255,0.9);font-size:9.5px;margin-top:3px;">${expiry ? `Valid thru ${expiry}` : ""}</div>
      </div>
    </div>
  </div>`

  const back = `
  <div style="${cardCss}">
    <div style="${slot}"></div>
    <div style="margin:70px auto 0;width:178px;padding:14px 0;background:#fff;border:6px solid ${MAROON};border-radius:18px;text-align:center;">
      ${brand(MAROON, 19)}
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;">
      <svg viewBox="0 0 300 26" preserveAspectRatio="none" style="display:block;width:100%;height:26px;"><path d="M0,8 C70,26 230,0 300,20 L300,26 L0,26 Z" fill="${BLUE}"/></svg>
      <div style="background:${BLUE};padding:14px 24px 24px;text-align:center;">
        <p dir="rtl" style="color:#fff;font-weight:700;font-size:15px;margin:0;">إذا وجدت هذه البطاقة يرجى التواصل معنا</p>
        <p style="color:#fff;font-size:12px;margin:6px 0 0;">If this card is found, please contact us.</p>
        <p style="color:${YELLOW};font-weight:700;font-size:12.5px;margin:8px 0 0;">Email: ${CONTACT_EMAIL}</p>
        <p style="color:rgba(255,255,255,0.85);font-size:9.5px;margin:6px 0 0;">${serial}</p>
      </div>
    </div>
  </div>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Rider card ${serial}</title>
<style>
  @page { size: ${format==="pvc"?"54mm 85.6mm":"A4 portrait"}; margin: ${format==="pvc"?"0":"12mm"}; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { margin: 0; display: flex; gap: 8mm; justify-content: center; align-items: flex-start; }
  .card-sheet { flex: 0 0 54mm; width: 54mm; height: 85.6mm; overflow: hidden; break-inside: avoid; }
  @media print { ${format==="pvc"?"body { display:block; width:54mm; } .card-sheet { break-after:page; } .card-sheet:last-child { break-after:auto; }":""} }
  @media screen { body { padding: 24px; flex-wrap: wrap; background: #eef2f6; } }
</style>
</head>
<body data-card-format="${format}">
<div class="card-sheet" data-card-face="front">${front}</div>
<div class="card-sheet" data-card-face="back">${back}</div>
</body>
</html>`
}
