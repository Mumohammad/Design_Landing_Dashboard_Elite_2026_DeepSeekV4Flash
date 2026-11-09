"use client"

import { useState } from "react"
import { CheckCircle2, Download, FlaskConical, Loader2, ShieldCheck, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "@/lib/toast"
import { runZatcaDryRun, type ZatcaDryRunResult } from "@/lib/accounting/zatca-dry-run"
import type { DryRunCheckId } from "@/lib/accounting/zatca-dry-run-core"

const CHECK_LABEL: Record<DryRunCheckId, { en: string; ar: string }> = {
  seller_vat: { en: "Seller VAT number", ar: "الرقم الضريبي للبائع" },
  seller_address: { en: "Seller National Address", ar: "العنوان الوطني للبائع" },
  buyer_standard: { en: "B2B buyer VAT & address", ar: "بيانات المشتري (منشأة)" },
  currency: { en: "Currency / SAR VAT", ar: "العملة / الضريبة بالريال" },
  lines: { en: "Invoice lines", ar: "بنود الفاتورة" },
  line_vat: { en: "Line VAT maths", ar: "حساب ضريبة البنود" },
  totals: { en: "Totals reconcile", ar: "تطابق الإجماليات" },
  note_reference: { en: "Note → original invoice", ar: "ربط الإشعار بالفاتورة" },
  ubl_build: { en: "UBL 2.1 XML built", ar: "إنشاء ملف UBL 2.1" },
  ubl_fields: { en: "Mandatory XML fields", ar: "الحقول الإلزامية" },
  signature: { en: "XAdES signature verifies", ar: "التوقيع الرقمي صحيح" },
  hash_stable: { en: "Invoice hash stable", ar: "ثبات بصمة الفاتورة" },
  qr: { en: "Phase-2 QR matches", ar: "رمز QR للمرحلة الثانية" },
  chain: { en: "ICV / PIH chain", ar: "تسلسل ICV / PIH" },
}

const DOC_LABEL = { invoice: { en: "Invoice", ar: "فاتورة" }, credit_note: { en: "Credit note", ar: "إشعار دائن" }, debit_note: { en: "Debit note", ar: "إشعار مدين" } }

function downloadXml(name: string, xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }))
  const a = document.createElement("a")
  a.href = url; a.download = `${name.replace(/[^A-Za-z0-9._-]+/g, "-")}-DRY-RUN.xml`
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Offline production rehearsal — nothing is sent to ZATCA. */
export function ZatcaDryRunCard({ ar }: { ar: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ZatcaDryRunResult | null>(null)
  const t = (en: string, arText: string) => (ar ? arText : en)

  const run = async () => {
    setBusy(true)
    const res = await runZatcaDryRun({ limit: 10 })
    setBusy(false)
    if (!res.success || !res.result) return void toast.error(res.error ?? t("Dry run failed.", "تعذر تشغيل الاختبار."))
    setResult(res.result)
    toast[res.result.passed ? "success" : "error"](res.result.passed ? t("All documents passed the rehearsal.", "اجتازت كل المستندات الاختبار.") : t("Some checks failed — see details.", "فشلت بعض الفحوصات — راجع التفاصيل."))
  }

  return (
    <Card className="rounded-2xl border border-violet-500/30 bg-card shadow-sm" data-testid="zatca-dry-run">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="size-4 text-violet-500" />{t("Production rehearsal (dry run)", "اختبار الجاهزية للإنتاج (تجربة جافة)")}</CardTitle>
          <CardDescription>
            {t("Runs your latest finalized invoices and notes through the full production pipeline — UBL XML, ICV/PIH chain, digital signature and Phase-2 QR — using a local test certificate, then checks the result. Nothing is sent to ZATCA and no invoice, counter or ledger is changed.",
              "يمرّر آخر الفواتير والإشعارات المعتمدة عبر مسار الإنتاج كاملاً — ملف UBL وتسلسل ICV/PIH والتوقيع الرقمي ورمز QR — بشهادة اختبار محلية، ثم يفحص النتيجة. لا يُرسل أي شيء إلى الهيئة ولا تتغير أي فاتورة أو عدّاد أو سجل.")}
          </CardDescription>
        </div>
        <Button onClick={() => void run()} disabled={busy} className="gap-1.5" data-testid="zatca-dry-run-button">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{t("Run dry-run test", "تشغيل الاختبار")}
        </Button>
      </CardHeader>
      {result && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className={result.passed ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"}>{result.passed ? t("READY — all checks passed", "جاهز — نجحت كل الفحوصات") : t("NOT READY — fix the failed checks", "غير جاهز — عالج الفحوصات الفاشلة")}</Badge>
            <Badge variant="outline">{t("Sent to ZATCA: 0", "أُرسل للهيئة: 0")}</Badge>
            <Badge variant="outline">{t("Test certificate (local)", "شهادة اختبار محلية")}</Badge>
            {result.sample && <Badge variant="outline" className="border-amber-500/40 text-amber-700">{t("No finalized documents yet — sample invoices used", "لا توجد مستندات معتمدة — استُخدمت فواتير نموذجية")}</Badge>}
            <span className="text-muted-foreground">{t(`Chain continues after ICV ${result.chainStart.counter}${result.chainStart.fromLedger ? " (current ledger, unchanged)" : ""}`, `يبدأ التسلسل بعد ICV ${result.chainStart.counter}${result.chainStart.fromLedger ? " (السجل الحالي دون تغيير)" : ""}`)}</span>
          </div>
          <ul className="grid gap-1 rounded-xl border bg-muted/20 p-3 text-xs sm:grid-cols-2">
            <li>{result.safety.gatewayConfigured ? "⚠️ " : "✅ "}{result.safety.gatewayConfigured ? t("A ZATCA test gateway is configured for this deployment.", "بوابة ZATCA اختبارية مهيأة في هذا النشر.") : t("Offline mode: this deployment cannot reach ZATCA.", "وضع غير متصل: هذا النشر لا يتصل بالهيئة.")}</li>
            <li>{result.safety.tenantProductionOn ? "⚠️ " : "✅ "}{result.safety.tenantProductionOn ? t("Production switch is ON for this company.", "الربط الإنتاجي مفعّل لهذه المنشأة.") : t("Production switch is OFF.", "الربط الإنتاجي متوقف.")}</li>
            <li>{result.safety.productionAvailable ? "⚠️ " : "✅ "}{result.safety.productionAvailable ? t("Deployment allows production submission.", "النشر يسمح بالإرسال الإنتاجي.") : t("Production submission is disabled in this deployment.", "الإرسال الإنتاجي معطّل في هذا النشر.")}</li>
            <li>{result.safety.autoSendOn ? "⚠️ " : "✅ "}{result.safety.autoSendOn ? t("Automatic submission is ON.", "الإرسال التلقائي مفعّل.") : t("Automatic submission is OFF.", "الإرسال التلقائي متوقف.")}</li>
          </ul>
          <div className="space-y-2">
            {result.documents.map((d) => (
              <details key={d.sourceId} className="rounded-xl border p-3 text-sm" open={!d.passed}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  {d.passed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" />}
                  <span className="font-mono" dir="ltr">{d.docRef}</span>
                  <span className="text-xs text-muted-foreground">{ar ? DOC_LABEL[d.docType].ar : DOC_LABEL[d.docType].en} · {d.kind === "standard" ? t("Standard (B2B) → clearance", "قياسية (منشآت) → تخليص") : t("Simplified (B2C) → reporting", "مبسطة (أفراد) → إبلاغ")} · ICV {d.counter}</span>
                  {d.signedXml && <Button type="button" size="sm" variant="ghost" className="ms-auto h-7 gap-1 px-2 text-xs" onClick={(e) => { e.preventDefault(); downloadXml(d.docRef, d.signedXml!) }}><Download className="size-3" />XML</Button>}
                </summary>
                <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {d.checks.map((c) => (
                    <li key={c.id} className={c.pass ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>
                      {c.pass ? "✓" : "✗"} {ar ? CHECK_LABEL[c.id].ar : CHECK_LABEL[c.id].en}{!c.pass && c.detail ? ` — ${c.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("Rehearsal XML is signed with a local test certificate and is not a tax document. Final acceptance still requires onboarding with a Fatoora OTP and a passing simulation run before switching production ON.", "ملفات الاختبار موقعة بشهادة محلية وليست مستندات ضريبية. القبول النهائي يتطلب الربط عبر رمز OTP من بوابة فاتورة واجتياز بيئة المحاكاة قبل تفعيل الإنتاج.")}</p>
        </CardContent>
      )}
    </Card>
  )
}
