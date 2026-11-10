"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { downloadTemplate, readSheetRows } from "@/lib/import/sheet"
import { FINE_TEMPLATE_HEADERS, parseFineRows, type FineImportRow, type FineParseIssue } from "@/lib/violations/fines-import"
import { importTrafficFines } from "@/app/actions/violations/fines"

const SOURCES = [
  { v: "absher", en: "Absher / Muroor", ar: "أبشر / المرور" },
  { v: "moi", en: "Ministry of Interior", ar: "وزارة الداخلية" },
  { v: "najm", en: "Najm", ar: "نجم" },
  { v: "manual", en: "Other / manual", ar: "أخرى / يدوي" },
] as const

export function FinesImportDialog({ open, onOpenChange, isAr, onImported }: { open: boolean; onOpenChange: (v: boolean) => void; isAr: boolean; onImported: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<FineImportRow[]>([])
  const [issues, setIssues] = useState<FineParseIssue[]>([])
  const [source, setSource] = useState<(typeof SOURCES)[number]["v"]>("absher")
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const reset = () => { setFileName(null); setRows([]); setIssues([]) }
  const read = async (file: File) => {
    reset()
    try {
      const parsed = parseFineRows(await readSheetRows(file))
      if (parsed.rows.length > 1000) { toast.error(isAr ? "الحد الأقصى 1000 مخالفة لكل ملف" : "Up to 1000 fines per file"); return }
      setFileName(file.name); setRows(parsed.rows); setIssues(parsed.issues)
    } catch { toast.error(isAr ? "تعذر قراءة الملف" : "Could not read the file") }
  }

  const run = async () => {
    setBusy(true)
    try {
      const res = await importTrafficFines({ rows, source, batchRef: fileName?.slice(0, 100) ?? null })
      if (!res.ok) { toast.error(isAr ? res.errorAr : res.error); return }
      const d = res.data
      toast.success(isAr
        ? `تم استيراد ${d.rows - d.duplicates} مخالفة: ${d.matched} مطابقة لسائق، ${d.vehicle_only} مركبة دون سائق، ${d.unmatched} غير مطابقة، ${d.duplicates} مكررة`
        : `${d.rows - d.duplicates} fines imported: ${d.matched} matched to a driver, ${d.vehicle_only} vehicle only, ${d.unmatched} unmatched, ${d.duplicates} duplicates skipped`)
      reset(); onOpenChange(false); onImported()
    } finally { setBusy(false) }
  }

  const blocking = issues.filter((i) => i.blocking).length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (busy) return; if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-primary" />{isAr ? "استيراد المخالفات المرورية" : "Import traffic fines"}</DialogTitle>
          <DialogDescription>{isAr ? "تُطابق كل مخالفة تلقائياً مع المركبة عبر رقم اللوحة، ثم مع السائق الذي كانت المركبة معه في تاريخ المخالفة." : "Each fine is matched to a vehicle by plate number, then to the driver who held that vehicle on the violation date."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="fine-source">{isAr ? "جهة الإصدار" : "Issuer"}</Label>
            <select id="fine-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
              {SOURCES.map((s) => <option key={s.v} value={s.v}>{isAr ? s.ar : s.en}</option>)}
            </select>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void downloadTemplate("traffic-fines-template.xlsx", FINE_TEMPLATE_HEADERS, [["F-2026-0001", "ABJ 1234", "2026-03-14", 300, "Speeding", "Riyadh — King Fahd Rd", "2026-04-14", "Muroor"]])}>
            <Download className="me-1.5 size-4" />{isAr ? "تنزيل القالب" : "Download template"}
          </Button>
        </div>
        <label htmlFor="fines-file"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void read(f) }}
          className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition", dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40")}>
          <Upload className="size-7 text-primary" />
          <span className="font-medium">{fileName ?? (isAr ? "اسحب كشف المخالفات هنا أو اضغط للاختيار" : "Drop the fines statement here or click to choose")}</span>
          <span className="text-xs text-muted-foreground">.xlsx · .xls · .csv</span>
          <input id="fines-file" type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = "" }} />
        </label>
        {fileName && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><p className="text-2xl font-bold tabular-nums text-emerald-600">{rows.length}</p><p className="text-xs text-muted-foreground">{isAr ? "مخالفات جاهزة" : "Fines ready"}</p></div>
            <div className="rounded-xl border p-3"><p className="text-2xl font-bold tabular-nums">{rows.reduce((s, r) => s + (r.fine_amount ?? 0), 0).toLocaleString(isAr ? "ar-SA" : "en-SA")}</p><p className="text-xs text-muted-foreground">{isAr ? "إجمالي ر.س" : "Total SAR"}</p></div>
            <div className={cn("rounded-xl border p-3", blocking ? "border-amber-500/40 bg-amber-500/5" : "")}><p className="text-2xl font-bold tabular-nums text-amber-600">{blocking}</p><p className="text-xs text-muted-foreground">{isAr ? "أسطر مرفوضة" : "Rejected rows"}</p></div>
          </div>
        )}
        {issues.length > 0 && (
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border p-3 text-xs">
            {issues.map((i, k) => <li key={k} className="flex gap-2"><XCircle className={cn("size-3.5 shrink-0", i.blocking ? "text-destructive" : "text-amber-600")} /><span className="tabular-nums text-muted-foreground">{isAr ? "سطر" : "Line"} {i.line}</span><span>{isAr ? i.messageAr : i.message}</span></li>)}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { reset(); onOpenChange(false) }}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button type="button" disabled={busy || rows.length === 0} onClick={() => void run()}>{busy && <Loader2 className="me-2 size-4 animate-spin" />}{isAr ? `استيراد ومطابقة ${rows.length}` : `Import & match ${rows.length}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
