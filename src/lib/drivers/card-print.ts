import type {DriverCard,DriverCardPerson} from "./cards"
import {DEFAULT_CARD_PLATFORM,platformTheme,type CardTheme} from "./platforms"
const CONTACT_EMAIL="Info@elitedev.com.sa"
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")
const expiryText=(expiresAt:string|null|undefined)=>expiresAt?new Date(expiresAt).toLocaleDateString("en-GB"):""

export type DriverCardOutputFormat="pvc"|"a4"
/** One printable rider card: platform theme + the rider ID shown on the face. */
export interface RiderCardFace {theme:CardTheme;riderId:string;footerRef?:string|null;expiresAt?:string|null;title?:string}

function faces(face:RiderCardFace,person:DriverCardPerson|null):{front:string;back:string}{
  const t=face.theme
  const name=esc(person?.name??"—"),phone=esc(person?.phone??"—"),idNumber=esc(person?.idNumber??"—")
  const rider=esc(face.riderId),ref=esc(face.footerRef??""),expiry=esc(expiryText(face.expiresAt))
  const photo=person?.photoUrl?esc(person.photoUrl):""
  const slot=`position:absolute;top:14px;left:50%;transform:translateX(-50%);width:64px;height:12px;border-radius:8px;background:rgba(0,0,0,0.12);`
  const cardCss=`box-sizing:border-box;transform-origin:top left;transform:scale(0.68031496063,0.679680413);width:300px;height:476px;background:${t.body};border-radius:24px;overflow:hidden;position:relative;border:1px solid #d9d9d9;font-family:Arial,Helvetica,sans-serif;`
  const mark=(color:string,size:number)=>`<div style="color:${color};font-weight:800;font-size:${size}px;letter-spacing:1.5px;line-height:1.05;text-align:center;">${t.wordmark.map(esc).join("<br/>")}</div>`
  const front=`
  <div style="${cardCss}">
    <div style="${slot}"></div>
    <div style="margin:50px auto 0;width:118px;height:118px;border-radius:18px;background:#fff;border:5px solid ${t.frame};overflow:hidden;display:flex;align-items:center;justify-content:center;">
      ${photo?`<img src="${photo}" style="width:100%;height:100%;object-fit:contain;" alt="" />`:""}
    </div>
    <div style="padding:14px 24px 0;font-size:14.5px;font-weight:700;line-height:1.85;">
      <div><span style="color:${t.label}">Name: </span><span style="color:${t.value}">${name}</span></div>
      <div><span style="color:${t.label}">Mobile: </span><span style="color:${t.value}">${phone}</span></div>
      <div><span style="color:${t.label}">ID Number: </span><span style="color:${t.value}">${idNumber}</span></div>
      <div><span style="color:${t.label}">Rider ID: </span><span style="color:${t.value}">${rider}</span></div>
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;">
      <svg viewBox="0 0 300 26" preserveAspectRatio="none" style="display:block;width:100%;height:26px;margin-bottom:-1px;"><path d="M0,20 C70,0 230,26 300,8 L300,26 L0,26 Z" fill="${t.band}"/></svg>
      <div style="background:${t.band};padding:6px 0 16px;text-align:center;">
        ${mark(t.bandText,19)}
        <div style="color:${t.bandText};opacity:0.9;font-size:9.5px;margin-top:3px;">${expiry?`Valid thru ${expiry}`:""}</div>
      </div>
    </div>
  </div>`
  const back=`
  <div style="${cardCss}">
    <div style="${slot}"></div>
    <div style="margin:70px auto 0;width:178px;padding:14px 0;background:#fff;border:6px solid ${t.frame};border-radius:18px;text-align:center;">
      ${mark(t.frame,19)}
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;">
      <svg viewBox="0 0 300 26" preserveAspectRatio="none" style="display:block;width:100%;height:26px;margin-bottom:-1px;"><path d="M0,8 C70,26 230,0 300,20 L300,26 L0,26 Z" fill="${t.band}"/></svg>
      <div style="background:${t.band};padding:14px 24px 24px;text-align:center;">
        <p dir="rtl" style="color:${t.bandText};font-weight:700;font-size:15px;margin:0;">إذا وجدت هذه البطاقة يرجى التواصل معنا</p>
        <p style="color:${t.bandText};font-size:12px;margin:6px 0 0;">If this card is found, please contact us.</p>
        <p style="color:${t.bandAccent};font-weight:700;font-size:12.5px;margin:8px 0 0;">Email: ${CONTACT_EMAIL}</p>
        <p style="color:${t.bandText};opacity:0.85;font-size:9.5px;margin:6px 0 0;">${ref}</p>
      </div>
    </div>
  </div>`
  return {front,back}
}

/** Printable document for one or more rider cards (front + back each). */
export function buildRiderCardsPrintHtml(cards:RiderCardFace[],person:DriverCardPerson|null,format:DriverCardOutputFormat="pvc"):string{
  if(format!=="pvc"&&format!=="a4")throw Error("Unsupported driver card output format")
  if(cards.length<1)throw Error("No cards to print")
  const sheets=cards.map(card=>{const f=faces(card,person);return `<div class="card-sheet" data-card-face="front">${f.front}</div>\n<div class="card-sheet" data-card-face="back">${f.back}</div>`}).join("\n")
  const title=esc(cards.length===1?(cards[0].title??`Rider card ${cards[0].riderId}`):`Rider cards (${cards.length})`)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: ${format==="pvc"?"54mm 85.6mm":"A4 portrait"}; margin: ${format==="pvc"?"0":"12mm"}; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { margin: 0; display: flex; flex-wrap: wrap; gap: 8mm; justify-content: center; align-items: flex-start; }
  .card-sheet { flex: 0 0 54mm; width: 54mm; height: 85.6mm; overflow: hidden; break-inside: avoid; }
  @media print { ${format==="pvc"?"body { display:block; width:54mm; } .card-sheet { break-after:page; } .card-sheet:last-child { break-after:auto; }":""} }
  @media screen { body { padding: 24px; background: #eef2f6; } }
</style>
</head>
<body data-card-format="${format}">
${sheets}
</body>
</html>`
}

/**
 * Issued EliteDev card (driver_cards). The Rider ID is the driver's platform
 * rider ID when known (primary platform account); otherwise the card serial.
 */
export function buildCardPrintHtml(card: DriverCard, person: DriverCardPerson | null,format:DriverCardOutputFormat="pvc",platform?:{code:string;riderId:string}|null): string {
  if(format!=="pvc"&&format!=="a4")throw Error("Unsupported driver card output format")
  return buildRiderCardsPrintHtml([{theme:platformTheme(platform?.code??DEFAULT_CARD_PLATFORM),riderId:platform?.riderId||card.card_serial,footerRef:card.card_serial,expiresAt:card.expires_at,title:`Rider card ${card.card_serial}`}],person,format)
}
