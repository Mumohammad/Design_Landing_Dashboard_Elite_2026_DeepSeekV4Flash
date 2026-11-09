"use client"

import { useEffect, useRef, useState } from "react"
import { FileUp, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DocumentUploadDialog } from "@/components/drivers/document-upload-dialog"
import { createClient } from "@/lib/supabase/client"

import { documentDriverNeedle, readDocumentDriver, searchDocumentDrivers, type DocumentDriverRow, type DocumentDriverTarget } from "@/lib/drivers/document-quick-read"
type Props = { open: boolean; onOpenChange: (open: boolean) => void; isAr: boolean; driverId?: string; onUploaded?: () => void }

/** Closing or changing the fixed driver unmounts the entire draft session. */
export function DriverDocumentQuickUpload(props: Props) {
  return props.open ? <DriverDocumentUploadSession key={props.driverId ?? "picker"} {...props} /> : null
}

function DriverDocumentUploadSession({ onOpenChange, isAr, driverId, onUploaded }: Props) {
  const [target, setTarget] = useState<DocumentDriverTarget | null>(null)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<{ query: string; rows: DocumentDriverRow[]; error: boolean }>({ query: "", rows: [], error: false })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const activeChoice = useRef<{ controller?: AbortController }>({})
  const t = (en: string, ar: string) => isAr ? ar : en

  const choose = async (id: string) => {
    activeChoice.current.controller?.abort()
    const controller = new AbortController()
    activeChoice.current.controller = controller
    setLoading(true); setLoadError(false)
    try { const selected = await readDocumentDriver(createClient(), id, controller.signal); if (!controller.signal.aborted) setTarget(selected) }
    catch { if (!controller.signal.aborted) setLoadError(true) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    const choices = activeChoice.current
    return () => { choices.controller?.abort() }
  }, [])
  useEffect(() => {
    if (!driverId) return
    const controller = new AbortController()
    void readDocumentDriver(createClient(), driverId, controller.signal)
      .then(selected => { if (!controller.signal.aborted) { setTarget(selected); setLoadError(false) } })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true) })
    return () => controller.abort()
  }, [driverId, retry])
  useEffect(() => {
    const needle = documentDriverNeedle(query)
    if (target || needle.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try { const rows = await searchDocumentDrivers(createClient(), needle, controller.signal); if (!controller.signal.aborted) setSearch({ query: needle, rows, error: false }) }
      catch { if (!controller.signal.aborted) setSearch({ query: needle, rows: [], error: true }) }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, target, retry])
  const needle = documentDriverNeedle(query)
  const searching = needle.length >= 2 && search.query !== needle
  const results = !searching && needle.length >= 2 ? search.rows : []
  const searchError = !searching && needle.length >= 2 && search.error
  if (target) {
    return (
      <DocumentUploadDialog open onOpenChange={(o) => { if (!o) onOpenChange(false) }} driverId={target.driverId} expectedDriverVersion={target.version} isAr={isAr} onUploaded={onUploaded} />
    )
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="driver-document-quick-upload">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileUp className="size-5 text-primary" />{t("Upload driver document", "رفع مستند سائق")}</DialogTitle>
          <DialogDescription>{t("Choose the driver, then attach the iqama, licence, passport, contract or any other document.", "اختر السائق ثم أرفق الإقامة أو الرخصة أو الجواز أو العقد أو أي مستند آخر.")}</DialogDescription>
        </DialogHeader>
        {loadError ? <div role="alert" className="space-y-2"><p>{t("Could not load the driver. Try again.", "تعذر تحميل بيانات السائق. أعد المحاولة.")}</p><Button variant="outline" onClick={() => driverId ? setRetry(value => value + 1) : setLoadError(false)}>{t("Try again", "أعد المحاولة")}</Button></div> : driverId || loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="dqu-search">{t("Driver", "السائق")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="dqu-search" autoFocus autoComplete="off" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search name, code, mobile or iqama…", "ابحث بالاسم أو الرمز أو الجوال أو الإقامة…")} />
              {searching && <Loader2 className="absolute end-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {results.length > 0 && (
              <ul className="max-h-72 overflow-y-auto rounded-lg border p-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => void choose(r.id)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-accent">
                      <span className="truncate">{r.full_name_en || r.full_name_ar}</span>
                      <span dir="ltr" className="shrink-0 font-mono text-xs text-muted-foreground">{r.driver_code ?? r.primary_mobile}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchError && <div role="alert" className="space-y-2"><p>{t("Could not search drivers. Try again.", "تعذر البحث عن السائقين. أعد المحاولة.")}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t("Try again", "أعد المحاولة")}</Button></div>}
            {!searching && !searchError && needle.length >= 2 && results.length === 0 && <p className="text-xs text-muted-foreground">{t("No matching drivers. Add or import drivers first.", "لا يوجد سائق مطابق. أضف السائقين أو استوردهم أولاً.")}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
