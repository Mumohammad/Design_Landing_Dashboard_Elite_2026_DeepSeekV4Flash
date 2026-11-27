"use client"

// In-app payslip preview: renders the exact printable payslip (same HTML as
// print/PDF) inside a sandboxed frame so what users see is what they print.
import { useEffect, useMemo, useRef, useState } from "react"
import { Printer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { openPayslips, payslipsHtml, type PayslipMeta, type PrintRow } from "./payslip-print"

export function PayslipViewer({ rows, meta, ar, title, onClose, onPrintBlocked }: { rows: readonly PrintRow[]; meta: PayslipMeta; ar: boolean; title: string; onClose: () => void; onPrintBlocked?: () => void }) {
  const companyReady = !!(meta.company?.nameAr?.trim() || meta.company?.nameEn?.trim())
  const html = useMemo(() => companyReady ? payslipsHtml(rows, meta, ar) : null, [rows, meta, ar, companyReady])
  const [printBlocked, setPrintBlocked] = useState(false)
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    let removeListener: (() => void) | undefined
    const connect = () => {
      removeListener?.()
      const document = element.contentDocument
      const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose() } }
      document?.addEventListener("keydown", escape)
      removeListener = () => document?.removeEventListener("keydown", escape)
    }
    element.addEventListener("load", connect)
    connect()
    return () => { element.removeEventListener("load", connect); removeListener?.() }
  }, [html, onClose])

  function print() {
    if (!companyReady) return
    setPrintBlocked(false)
    try { if (openPayslips(rows, meta, ar)) return } catch { /* Keep the preview open when the browser refuses printing. */ }
    setPrintBlocked(true)
    onPrintBlocked?.()
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); if (opener?.isConnected) opener.focus() }} className="flex h-[92dvh] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[880px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <div className="min-w-0">
            <DialogDescription>{ar ? "معاينة القسيمة" : "Payslip preview"} · {meta.month}</DialogDescription>
            <DialogTitle className="mt-1 break-words text-base">{title}</DialogTitle>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" disabled={!companyReady} onClick={print}>
              <Printer aria-hidden="true" className="h-4 w-4" />{ar ? "طباعة / PDF" : "Print / PDF"}
            </Button>
            <DialogClose asChild><Button type="button" variant="ghost" size="icon" aria-label={ar ? "إغلاق" : "Close"}><X aria-hidden="true" className="h-5 w-5" /></Button></DialogClose>
          </div>
        </div>
        {!companyReady && <p role="alert" className="p-4 text-sm text-destructive">{ar ? "تعذر تأكيد بيانات الشركة. أغلق المعاينة وأعد تحميل البيانات قبل الطباعة." : "Company details could not be confirmed. Close the preview and reload the data before printing."}</p>}
        {printBlocked && <p role="alert" className="border-b border-border px-4 py-3 text-sm">{ar ? "اسمح بالنوافذ المنبثقة ثم أعد محاولة الطباعة." : "Allow pop-ups, then try printing again."}</p>}
        {html && <iframe ref={frame} title={title} data-testid="payslip-frame" sandbox="allow-same-origin" srcDoc={html} className="min-h-0 w-full flex-1 border-0 bg-muted" />}
      </DialogContent>
    </Dialog>
  )
}
