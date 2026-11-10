/** Only accept an actual PDF response, never save an HTML login/error page as .pdf. */
export async function requestInvoicePdf(id: string, bankAccountId?: string, locale: "en" | "ar" = "en") {
  const response = await fetch(`/api/invoices/${encodeURIComponent(id)}/pdf`, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bankAccountId ? { bankAccountId } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const message = locale === "ar" ? error?.errorAr : error?.error
    throw Error(typeof message === "string" ? message : locale === "ar" ? "تعذر إنشاء PDF الفاتورة. حاول مجدداً." : "Unable to generate the invoice PDF. Please try again.")
  }
  if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw Error(locale === "ar" ? "لم تُرجع الخدمة ملف PDF. حاول مجدداً." : "The invoice service did not return a PDF. Please try again.")
  const blob = await response.blob()
  if (blob.size > 4 * 1024 * 1024 || await blob.slice(0, 5).text() !== "%PDF-") throw Error(locale === "ar" ? "ملف PDF غير صالح. حاول مجدداً." : "Invalid invoice PDF. Please try again.")
  const disposition = response.headers.get("content-disposition") ?? ""
  let filename = "Invoice.pdf"
  try {
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    const candidate = encoded ? decodeURIComponent(encoded) : ""
    if (candidate.endsWith(".pdf") && !/[\x00-\x1f\x7f\\/<>:"]/.test(candidate)) filename = candidate
  } catch { /* Keep the safe default filename. */ }
  return { blob, filename }
}
