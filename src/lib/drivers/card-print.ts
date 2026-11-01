import type {DriverCard,DriverCardPerson} from "./cards"
import {DEFAULT_CARD_PLATFORM,platformTheme,type CardTheme} from "./platforms"
const CONTACT_EMAIL="Info@elitedev.com.sa"
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")
const expiryText=(expiresAt:string|null|undefined)=>expiresAt?new Date(expiresAt).toLocaleDateString("en-GB"):""

export type DriverCardOutputFormat="pvc"|"a4"
/** One printable rider card: platform theme + the rider ID shown on the face. */
export interface RiderCardFace {theme:CardTheme;riderId:string;footerRef?:string|null;expiresAt?:string|null;title?:string}

// Card faces are drawn as one SVG per side on a 300×476 canvas (54×85.6 mm
// CR80 ratio). The exact same markup is used by the on-screen preview and the
// print window, so what you see is what prints. Geometry mirrors the
// reference HungerStation rider card (yellow body, framed photo with the
// bubble tab, curved bottom band, stacked wordmark).
const FONT="Inter,'Segoe UI',Arial,Helvetica,sans-serif"
let faceSeq=0
const fit=(text:string,base:number,max:number)=>text.length>max?Math.max(base*0.62,base*max/text.length):base
// Rounded frame with the HungerStation-style tab at the top-left corner.
const framePath=(x0:number,y0:number,x1:number,y1:number,r:number)=>{
  const w=x1-x0,join=x0+w*0.46,tab=x0+w*0.17
  return {
    clip:`M${join},${y0} H${x1-r} Q${x1},${y0} ${x1},${y0+r} V${y1-r} Q${x1},${y1} ${x1-r},${y1} H${x0+r} Q${x0},${y1} ${x0},${y1-r} V${y0+r*1.55} Q${x0},${y0+r*0.6} ${x0+r*1.05},${y0+r*0.42} L${join},${y0+0.6} Z`,
    stroke:`M${tab},${y0} H${x1-r} Q${x1},${y0} ${x1},${y0+r} V${y1-r} Q${x1},${y1} ${x1-r},${y1} H${x0+r} Q${x0},${y1} ${x0},${y1-r} V${y0+r*1.55} Q${x0},${y0+r*0.6} ${x0+r*1.05},${y0+r*0.42} L${join},${y0+0.6}`,
  }
}
const SLOT=`<rect x="122.7" y="17.3" width="54.6" height="8.3" rx="4.15" fill="#E5E7EB" stroke="#CBD5E1" stroke-width="0.7"/>`
const svgOpen=(t:CardTheme,face:"front"|"back",extra="")=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 476" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%;" data-testid="rider-card-${face}"${extra} font-family="${FONT}"><defs><clipPath id="CLIPCARD"><rect width="300" height="476" rx="15.5"/></clipPath></defs><g clip-path="url(#CLIPCARD)"><rect width="300" height="476" fill="${t.body}"/>`

function faces(face:RiderCardFace,person:DriverCardPerson|null,idSeed?:string):{front:string;back:string}{
  const t=face.theme,uid=`rc${(idSeed??String(++faceSeq)).replace(/[^A-Za-z0-9_-]/g,"")}`
  const nameRaw=person?.name??"—",phoneRaw=person?.phone??"—",idRaw=person?.idNumber??"—",riderRaw=face.riderId
  const photo=person?.photoUrl?esc(person.photoUrl):""
  const meta=` data-rider-id="${esc(riderRaw)}"${face.footerRef?` data-card-ref="${esc(face.footerRef)}"`:""}${face.expiresAt?` data-expires="${esc(expiryText(face.expiresAt))}"`:""}`
  const line=(y:number,label:string,value:string)=>{const size=fit(label+value,12.9,24);return `<text x="150" y="${y}" text-anchor="middle" font-size="${size.toFixed(2)}"><tspan fill="${t.label}" font-weight="700">${label}: </tspan><tspan fill="${t.value}" font-weight="500">${esc(value)}</tspan></text>`}
  const mark=(lines:string[],color:string,size:number,firstBaseline:number,gap:number)=>lines.map((l,i)=>`<text x="150" y="${firstBaseline+i*gap}" text-anchor="middle" font-size="${fit(l,size,9).toFixed(2)}" font-weight="${i===0?800:600}" fill="${color}">${esc(l)}</text>`).join("")
  const pf=framePath(83,55.3,217,189.4,13.5)
  const silhouette=`<circle cx="150" cy="108" r="20" fill="#CBD5E1"/><path d="M112,176 Q114,140 150,138 Q186,140 188,176 Z" fill="#CBD5E1"/>`
  const front=svgOpen(t,"front",meta).replace(/CLIPCARD/g,`${uid}c`)+SLOT+
    `<clipPath id="${uid}p"><path d="${pf.clip}"/></clipPath>`+
    `<path d="${pf.clip}" fill="#FFFFFF"/>`+
    (photo?`<image href="${photo}" x="83" y="55" width="134" height="135" preserveAspectRatio="xMidYMid slice" clip-path="url(#${uid}p)"/>`:`<g clip-path="url(#${uid}p)">${silhouette}</g>`)+
    `<path d="${pf.stroke}" fill="none" stroke="${t.frame}" stroke-width="2.8" stroke-linejoin="round"/>`+
    line(212.5,"Name",nameRaw)+line(233.2,"Mobile",phoneRaw)+line(253.9,"ID Number",idRaw)+line(274.6,"Rider ID",riderRaw)+
    `<path d="M0,309.3 Q150,327 300,309.3 V476 H0 Z" fill="${t.band}"/>`+
    mark(t.wordmark,t.bandText,24,t.wordmark.length>1?380:393,26)+
    `</g></svg>`
  const lf=framePath(80.2,69.1,219.8,138.2,14)
  const back=svgOpen(t,"back",meta).replace(/CLIPCARD/g,`${uid}b`)+SLOT+
    `<path d="${lf.clip}" fill="#FFFFFF"/><path d="${lf.stroke}" fill="none" stroke="${t.frame}" stroke-width="2.8" stroke-linejoin="round"/>`+
    mark(t.wordmark,t.frame,20.5,t.wordmark.length>1?100.5:111,21)+
    `<path d="M0,240.2 Q150,258.8 300,240.2 V476 H0 Z" fill="${t.band}"/>`+
    `<text x="150" y="301.4" text-anchor="middle" direction="rtl" font-size="12.4" font-weight="700" fill="${t.bandText}" font-family="Arial,'Segoe UI',Tahoma,sans-serif">إذا تم العثور على هذه</text>`+
    `<text x="150" y="322" text-anchor="middle" direction="rtl" font-size="12.4" font-weight="700" fill="${t.bandText}" font-family="Arial,'Segoe UI',Tahoma,sans-serif">البطاقة يرجى التواصل</text>`+
    `<text x="150" y="356.7" text-anchor="middle" font-size="10.2" font-weight="700" fill="${t.bandAccent}">If this card is found</text>`+
    `<text x="150" y="374" text-anchor="middle" font-size="10.2" font-weight="700" fill="${t.bandAccent}">please contact us.</text>`+
    `<text x="150" y="408" text-anchor="middle" font-size="11.2" font-weight="700" fill="${t.bandAccent}">Email: ${CONTACT_EMAIL}</text>`+
    `</g></svg>`
  return {front,back}
}

/** SVG markup for one face — shared by the on-screen preview and print. */
export function riderCardFaceSvg(face:RiderCardFace,person:DriverCardPerson|null,side:"front"|"back",idSeed?:string):string{
  return faces(face,person,idSeed)[side]
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
