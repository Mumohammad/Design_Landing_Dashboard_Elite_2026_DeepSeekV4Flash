// Pure A4 document HTML builder for Module 13 template generation.
// No server-only imports — safe to import from anywhere (and testable).

export interface DocumentEntityData {
  driver?: {
    driver_code?: string | null
    full_name_ar?: string | null
    iqama_number?: string | null
    phone?: string | null
    basic_salary?: number | null
    iban?: string | null
  } | null
  vehicle?: {
    vehicle_code?: string | null
    plate_number?: string | null
    make?: string | null
    model?: string | null
    year?: number | null
  } | null
  companyNameAr: string
  companyNameEn: string
  docNumber: string
  verifyUrl: string
  generatedAt: string
  /** PNG data URL of the verification QR (built with qrcode + the verify URL). */
  qrDataUrl?: string | null
}

function esc(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function money(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " SAR"
}

function fieldRow(labelAr: string, labelEn: string, value: string): string {
  return `<tr>
    <td class="lbl">${esc(labelAr)}<span class="en"> / ${esc(labelEn)}</span></td>
    <td class="val">${esc(value)}</td>
  </tr>`
}

export function buildDocumentHtml(
  templateNameAr: string,
  templateNameEn: string,
  description: string | null,
  data: DocumentEntityData
): string {
  const d = data
  const rows: string[] = []

  if (d.driver) {
    rows.push(fieldRow("اسم السائق", "Driver Name", d.driver.full_name_ar ?? "—"))
    rows.push(fieldRow("رمز السائق", "Driver Code", d.driver.driver_code ?? "—"))
    rows.push(fieldRow("رقم الإقامة", "Iqama No.", d.driver.iqama_number ?? "—"))
    rows.push(fieldRow("رقم الجوال", "Phone", d.driver.phone ?? "—"))
    rows.push(fieldRow("الراتب الأساسي", "Basic Salary", d.driver.basic_salary != null ? money(d.driver.basic_salary) : "—"))
    rows.push(fieldRow("الآيبان", "IBAN", d.driver.iban ?? "—"))
  }
  if (d.vehicle) {
    rows.push(fieldRow("رمز المركبة", "Vehicle Code", d.vehicle.vehicle_code ?? "—"))
    rows.push(fieldRow("لوحة المركبة", "Plate No.", d.vehicle.plate_number ?? "—"))
    rows.push(fieldRow("الماركة / الموديل", "Make / Model", `${d.vehicle.make ?? ""} ${d.vehicle.model ?? ""}`.trim() || "—"))
    rows.push(fieldRow("سنة الصنع", "Year", d.vehicle.year != null ? String(d.vehicle.year) : "—"))
  }
  if (rows.length === 0) {
    rows.push(fieldRow("وصف", "Description", description ?? "—"))
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(templateNameAr)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 13px; line-height: 1.6; }
  .doc { max-width: 190mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1E5A99; padding-bottom: 10px; }
  .co-name { font-size: 18px; font-weight: 800; color: #1E5A99; }
  .co-sub { font-size: 11px; color: #64748b; }
  h1 { font-size: 16px; text-align: center; margin: 18px 0 6px; color: #0f172a; }
  .desc { text-align: center; color: #64748b; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid #e2e8f0; padding: 7px 10px; }
  td.lbl { width: 38%; background: #f1f5f9; font-weight: 600; }
  td.lbl .en { color: #94a3b8; font-weight: 400; font-size: 11px; }
  td.val { direction: ltr; text-align: left; font-family: Consolas, monospace; }
  .meta { display: flex; justify-content: space-between; margin-top: 18px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  .signatures { display: flex; justify-content: space-between; margin-top: 56px; }
  .sig { text-align: center; width: 30%; }
  .sig .line { border-top: 1px solid #0f172a; margin-top: 34px; padding-top: 4px; font-size: 11px; color: #475569; }
  .qr { border: 1px dashed #cbd5e1; width: 84px; height: 84px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #94a3b8; text-align: center; margin-top: 14px; }
  .qr-img { width: 92px; height: 92px; border: 1px solid #cbd5e1; border-radius: 6px; margin-top: 14px; }
  .verify { font-size: 10px; color: #94a3b8; margin-top: 4px; }
  @media print { .doc { max-width: 100%; } }
</style>
</head>
<body>
<div class="doc">
  <header>
    <div>
      <div class="co-name">${esc(d.companyNameAr)}</div>
      <div class="co-sub" dir="ltr">${esc(d.companyNameEn)}</div>
    </div>
    <div style="text-align:left" dir="ltr">
      <div style="font-size:11px;color:#64748b">Doc No.</div>
      <div style="font-weight:700" dir="ltr">${esc(d.docNumber)}</div>
    </div>
  </header>

  <h1>${esc(templateNameAr)}</h1>
  <div class="desc" dir="ltr">${esc(templateNameEn)}</div>

  <table>
    <tbody>${rows.join("")}</tbody>
  </table>

  <div class="signatures">
    <div class="sig">
      <div class="line">${esc(d.driver?.full_name_ar ?? "المستلم")} — توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="line">المدير — التوقيع والختم</div>
    </div>
  </div>

  ${d.qrDataUrl
    ? `<img class="qr-img" src="${d.qrDataUrl}" alt="QR" />`
    : `<div class="qr">QR<br/>توثيق</div>`}
  <div class="verify" dir="ltr">${esc(d.verifyUrl)}</div>

  <div class="meta">
    <span dir="ltr">Generated: ${esc(d.generatedAt)}</span>
    <span>وثيقة صادرة من نخبة التطوير</span>
  </div>
</div>
</body>
</html>`
}
