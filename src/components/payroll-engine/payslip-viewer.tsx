"use client"

// In-app payslip preview: renders the exact printable payslip (same HTML as
// print/PDF) inside a sandboxed frame so what users see is what they print.
import { useEffect, useMemo } from "react"
import { Printer, X } from "lucide-react"
import { openPayslips, payslipsHtml, type PayslipMeta, type PrintRow } from "./payslip-print"

export function PayslipViewer({ rows, meta, ar, title, onClose, onPrintBlocked }: { rows: readonly PrintRow[]; meta: PayslipMeta; ar: boolean; title: string; onClose: () => void; onPrintBlocked?: () => void }) {
  const html = useMemo(() => payslipsHtml(rows, meta, ar), [rows, meta, ar])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex h-[92vh] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-emerald-700 to-emerald-500 px-5 py-3 text-white">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] opacity-80">{ar ? "معاينة القسيمة" : "Payslip preview"} · {meta.month}</div>
            <h2 className="truncate text-base font-bold">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-800 shadow hover:bg-emerald-50" onClick={() => { if (!openPayslips(rows, meta, ar)) onPrintBlocked?.() }}>
              <Printer className="h-4 w-4" />{ar ? "طباعة / PDF" : "Print / PDF"}
            </button>
            <button type="button" aria-label={ar ? "إغلاق" : "Close"} className="rounded-lg p-2 hover:bg-white/15" onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>
        <iframe title={title} data-testid="payslip-frame" sandbox="allow-same-origin" srcDoc={html} className="w-full flex-1 bg-slate-100" />
      </div>
    </div>
  )
}
