"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, ImagePlus, Loader2, Printer, RotateCcw, Search, UserRound, X } from "lucide-react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlatformDot } from "@/components/drivers/platform-ids-editor"
import { RiderCardFace } from "@/components/drivers/driver-card-preview"
import { logPlatformCardPrint, printRiderCards } from "@/components/drivers/card-output"
import { buildRiderCardsPrintHtml, type DriverCardOutputFormat } from "@/lib/drivers/card-print"
import { cardPdfFilename, downloadBlob, renderRiderCardsPdf } from "@/lib/drivers/card-pdf"
import {
  CUSTOM_PLATFORM, draftFromProfile, draftIssues, draftToCard, emptyDraft, riderIdFor,
  type CardAccountSource, type CardDraft, type CardProfileSource,
} from "@/lib/drivers/card-editor"
import { DELIVERY_PLATFORMS } from "@/lib/drivers/platforms"
import { DRIVER_PHOTO_BUCKET } from "@/lib/drivers/photo"
import { fetchDriverPlatformAccounts } from "@/lib/drivers/platform-accounts"
import { createClient } from "@/lib/supabase/client"

type ProfileRow = CardProfileSource & { photo_url: string | null }
const PROFILE_COLUMNS = "id,driver_code,full_name_en,full_name_ar,primary_mobile,secondary_mobile,iqama_number,rider_id,photo_url"
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

export interface RiderCardEditorSeed {
  driver?: CardProfileSource | null
  photoUrl?: string | null
  platformCode?: string
}

