import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimit } from "@/lib/auth/rate-limit"
import { generateInvoiceDocument } from "@/lib/accounting/invoice-docs"

export const runtime = "nodejs"
export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
const arabicErrors: Record<number, string> = {
  400: "بيانات طلب PDF غير صالحة. تحقق من الفاتورة والحساب البنكي.",
  401: "سجّل الدخول وأكمل التحقق لتنزيل الفاتورة.",
  403: "لا تملك صلاحية طباعة هذه الفاتورة أو لا يُسمح بمصدر الطلب.",
  422: "تعذر تجهيز الفاتورة. تحقق من بيانات الشركة والرقم الضريبي والعميل والحساب البنكي.",
  429: "تجاوزت عدد طلبات PDF المسموح. انتظر قليلاً وحاول مجدداً.",
  503: "تعذر إنشاء PDF الآن. انتظر قليلاً وحاول مجدداً.",
}
const failure = (error: string, status: number, retry?: number) => Response.json({ error, errorAr: arabicErrors[status] }, {
  status, headers: { ...headers, ...(retry ? { "Retry-After": String(retry) } : {}) },
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return failure("Request origin is not allowed.", 403)
  try {
    const user = await getCurrentUser()
    if (!user) return failure("Sign in and complete authentication to download this invoice.", 401)
    await requirePermission("invoices", "print")
    const { id } = await context.params
    if (!UUID.test(id)) return failure("Invalid invoice identifier.", 400)
    const limit = await rateLimit(`invoice-pdf:${user.authUserId}`, 10, "minute")
    if (!limit.success) return failure("Too many PDF requests. Try again shortly.", 429, Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)))
    const body = await request.text()
    if (body.length > 2048) return failure("Invalid PDF options.", 400)
    let options: { bankAccountId?: string }
    try {
      options = body ? JSON.parse(body) : {}
      if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => key !== "bankAccountId") ||
        (options.bankAccountId !== undefined && (typeof options.bankAccountId !== "string" || !UUID.test(options.bankAccountId)))) {
        return failure("Invalid PDF options.", 400)
      }
    } catch { return failure("Invalid PDF options.", 400) }
    const document = await generateInvoiceDocument(id, options.bankAccountId)
    if (!document.success || !document.pdf) {
      if (document.retryable) return failure("PDF generation is busy or unavailable. Try again shortly.", 503, 5)
      const error = document.error?.includes("15-digit VAT")
        ? "Configure the company's 15-digit VAT number before generating an invoice."
        : "Unable to prepare this invoice. Check its company, customer and bank details, then try again."
      return failure(error, 422)
    }
    const number = (document.docNumber ?? id).replace(/^INVDOC-/, "").replace(/[\r\n\\/"<>]/g, "").slice(0, 100)
    const filename = `Invoice-${number}.pdf`
    return new Response(Uint8Array.from(document.pdf), { headers: {
      ...headers,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice.pdf"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`,
    } })
  } catch (error) {
    const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null
    if (status === 401 || status === 403) return failure("You do not have permission to print this invoice.", status)
    return failure("Unable to generate the PDF right now. Please try again.", 503, 5)
  }
}
