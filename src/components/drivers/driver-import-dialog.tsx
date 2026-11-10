"use client"

import { useState } from "react"
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { downloadTemplate, readSheetRows } from "@/lib/import/sheet"
import { DRIVER_IMPORT_FIELDS, DRIVER_IMPORT_MAX_ROWS, parseDriverRows, type DriverImportIssue, type DriverImportRow } from "@/lib/drivers/import"
import { importDriversBatch } from "@/app/actions/drivers/import"

type Outcome = { line: number; ok: boolean; error?: string }

export function DriverImportDialog({ open, onOpenChange, isAr, onImported }: { open: boolean; onOpenChange: (v: boolean) => void; isAr: boolean; onImported: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<DriverImportRow[]>([])
  const [issues, setIssues] = useState<DriverImportIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const reset = () => { setFileName(null); setRows([]); setIssues([]); setOutcomes(null); setProgress(0) }

  const read = async (file: File) => {
    reset()
    try {
      const raw = await readSheetRows(file)
      if (raw.length > DRIVER_IMPORT_MAX_ROWS) { toast.error(isAr ? `الحد الأقصى ${DRIVER_IMPORT_MAX_ROWS} سطر لكل ملف` : `Up to ${DRIVER_IMPORT_MAX_ROWS} rows per file`); return }
      const parsed = parseDriverRows(raw)
      setFileName(file.name); setRows(parsed.rows); setIssues(parsed.issues)
    } catch { toast.error(isAr ? "تعذر قراءة الملف. استخدم القالب بصيغة Excel أو CSV." : "Could not read the file. Use the Excel/CSV template.") }
  }

  const template = () => downloadTemplate("drivers-import-template.xlsx", DRIVER_IMPORT_FIELDS.map((f) => f.header), [
    ["DRV-1001", "محمد أحمد علي", "Mohammed Ahmed Ali", "0551234567", "Pakistan", "2123456789", "2027-05-31", "AB1234567", "2029-01-15", "LIC-778899", "2028-03-01", "1995-04-12", "freelancer", "full_time", "draft", "2026-01-01", "Riyadh", "", "", 3000],
  ])

  const run = async () => {
    if (!rows.length) return
    setBusy(true); setProgress(0)
    const all: Outcome[] = []
    try {
      for (let i = 0; i < rows.length; i += 25) {
        const chunk = rows.slice(i, i + 25)
        const res = await importDriversBatch(chunk.map((r) => ({ line: r.line, input: r.input })))
        if (!res.ok) { toast.error(isAr ? res.errorAr : res.error); break }
        all.push(...res.results)
        setProgress(Math.min(rows.length, i + chunk.length))
      }
    } finally {
      setOutcomes(all); setBusy(false)
      const created = all.filter((o) => o.ok).length
      if (created) { toast.success(isAr ? `تمت إضافة ${created} سائق` : `${created} driver${created === 1 ? "" : "s"} imported`); onImported() }
    }
  }

  const failed = outcomes?.filter((o) => !o.ok) ?? []
  const created = outcomes?.filter((o) => o.ok).length ?? 0

  return (
    <Dialog open={open} onOpenChange={(v) => { if (busy) return; if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-primary" />{isAr ? "استيراد السائقين من Excel" : "Import drivers from Excel"}</DialogTitle>
          <DialogDescription>{isAr ? "نزّل القالب واملأه، ثم ارفعه. تُراجع كل الأسطر قبل الإضافة، ويُنشأ كل سائق كمسودة ما لم تحدد الحالة." : "Download the template, fill it in and upload it. Every row is validated before anything is created; drivers are added as Draft unless a status is given."}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
          <span className="text-muted-foreground">{isAr ? "الحقول الإلزامية: الاسم بالعربي والجوال" : "Required: Arabic full name and mobile"}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void template()}><Download className="me-1.5 size-4" />{isAr ? "تنزيل القالب" : "Download template"}</Button>
        </div>

        <label
          htmlFor="driver-import-file"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void read(f) }}
          className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition", dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40")}
        >
          <Upload className="size-7 text-primary" />
          <span className="font-medium">{fileName ?? (isAr ? "اسحب الملف هنا أو اضغط للاختيار" : "Drop the file here or click to choose")}</span>
          <span className="text-xs text-muted-foreground">.xlsx · .xls · .csv — {isAr ? `حتى ${DRIVER_IMPORT_MAX_ROWS} سطر` : `up to ${DRIVER_IMPORT_MAX_ROWS} rows`}</span>
          <input id="driver-import-file" type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = "" }} />
        </label>

        {fileName && !outcomes && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><p className="text-2xl font-bold tabular-nums text-emerald-600">{rows.length}</p><p className="text-xs text-muted-foreground">{isAr ? "أسطر جاهزة للإضافة" : "Rows ready to import"}</p></div>
            <div className={cn("rounded-xl border p-3", issues.length ? "border-amber-500/40 bg-amber-500/5" : "")}><p className="text-2xl font-bold tabular-nums text-amber-600">{issues.length}</p><p className="text-xs text-muted-foreground">{isAr ? "أسطر بها أخطاء (لن تُضاف)" : "Rows with errors (skipped)"}</p></div>
          </div>
        )}
        {issues.length > 0 && !outcomes && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border p-3 text-xs" aria-label={isAr ? "أخطاء الملف" : "File errors"}>
            {issues.map((i, k) => <li key={k} className="flex gap-2"><XCircle className="size-3.5 shrink-0 text-amber-600" /><span className="tabular-nums text-muted-foreground">{isAr ? "سطر" : "Line"} {i.line}</span><span>{i.message}</span></li>)}
          </ul>
        )}
        {rows.length > 0 && !outcomes && (
          <div className="max-h-48 overflow-y-auto rounded-xl border text-xs">
            <table className="w-full"><thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-start">#</th><th className="p-2 text-start">{isAr ? "الاسم" : "Name"}</th><th className="p-2 text-start">{isAr ? "الجوال" : "Mobile"}</th><th className="p-2 text-start">{isAr ? "الإقامة" : "Iqama"}</th></tr></thead>
              <tbody>{rows.slice(0, 50).map((r) => <tr key={r.line} className="border-t"><td className="p-2 tabular-nums text-muted-foreground">{r.line}</td><td className="p-2">{r.input.full_name_ar}{r.input.full_name_en ? <span className="text-muted-foreground"> · {r.input.full_name_en}</span> : null}</td><td className="p-2 tabular-nums" dir="ltr">{r.input.primary_mobile}</td><td className="p-2 tabular-nums" dir="ltr">{r.input.iqama_number ?? "—"}</td></tr>)}</tbody></table>
          </div>
        )}
        {busy && <div className="space-y-1"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${rows.length ? (progress / rows.length) * 100 : 0}%` }} /></div><p className="text-xs text-muted-foreground tabular-nums">{progress} / {rows.length}</p></div>}
        {outcomes && (
          <div className="space-y-2" role="status">
            <p className="flex items-center gap-2 font-medium text-emerald-600"><CheckCircle2 className="size-5" />{isAr ? `تمت إضافة ${created} سائق` : `${created} driver${created === 1 ? "" : "s"} created`}</p>
            {failed.length > 0 && <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-destructive/30 p-3 text-xs">{failed.map((o) => <li key={o.line}><span className="tabular-nums text-muted-foreground">{isAr ? "سطر" : "Line"} {o.line}:</span> {o.error}</li>)}</ul>}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { reset(); onOpenChange(false) }}>{outcomes ? (isAr ? "إغلاق" : "Close") : (isAr ? "إلغاء" : "Cancel")}</Button>
          {!outcomes && <Button type="button" disabled={busy || rows.length === 0} onClick={() => void run()}>{busy && <Loader2 className="me-2 size-4 animate-spin" />}{isAr ? `استيراد ${rows.length} سائق` : `Import ${rows.length} driver${rows.length === 1 ? "" : "s"}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