async function signPhoto(path: string | null): Promise<string | null> {
  if (!path) return null
  if (/^https?:\/\//.test(path)) return path
  const { data } = await createClient().storage.from(DRIVER_PHOTO_BUCKET).createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

/**
 * Rider card designer: auto-fills from a driver profile (search or seed),
 * every field stays editable, live front/back preview, print (PVC/A4) and
 * save as PDF. Edits apply to the printed card only.
 */
export function RiderCardEditor({ open, onOpenChange, isAr, seed }: { open: boolean; onOpenChange: (o: boolean) => void; isAr: boolean; seed?: RiderCardEditorSeed | null }) {
  const [draft, setDraft] = useState<CardDraft>(emptyDraft)
  const [profile, setProfile] = useState<{ driver: CardProfileSource; photoUrl: string | null; accounts: CardAccountSource[] } | null>(null)
  const [format, setFormat] = useState<DriverCardOutputFormat>("pvc")
  const [busy, setBusy] = useState<null | "print" | "pdf" | "load">(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProfileRow[]>([])
  const [searching, setSearching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const t = (en: string, ar: string) => (isAr ? ar : en)

  const applyProfile = async (driver: CardProfileSource, photoUrl: string | null, platformCode?: string) => {
    setBusy("load")
    let accounts: CardAccountSource[] = []
    try { accounts = await fetchDriverPlatformAccounts(driver.id) } catch { /* card still fills from the profile */ }
    setProfile({ driver, photoUrl, accounts })
    setDraft(draftFromProfile(driver, photoUrl, accounts, platformCode))
    setBusy(null)
  }

  // Seed (profile page) → auto-fill each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setQuery(""); setResults([])
    if (seed?.driver) void applyProfile(seed.driver, seed.photoUrl ?? null, seed.platformCode)
    else { setProfile(null); setDraft(emptyDraft()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when opened
  }, [open])

  // Debounced driver search (name, code, mobile, iqama).
  useEffect(() => {
    const q = query.trim().replace(/[%,()*\\"]/g, " ").trim()
    if (!open || q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const h = window.setTimeout(async () => {
      const like = `"%${q}%"`
      const { data } = await createClient().from("drivers").select(PROFILE_COLUMNS)
        .or(`full_name_en.ilike.${like},full_name_ar.ilike.${like},driver_code.ilike.${like},primary_mobile.ilike.${like},iqama_number.ilike.${like}`)
        .is("deleted_at", null).limit(8)
      if (!cancelled) { setResults((data ?? []) as ProfileRow[]); setSearching(false) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(h) }
  }, [query, open])

  const pick = async (row: ProfileRow) => {
    setResults([]); setQuery("")
    await applyProfile(row, await signPhoto(row.photo_url))
  }

  const set = <K extends keyof CardDraft>(k: K, v: CardDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setPlatform = (code: string) => setDraft((d) => ({
    ...d,
    platform: code,
    riderId: profile && code !== CUSTOM_PLATFORM ? riderIdFor(code, profile.accounts, profile.driver) || d.riderId : d.riderId,
  }))

  const onPhoto = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) return void toast.error(t("Choose an image file.", "اختر ملف صورة."))
    if (file.size > MAX_PHOTO_BYTES) return void toast.error(t("Photo must be under 5 MB.", "يجب أن تكون الصورة أقل من 5 ميجابايت."))
    const r = new FileReader()
    r.onload = () => set("photoUrl", String(r.result))
    r.readAsDataURL(file)
  }

  const issues = draftIssues(draft)
  const card = useMemo(() => draftToCard(draft), [draft])
  const logCode = draft.platform === CUSTOM_PLATFORM ? "custom" : draft.platform

  const onPrint = async () => {
    if (issues.length || busy) return
    setBusy("print")
    try {
      const ok = await printRiderCards(buildRiderCardsPrintHtml([card.face], card.person, format))
      if (!ok) return void toast.error(t("Allow popups and try again.", "اسمح بالنوافذ المنبثقة ثم أعد المحاولة."))
      if (draft.driverId) logPlatformCardPrint(draft.driverId, [{ platform_code: logCode, rider_id: draft.riderId.trim() }], format)
    } finally { setBusy(null) }
  }

  const onPdf = async () => {
    if (issues.length || busy) return
    setBusy("pdf")
    try {
      const blob = await renderRiderCardsPdf([card.face], card.person, format)
      downloadBlob(blob, cardPdfFilename(draft.riderId.trim(), logCode))
      if (draft.driverId) logPlatformCardPrint(draft.driverId, [{ platform_code: logCode, rider_id: draft.riderId.trim() }], "pdf")
      toast.success(t("PDF saved", "تم حفظ ملف PDF"))
    } catch {
      toast.error(t("Could not create the PDF. Try Print → Save as PDF instead.", "تعذر إنشاء ملف PDF. جرّب الطباعة ثم الحفظ كـ PDF."))
    } finally { setBusy(null) }
  }

  const reset = () => { if (profile) setDraft(draftFromProfile(profile.driver, profile.photoUrl, profile.accounts, draft.platform === CUSTOM_PLATFORM ? undefined : draft.platform)) }

  const field = (id: keyof CardDraft, label: string, opts: { ltr?: boolean; max?: number; error?: string | null; placeholder?: string } = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`rce-${id}`}>{label}</Label>
      <Input id={`rce-${id}`} dir={opts.ltr ? "ltr" : "auto"} maxLength={opts.max ?? 60} placeholder={opts.placeholder}
        value={String(draft[id] ?? "")} onChange={(e) => set(id, e.target.value as never)}
        aria-invalid={!!opts.error} className={opts.ltr ? "font-mono" : undefined} />
      {opts.error && <p className="text-xs text-destructive">{opts.error}</p>}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy || busy === "load") onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl" data-testid="rider-card-editor">
        <DialogHeader>
          <DialogTitle>{t("Rider card designer", "مصمم بطاقة المندوب")}</DialogTitle>
          <DialogDescription>
            {t("Auto-filled from the driver profile — edit any field, then print or save as PDF. Edits change the card only, not the driver record.",
              "تُعبأ تلقائياً من ملف السائق — عدّل أي حقل ثم اطبع أو احفظ PDF. التعديلات على البطاقة فقط ولا تغيّر بيانات السائق.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid content-start gap-4">
            <div className="relative grid gap-1.5">
              <Label htmlFor="rce-search">{t("Fill from driver profile", "تعبئة من ملف السائق")}</Label>
              {profile ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><UserRound className="size-4 shrink-0 text-elite-blue-500" />
                    <span className="truncate">{profile.driver.full_name_en || profile.driver.full_name_ar}</span>
                    {profile.driver.driver_code && <span dir="ltr" className="font-mono text-xs text-muted-foreground">{profile.driver.driver_code}</span>}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={reset}><RotateCcw className="size-3" />{t("Reset", "إعادة التعبئة")}</Button>
                    <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("Clear driver", "إزالة السائق")} onClick={() => { setProfile(null); setDraft((d) => ({ ...d, driverId: null, footerRef: null })) }}><X className="size-3.5" /></Button>
                  </span>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="rce-search" className="ps-8" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off"
                      placeholder={t("Search name, code, mobile or iqama… (or type the card manually)", "ابحث بالاسم أو الرمز أو الجوال أو الإقامة… (أو أدخل البيانات يدوياً)")} />
                    {(searching || busy === "load") && <Loader2 className="absolute end-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                  </div>
                  {results.length > 0 && (
                    <ul role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button type="button" role="option" aria-selected={false} onClick={() => void pick(r)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent">
                            <span className="truncate">{r.full_name_en || r.full_name_ar}</span>
                            <span dir="ltr" className="shrink-0 font-mono text-xs text-muted-foreground">{r.driver_code ?? r.primary_mobile}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!searching && query.trim().length >= 2 && results.length === 0 && <p className="text-xs text-muted-foreground">{t("No matching drivers.", "لا يوجد سائق مطابق.")}</p>}
                </>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="rce-platform">{t("Card design (platform)", "تصميم البطاقة (المنصة)")}</Label>
                <Select value={draft.platform} onValueChange={setPlatform}>
                  <SelectTrigger id="rce-platform" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DELIVERY_PLATFORMS.map((p) => <SelectItem key={p.code} value={p.code}><PlatformDot code={p.code} />{isAr ? p.ar : p.en}</SelectItem>)}
                    <SelectItem value={CUSTOM_PLATFORM}>{t("Other platform…", "منصة أخرى…")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.platform === CUSTOM_PLATFORM
                ? field("customName", t("Platform name", "اسم المنصة"), { max: 14, error: issues.includes("customName") ? t("Required", "مطلوب") : null })
                : field("riderId", t("Rider ID", "رقم المندوب"), { ltr: true, max: 64, error: issues.includes("riderIdFormat") ? t("Letters, digits, . - / _ only", "حروف وأرقام و . - / _ فقط") : issues.includes("riderId") ? t("Required", "مطلوب") : null })}
              {draft.platform === CUSTOM_PLATFORM && field("riderId", t("Rider ID", "رقم المندوب"), { ltr: true, max: 64, error: issues.includes("riderIdFormat") ? t("Letters, digits, . - / _ only", "حروف وأرقام و . - / _ فقط") : issues.includes("riderId") ? t("Required", "مطلوب") : null })}
              {field("name", t("Name", "الاسم"), { error: issues.includes("name") ? t("Required", "مطلوب") : null })}
              {field("phone", t("Mobile", "الجوال"), { ltr: true, max: 20 })}
              {field("idNumber", t("ID number", "رقم الهوية / الإقامة"), { ltr: true, max: 20 })}
              <div className="grid gap-1.5">
                <Label>{t("Photo", "الصورة")}</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-9 flex-1 gap-1.5" onClick={() => fileRef.current?.click()}><ImagePlus className="size-3.5" />{draft.photoUrl ? t("Change", "تغيير") : t("Upload", "رفع صورة")}</Button>
                  {draft.photoUrl && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => set("photoUrl", null)}>{t("Remove", "إزالة")}</Button>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = "" }} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Select value={format} onValueChange={(v) => setFormat(v as DriverCardOutputFormat)}>
                <SelectTrigger className="h-9 w-40 text-xs" aria-label={t("Paper", "الورق")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pvc">{t("PVC card (54×86 mm)", "بطاقة PVC (54×86 مم)")}</SelectItem>
                  <SelectItem value="a4">{t("A4 sheet", "ورقة A4")}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => void onPrint()} disabled={!!issues.length || !!busy} className="gap-1.5" data-testid="rider-card-editor-print">
                {busy === "print" ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />}{t("Print", "طباعة")}
              </Button>
              <Button variant="outline" onClick={() => void onPdf()} disabled={!!issues.length || !!busy} className="gap-1.5" data-testid="rider-card-editor-pdf">
                {busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{t("Save as PDF", "حفظ PDF")}
              </Button>
            </div>
          </div>

          <div className="flex justify-center gap-3 rounded-xl bg-muted/30 p-3" aria-label={t("Live preview", "معاينة مباشرة")}>
            <RiderCardFace side="front" scale={0.56} theme={card.face.theme} riderId={card.face.riderId} footerRef={card.face.footerRef} person={card.person} />
            <RiderCardFace side="back" scale={0.56} theme={card.face.theme} riderId={card.face.riderId} footerRef={card.face.footerRef} person={card.person} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
