"use client"

import { useEffect, useState } from "react"
import { FileUp, Loader2, Search } from "lucide-react"
import { toast } from "@/lib/toast"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DocumentUploadDialog } from "@/components/drivers/document-upload-dialog"
import { createClient } from "@/lib/supabase/client"

type Row = { id: string; driver_code: string | null; full_name_en: string | null; full_name_ar: string | null; primary_mobile: string | null; profile_version: number | null }
type Target = { driverId: string; version: number; name: string }

/**
 * Upload a driver document from anywhere in the Drivers module. With a
 * driverId it goes straight to the upload form; otherwise the user picks the
 * driver first (search by name, code, mobile or iqama).
 */
export function DriverDocumentQuickUpload({ open, onOpenChange, isAr, driverId, onUploaded }: { open: boolean; onOpenChange: (o: boolean) => void; isAr: boolean; driverId?: string; onUploaded?: () => void }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Row[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const t = (en: string, ar: string) => (isAr ? ar : en)

  const choose = async (id: string) => {
    setLoading(true)
    const { data, error } = await createClient().from("drivers").select("id,full_name_en,full_name_ar,profile_version").eq("id", id).is("deleted_at", null).maybeSingle()
    setLoading(false)
    if (error || !data) { toast.error(t("Could not load the driver.", "تعذر تحميل بيانات السائق.")); onOpenChange(false); return }
    const r = data as Pick<Row, "id" | "full_name_en" | "full_name_ar" | "profile_version">
    setTarget({ driverId: r.id, version: r.profile_version ?? 1, name: r.full_name_en || r.full_name_ar || "" })
  }

  useEffect(() => {
    if (!open) { setTarget(null); setQuery(""); setResults([]); return }
    if (driverId) void choose(driverId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolve once per open
  }, [open, driverId])

  useEffect(() => {
    const q = query.trim().replace(/[%,()*\\"]/g, " ").trim()
    if (!open || target || q.length < 2) { setResults([]); setSearching(false); return }
    let cancelled = false
    setSearching(true)
    const h = window.setTimeout(async () => {
      const like = `"%${q}%"`
      const { data } = await createClient().from("drivers").select("id,driver_code,full_name_en,full_name_ar,primary_mobile,profile_version")
        .or(`full_name_en.ilike.${like},full_name_ar.ilike.${like},driver_code.ilike.${like},primary_mobile.ilike.${like},iqama_number.ilike.${like}`)
        .is("deleted_at", null).order("full_name_en").limit(10)
      if (!cancelled) { setResults((data ?? []) as Row[]); setSearching(false) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(h) }
  }, [query, open, target])

  if (!open) return null
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
        {driverId || loading ? (
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
              <ul role="listbox" className="max-h-72 overflow-y-auto rounded-lg border p-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => void choose(r.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-accent">
                      <span className="truncate">{r.full_name_en || r.full_name_ar}</span>
                      <span dir="ltr" className="shrink-0 font-mono text-xs text-muted-foreground">{r.driver_code ?? r.primary_mobile}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && query.trim().length >= 2 && results.length === 0 && <p className="text-xs text-muted-foreground">{t("No matching drivers. Add or import drivers first.", "لا يوجد سائق مطابق. أضف السائقين أو استوردهم أولاً.")}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
