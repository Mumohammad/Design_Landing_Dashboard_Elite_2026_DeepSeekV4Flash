"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Receipt, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useTranslation } from "@/hooks/use-translation"
import { confirmCardReturn, getBillingOverview, payInvoiceByCard, type BillingInvoice, type BillingOverview } from "@/lib/billing/actions"
import { cn } from "@/lib/utils"

const STATUS: Record<BillingInvoice["status"], { ar: string; en: string; cls: string }> = {
  pending: { ar: "مستحقة", en: "Due", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  overdue: { ar: "متأخرة", en: "Overdue", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  paid: { ar: "مدفوعة", en: "Paid", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  void: { ar: "ملغاة", en: "Void", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
}

const ACCOUNT: Record<string, { ar: string; en: string }> = {
  trialing: { ar: "فترة تجريبية", en: "Free trial" },
  active_paid: { ar: "اشتراك فعّال", en: "Active subscription" },
  unpaid: { ar: "بانتظار الدفع", en: "Payment due" },
  past_due: { ar: "متأخر السداد", en: "Past due" },
}

function money(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function day(iso: string | null) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—"
}

function BillingSettings() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const router = useRouter()
  const params = useSearchParams()
  const [view, setView] = React.useState<BillingOverview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [paying, setPaying] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const handledReturn = React.useRef(false)

  const load = React.useCallback(async () => {
    try { setView(await getBillingOverview()) } catch { setView(null) } finally { setLoading(false) }
  }, [])

  React.useEffect(() => { void load() }, [load])

  // Returning from Moyasar checkout: settle from the provider's API, then clean the URL.
  React.useEffect(() => {
    const attempt = params.get("attempt")
    if (!attempt || handledReturn.current) return
    handledReturn.current = true
    const cancelled = params.get("cancelled") === "1"
    setConfirming(true)
    void (async () => {
      let outcome = "pending"
      for (let i = 0; i < 4; i++) {
        const res = await confirmCardReturn(attempt).catch(() => null)
        outcome = res && res.success ? res.data.outcome : "pending"
        if (outcome !== "pending") break
        await new Promise((r) => setTimeout(r, 2500))
      }
      setConfirming(false)
      if (outcome === "settled" || outcome === "already_settled") toast.success(ar ? "تم الدفع بنجاح. شكراً لك!" : "Payment received. Thank you!")
      else if (outcome === "duplicate_payment") toast.warning(ar ? "الفاتورة كانت مدفوعة مسبقاً؛ سيتواصل فريقنا لاسترداد المبلغ." : "This invoice was already paid; our team will refund the duplicate charge.")
      else if (cancelled) toast.info(ar ? "تم إلغاء الدفع. لم يتم خصم أي مبلغ." : "Payment cancelled. You weren't charged.")
      else if (outcome === "failed" || outcome === "expired" || outcome === "canceled") toast.error(ar ? "لم تكتمل عملية الدفع. حاول مرة أخرى." : "The payment didn't complete. Please try again.")
      else toast.info(ar ? "جارٍ تأكيد الدفع من البنك — سيتم التحديث تلقائياً خلال دقائق." : "Confirming with the bank — this updates automatically within minutes.")
      router.replace("/settings/billing")
      void load()
    })()
  }, [params, ar, router, load])

  const pay = async (inv: BillingInvoice) => {
    setPaying(inv.id)
    const res = await payInvoiceByCard(inv.id).catch(() => null)
    if (res && res.success) {
      window.location.assign(res.data.url)
      return
    }
    setPaying(null)
    toast.error(res && !res.success ? (ar ? res.errorAr : res.error) : ar ? "تعذر بدء الدفع." : "Couldn't start the payment.")
  }

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner className="h-6 w-6 text-elite-blue-600" /></div>
  if (!view) return <div className="px-4 py-12 text-center text-sm text-muted-foreground lg:px-6">{ar ? "تعذر تحميل الفوترة أو لا تملك صلاحية عرضها." : "Couldn't load billing, or you don't have access."}</div>

  const open = view.invoices.filter((i) => i.status === "pending" || i.status === "overdue")
  const due = open.reduce((s, i) => s + i.amount, 0)
  const account = view.billingStatus ? ACCOUNT[view.billingStatus] : null

  return (
    <div className="space-y-6 px-4 py-4 lg:px-6 page-enter" dir={ar ? "rtl" : "ltr"}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-muted/50"><CreditCard className="h-5 w-5 text-muted-foreground" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ar ? "الفوترة والاشتراك" : "Billing & subscription"}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{ar ? "فواتير اشتراكك في Elite والدفع الإلكتروني الآمن" : "Your Elite subscription invoices and secure online payment"}</p>
        </div>
      </div>

      {confirming && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-sky-900 dark:bg-sky-950" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> {ar ? "جارٍ تأكيد الدفع…" : "Confirming your payment…"}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>{ar ? "حالة الحساب" : "Account status"}</CardDescription></CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{account ? (ar ? account.ar : account.en) : "—"}</div>
            {view.billingStatus === "trialing" && view.trialEndsAt && <p className="mt-1 text-xs text-muted-foreground">{ar ? "تنتهي التجربة في" : "Trial ends"} <span dir="ltr">{day(view.trialEndsAt)}</span></p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{ar ? "المبلغ المستحق" : "Amount due"}</CardDescription></CardHeader>
          <CardContent><div className="text-lg font-semibold tabular-nums" dir="ltr">SAR {money(due)}</div><p className="mt-1 text-xs text-muted-foreground">{open.length} {ar ? "فاتورة مفتوحة" : "open invoice(s)"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{ar ? "طرق الدفع" : "Payment methods"}</CardDescription></CardHeader>
          <CardContent>
            {view.cardEnabled ? (
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-1.5 font-medium"><ShieldCheck className="h-4 w-4 text-emerald-600" />{ar ? "مدى، فيزا، ماستركارد، Apple Pay" : "mada, Visa, Mastercard, Apple Pay"}</div>
                <p className="text-xs text-muted-foreground">{ar ? "دفع آمن عبر ميسّر — لا نحتفظ ببيانات بطاقتك." : "Secured by Moyasar — we never store your card details."}</p>
                {view.cardMode === "test" && <Badge variant="outline" className="border-amber-300 text-amber-700">{ar ? "وضع الاختبار" : "Test mode"}</Badge>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{ar ? "تحويل بنكي — تواصل مع الدعم. الدفع بالبطاقة قريباً." : "Bank transfer — contact support. Card payment coming soon."}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" />{ar ? "فواتير الاشتراك" : "Subscription invoices"}</CardTitle>
          <CardDescription>{ar ? "الفواتير الصادرة لشركتك من منصة Elite" : "Invoices issued to your company by the Elite platform"}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {view.invoices.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{ar ? "لا توجد فواتير بعد." : "No invoices yet."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{ar ? "رقم الفاتورة" : "Invoice"}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{ar ? "الفترة" : "Period"}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{ar ? "تاريخ الاستحقاق" : "Due"}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{ar ? "المبلغ" : "Amount"}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{ar ? "الحالة" : "Status"}</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {view.invoices.map((inv) => {
                    const st = STATUS[inv.status]
                    const payable = inv.status === "pending" || inv.status === "overdue"
                    return (
                      <tr key={inv.id} data-testid="billing-invoice-row">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{inv.invoice_number}</td>
                        <td className="px-4 py-3">{inv.period_label ?? "—"}</td>
                        <td className="px-4 py-3 tabular-nums" dir="ltr">{day(inv.due_date)}</td>
                        <td className="px-4 py-3 text-end tabular-nums" dir="ltr">{inv.currency} {money(inv.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{ar ? st.ar : st.en}</span>
                          {inv.status === "paid" && <span className="ms-2 text-xs text-muted-foreground">{inv.payment_method === "card" ? (ar ? "بالبطاقة" : "by card") : ""} <span dir="ltr">{day(inv.paid_at)}</span></span>}
                        </td>
                        <td className="px-4 py-3 text-end">
                          {payable && view.cardEnabled && view.canPay && (
                            <Button size="sm" className="gap-1.5 rounded-lg" disabled={!!paying || confirming} onClick={() => pay(inv)} data-testid="billing-pay-card">
                              {paying === inv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                              {ar ? "ادفع بالبطاقة" : "Pay by card"}
                            </Button>
                          )}
                          {inv.status === "paid" && <CheckCircle2 className="inline h-4 w-4 text-emerald-600" aria-label={ar ? "مدفوعة" : "Paid"} />}
                          {inv.status === "overdue" && !view.cardEnabled && <AlertTriangle className="inline h-4 w-4 text-red-600" />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function BillingSettingsPage() {
  return (
    <React.Suspense fallback={<div className="flex items-center justify-center py-24"><LoadingSpinner className="h-6 w-6 text-elite-blue-600" /></div>}>
      <BillingSettings />
    </React.Suspense>
  )
}
