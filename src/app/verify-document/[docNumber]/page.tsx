import { createAdminClient } from "@/lib/supabase/admin"
import { LogoMark } from "@/components/logo"
import {
  BadgeCheck,
  FileQuestion,
  Percent,
  ReceiptText,
  ShieldCheck,
  Timer,
  User,
} from "lucide-react"

// Public QR-verification page for generated documents.
//
// The URL is embedded in printed documents as a QR code (verify_url). Anyone
// who scans it — including people without a login — must be able to confirm
// whether a document is genuine. The lookup therefore runs server-side with
// the service-role admin client (RLS is tenant-scoped and would block public
// viewers), and only non-sensitive summary fields are rendered.

export const metadata = {
  title: "Document Verification | نخبة التطوير",
  robots: { index: false, follow: false },
}

type GeneratedDocRow = {
  id: string
  doc_number: string
  status: string
  generated_at: string
  verify_url: string | null
  template_id: string | null
  driver_id: string | null
  vehicle_id: string | null
  invoice_id: string | null
  generated_data?: Record<string, unknown> | null
  document_templates?: { name_ar: string; name_en: string | null } | null
  drivers?: { full_name_ar: string | null; full_name_en: string | null } | null
  vehicles?: { plate_number: string | null; make: string | null; model: string | null } | null
  invoices?: {
    invoice_number: string
    invoice_type: string
    status: string
    total: number
    currency: string
    customers?: { name_ar: string | null } | null
    suppliers?: { name_ar: string | null } | null
  } | null
}

async function loadDocument(docNumber: string): Promise<GeneratedDocRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("generated_documents")
    .select(
      "id, doc_number, status, generated_at, verify_url, template_id, driver_id, vehicle_id, invoice_id, generated_data, " +
        "document_templates(name_ar, name_en), drivers(full_name_ar, full_name_en), " +
        "vehicles(plate_number, make, model), " +
        "invoices(invoice_number, invoice_type, status, total, currency, customers(name_ar), suppliers(name_ar))",
    )
    .eq("doc_number", docNumber)
    .is("deleted_at", null)
    .maybeSingle<GeneratedDocRow>()

  if (error || !data) return null
  return data
}

function VatReturnCard({ data }: { data: Record<string, unknown> }) {
  const fmt = (v: unknown): string => {
    const n = Number(v ?? 0)
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " SAR"
  }
  const period = `${Number(data.period_year)}-${String(Number(data.period_month)).padStart(2, "0")}`
  const net = Number(data.net_position ?? 0)
  const nature = String(data.net_nature ?? "zero")
  const netLabel =
    nature === "payable" ? "Net VAT payable"
    : nature === "receivable" ? "Net VAT receivable"
    : "Net VAT position"

  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Percent className="h-3 w-3" />
        VAT Return
      </p>
      <p className="mt-0.5 font-mono text-sm font-bold text-foreground" dir="ltr">
        Period {period}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Output VAT</p>
          <p className="font-medium text-foreground" dir="ltr">{fmt(data.output_vat)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recoverable input</p>
          <p className="font-medium text-foreground" dir="ltr">{fmt(data.recoverable_input_vat)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Adjustments</p>
          <p className="font-medium text-foreground" dir="ltr">
            {fmt(Number(data.adjustments_output) + Number(data.adjustments_input))}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{netLabel}</p>
          <p
            className={`font-semibold ${net > 0 ? "text-red-600" : net < 0 ? "text-emerald-600" : "text-foreground"}`}
            dir="ltr"
          >
            {fmt(Math.abs(net))}
          </p>
        </div>
      </div>
    </div>
  )
}

function ResultCard({ doc }: { doc: GeneratedDocRow | null }) {
  const valid = !!doc
  const isAr = false // Verification results are rendered neutrally (English + numbers readable by all)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-10 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <LogoMark />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl shadow-slate-900/5 dark:shadow-black/30">
          {/* Status banner */}
          <div
            className={
              valid
                ? "bg-emerald-600 px-6 py-5 text-center"
                : "bg-red-600 px-6 py-5 text-center"
            }
          >
            {valid ? (
              <BadgeCheck className="mx-auto h-10 w-10 text-white" />
            ) : (
              <FileQuestion className="mx-auto h-10 w-10 text-white" />
            )}
            <h1 className="mt-2 text-lg font-extrabold text-white">
              {valid ? "Document Verified" : "Document Not Found"}
            </h1>
            <p className="mt-0.5 text-xs text-white/85">
              {valid
                ? "This document is genuine and was issued by the company"
                : "No matching document record exists — treat this copy with caution"}
            </p>
          </div>

          <div className="space-y-4 px-6 py-6">
            {/* Document number */}
            <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Document number
              </p>
              <p className="mt-0.5 font-mono text-base font-bold text-foreground" dir="ltr">
                {valid ? doc!.doc_number : "—"}
              </p>
            </div>

            {valid && (
              <>
                {/* Template + issued date */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <FileQuestion className="h-3 w-3" />
                      {isAr ? "النوع" : "Type"}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                      {doc!.document_templates?.name_en ?? doc!.document_templates?.name_ar ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Timer className="h-3 w-3" />
                      {isAr ? "تاريخ الإصدار" : "Issued"}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {doc!.generated_at ? new Date(doc!.generated_at).toLocaleDateString("en-GB") : "—"}
                    </p>
                  </div>
                </div>

                {/* Entity: VAT return, invoice document, or template entity */}
                {doc!.generated_data?.kind === "vat_return" ? (
                  <VatReturnCard data={doc!.generated_data} />
                ) : doc!.invoice_id && doc!.invoices ? (
                  <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <ReceiptText className="h-3 w-3" />
                      Invoice
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-bold text-foreground" dir="ltr">
                      {doc!.invoices.invoice_number}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {doc!.invoices.customers?.name_ar ?? doc!.invoices.suppliers?.name_ar ?? "—"}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground" dir="ltr">
                      <span className="font-medium text-foreground">
                        {Number(doc!.invoices.total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {doc!.invoices.currency}
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        {doc!.invoices.status}
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <User className="h-3 w-3" />
                      {doc!.drivers ? "Driver" : "Vehicle"}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {doc!.drivers
                        ? (doc!.drivers.full_name_en ?? doc!.drivers.full_name_ar ?? "—")
                        : doc!.vehicles
                          ? `${doc!.vehicles.make ?? ""} ${doc!.vehicles.model ?? ""}`.trim() || "—"
                          : "—"}
                    </p>
                    {doc!.vehicles?.plate_number && (
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {doc!.vehicles.plate_number}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer strip */}
        <div className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>
            Verified against the official document registry — نخبة التطوير
          </span>
        </div>
      </div>
    </div>
  )
}

export default async function VerifyDocumentPage({
  params,
}: {
  params: Promise<{ docNumber: string }>
}) {
  const { docNumber } = await params
  let decoded = docNumber
  try {
    decoded = decodeURIComponent(docNumber)
  } catch {
    decoded = docNumber // malformed %-encoding → render the not-found card, never a 500
  }

  return <ResultCard doc={await loadDocument(decoded)} />
}
