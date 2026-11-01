"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BadgeCheck, Copy, CreditCard, Loader2, Pencil, Plus, Printer, Star, Trash2 } from "lucide-react"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDriverPhoto } from "@/components/drivers/photo-provider"
import { PlatformDot } from "@/components/drivers/platform-ids-editor"
import { RiderCardPreview } from "@/components/drivers/driver-card-preview"
import { DriverCardPanel } from "@/components/drivers/driver-card-panel"
import { buildRiderCardsPrintHtml, type DriverCardOutputFormat } from "@/lib/drivers/card-print"
import { DEFAULT_CARD_PLATFORM, DEFAULT_CARD_THEME, DELIVERY_PLATFORMS, RIDER_ID_PATTERN, platformByCode, platformLabel, platformTheme } from "@/lib/drivers/platforms"
import { fetchDriverPlatformAccounts, sortAccounts, type DriverPlatformAccount } from "@/lib/drivers/platform-accounts"
import { recordPlatformCardPrints, removeDriverPlatformAccount, saveDriverPlatformAccount } from "@/app/actions/drivers/platform-accounts"
import { createClient } from "@/lib/supabase/client"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import type { DriverCardPerson } from "@/lib/drivers/cards"
import type { Driver } from "@/types/drivers"

const STATUS: Record<DriverPlatformAccount["status"], { en: string; ar: string; cls: string }> = {
  active: { en: "Active", ar: "نشط", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  suspended: { en: "Suspended", ar: "موقوف", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  inactive: { en: "Inactive", ar: "غير نشط", cls: "bg-muted text-muted-foreground" },
}

type Draft = { id?: string; code: string; riderId: string; status: DriverPlatformAccount["status"]; isPrimary: boolean; notes: string }

export function cardPersonFromDriver(driver: Driver, photoUrl: string | null): DriverCardPerson {
  return {
    name: driver.full_name_en?.trim() || driver.full_name_ar || "—",
    phone: driver.primary_mobile ?? driver.secondary_mobile ?? null,
    idNumber: driver.iqama_number ?? null,
    photoUrl,
  }
}

/** Opens a print window for rider cards and waits for fonts/photos. */
export async function printRiderCards(html: string): Promise<boolean> {
  const popup = window.open("", "_blank", "width=760,height=620")
  if (!popup) return false
  popup.document.write(html)
  popup.document.close()
  let timeout: number | undefined
  try {
    await Promise.race([
      Promise.all([popup.document.fonts.ready, ...Array.from(popup.document.images, (image) => image.decode().catch(() => undefined))]),
      new Promise((resolve) => { timeout = window.setTimeout(resolve, 6000) }),
    ])
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
  popup.focus()
  popup.print()
  return true
}

/** Records a successful platform card print, then notifies print-log listeners. */
export function logPlatformCardPrint(driverId: string, cards: { platform_code: string; rider_id: string | null }[], format: "pvc" | "a4") {
  void recordPlatformCardPrints({ driverId, cards, format }).then((r) => {
    if (r.ok && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("platform-card-printed", { detail: { driverId } }))
  })
}

export function DriverPlatformAccountsPanel({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const [accounts, setAccounts] = useState<DriverPlatformAccount[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<DriverPlatformAccount | null>(null)
  const [format, setFormat] = useState<DriverCardOutputFormat>("pvc")
  const { photoUrl } = useDriverPhoto()
  const person = useMemo(() => cardPersonFromDriver(driver, photoUrl), [driver, photoUrl])

  const load = useCallback(async () => {
    try {
      setAccounts(sortAccounts(await fetchDriverPlatformAccounts(driver.id)))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [driver.id])

  useEffect(() => {
    let cancelled = false
    fetchDriverPlatformAccounts(driver.id)
      .then((rows) => { if (!cancelled) { setAccounts(sortAccounts(rows)); setFailed(false) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [driver.id])

  const used = new Set((accounts ?? []).map((a) => a.platform_code))
  const activeAccounts = (accounts ?? []).filter((a) => a.status === "active")

  const openNew = () => {
    const next = DELIVERY_PLATFORMS.find((p) => !used.has(p.code))
    setDraft({ code: next?.code ?? "", riderId: "", status: "active", isPrimary: (accounts ?? []).length === 0, notes: "" })
  }
  const openEdit = (a: DriverPlatformAccount) =>
    setDraft({ id: a.id, code: a.platform_code, riderId: a.platform_driver_id, status: a.status, isPrimary: a.is_primary, notes: a.notes ?? "" })

  const draftError = draft && draft.riderId.trim() && !RIDER_ID_PATTERN.test(draft.riderId.trim())
    ? (isAr ? "يقبل الحروف والأرقام والنقطة والشرطة فقط (حتى 64)." : "Letters, digits, dot, dash, slash or underscore (max 64).")
    : null

  const onSave = async () => {
    if (!draft || busy || !draft.code || !draft.riderId.trim() || draftError) return
    setBusy(true)
    const res = await saveDriverPlatformAccount({ driverId: driver.id, platformCode: draft.code, platformDriverId: draft.riderId.trim(), status: draft.status, isPrimary: draft.isPrimary, notes: draft.notes.trim() || null })
    setBusy(false)
    if (!res.ok) return void toast.error(isAr ? res.errorAr : res.error)
    toast.success(isAr ? "تم حفظ رقم المندوب" : "Rider ID saved")
    setDraft(null)
    await load()
    emitDriverChanged({ driverId: driver.id, action: "platforms" })
  }

  const onRemove = async () => {
    if (!removing || busy) return
    setBusy(true)
    const res = await removeDriverPlatformAccount({ id: removing.id, driverId: driver.id })
    setBusy(false)
    if (!res.ok) return void toast.error(isAr ? res.errorAr : res.error)
    toast.success(isAr ? "تم حذف حساب المنصة" : "Platform account removed")
    setRemoving(null)
    await load()
    emitDriverChanged({ driverId: driver.id, action: "platforms" })
  }

  const print = async (list: DriverPlatformAccount[]) => {
    if (!list.length) return
    const html = buildRiderCardsPrintHtml(
      list.map((a) => ({ theme: platformTheme(a.platform_code), riderId: a.platform_driver_id, footerRef: driver.driver_code ?? null, title: `${platformLabel(a.platform_code, false)} rider card ${a.platform_driver_id}` })),
      person,
      format,
    )
    if (!(await printRiderCards(html))) return void toast.error(isAr ? "اسمح بالنوافذ المنبثقة ثم أعد المحاولة." : "Allow popups and try again.")
    logPlatformCardPrint(driver.id, list.map((a) => ({ platform_code: a.platform_code, rider_id: a.platform_driver_id })), format)
  }

  const printCompany = async () => {
    const html = buildRiderCardsPrintHtml([{ theme: DEFAULT_CARD_THEME, riderId: driver.rider_id ?? driver.driver_code ?? "—", footerRef: driver.driver_code ?? null, title: `Rider card ${driver.rider_id ?? driver.driver_code ?? ""}` }], person, format)
    if (!(await printRiderCards(html))) return void toast.error(isAr ? "اسمح بالنوافذ المنبثقة ثم أعد المحاولة." : "Allow popups and try again.")
    logPlatformCardPrint(driver.id, [{ platform_code: DEFAULT_CARD_PLATFORM, rider_id: driver.rider_id ?? driver.driver_code ?? null }], format)
  }

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success(isAr ? "تم النسخ" : "Copied") } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="space-y-6" data-testid="driver-platform-accounts">
      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{isAr ? "حسابات المنصات وأرقام المندوب" : "Platform accounts & rider IDs"}</h3>
            <p className="text-xs text-muted-foreground">
              {isAr ? "رقم المندوب الرئيسي يُستخدم في الرواتب وبطاقة السائق." : "The primary rider ID is used by payroll imports and the driver card."}
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNew} disabled={!accounts || used.size >= DELIVERY_PLATFORMS.length}>
            <Plus className="size-3.5" />
            {isAr ? "إضافة منصة" : "Add platform"}
          </Button>
        </div>

        {failed ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">{isAr ? "تعذر تحميل حسابات المنصات." : "Could not load platform accounts."}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>{isAr ? "أعد المحاولة" : "Try again"}</Button>
          </div>
        ) : !accounts ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        ) : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
            {isAr ? "لم تُضف أرقام منصات بعد. أضف رقم المندوب في هنقرستيشن أو كيتا أو جاهز…" : "No platform IDs yet. Add the rider ID for HungerStation, Keeta, Jahez…"}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => {
              const p = platformByCode(a.platform_code)
              const st = STATUS[a.status]
              return (
                <li key={a.id} className="group relative overflow-hidden rounded-xl border border-border/60 bg-background p-4 shadow-xs">
                  <span aria-hidden className="absolute inset-y-0 start-0 w-1.5" style={{ background: p?.color ?? "#1E5A99" }} />
                  <div className="flex items-start justify-between gap-2 ps-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <PlatformDot code={a.platform_code} />
                        {platformLabel(a.platform_code, isAr)}
                        {a.is_primary && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-elite-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-elite-blue-700 dark:text-elite-blue-300">
                            <Star className="size-3 fill-current" />{isAr ? "رئيسي" : "Primary"}
                          </span>
                        )}
                      </p>
                      <button type="button" onClick={() => void copy(a.platform_driver_id)} className="mt-1 inline-flex items-center gap-1 font-mono text-base font-semibold tabular-nums hover:text-elite-blue-600" dir="ltr" title={isAr ? "نسخ" : "Copy"}>
                        {a.platform_driver_id}<Copy className="size-3 opacity-50" />
                      </button>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{isAr ? st.ar : st.en}</span>
                  </div>
                  {a.notes && <p className="mt-2 ps-2 text-xs text-muted-foreground">{a.notes}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5 ps-2">
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => openEdit(a)}><Pencil className="size-3" />{isAr ? "تعديل" : "Edit"}</Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void print([a])} disabled={a.status !== "active"}><Printer className="size-3" />{isAr ? "طباعة البطاقة" : "Print card"}</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-red-600 dark:text-red-400" onClick={() => setRemoving(a)}><Trash2 className="size-3" />{isAr ? "حذف" : "Remove"}</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="size-4 text-elite-blue-500" />{isAr ? "بطاقات هوية المنصات" : "Platform ID cards"}</h3>
            <p className="text-xs text-muted-foreground">
              {isAr ? "بطاقة تلقائية بهوية كل منصة نشطة، وتظهر فيها صورة السائق ورقم المندوب." : "Auto-generated in each active platform's branding with the driver photo and rider ID."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={format} onValueChange={(v) => setFormat(v as DriverCardOutputFormat)}>
              <SelectTrigger className="h-8 w-24 text-xs" aria-label={isAr ? "صيغة الطباعة" : "Print format"}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pvc">PVC</SelectItem><SelectItem value="a4">A4</SelectItem></SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={activeAccounts.length === 0} onClick={() => void print(activeAccounts)}>
              <Printer className="size-3.5" />{isAr ? "طباعة الكل" : "Print all"}
            </Button>
          </div>
        </div>
        {activeAccounts.length === 0 ? (
          <figure className="rounded-xl border border-border/50 bg-muted/20 p-4" data-testid="company-card-preview">
            <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
              <span className="flex items-center gap-2"><PlatformDot code="hungerstation" />{isAr ? "بطاقة السائق (تصميم هنقرستيشن)" : "Driver card (HungerStation design)"}</span>
              <span className="flex items-center gap-2 font-normal text-muted-foreground">
                {isAr ? "أضف رقم مندوب نشط لإصدار بطاقة المنصة." : "Add an active rider ID for the platform-branded card."}
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void printCompany()}><Printer className="size-3" />{isAr ? "طباعة" : "Print"}</Button>
              </span>
            </figcaption>
            <RiderCardPreview theme={DEFAULT_CARD_THEME} riderId={driver.rider_id ?? driver.driver_code ?? "—"} footerRef={driver.driver_code ?? null} person={person} scale={0.62} />
          </figure>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {activeAccounts.map((a) => (
              <figure key={a.id} className="rounded-xl border border-border/50 bg-muted/20 p-4">
                <figcaption className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold">
                  <span className="flex items-center gap-2"><PlatformDot code={a.platform_code} />{platformLabel(a.platform_code, isAr)}</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><BadgeCheck className="size-3.5 text-emerald-500" /><span dir="ltr" className="font-mono">{a.platform_driver_id}</span></span>
                </figcaption>
                <RiderCardPreview theme={platformTheme(a.platform_code)} riderId={a.platform_driver_id} footerRef={driver.driver_code ?? null} person={person} scale={0.62} />
              </figure>
            ))}
          </div>
        )}
      </section>

      <PlatformCardPrintLog driverId={driver.id} isAr={isAr} />

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm [&>[data-testid=driver-card-panel]]:mt-0 [&>[data-testid=driver-card-panel]]:border-t-0 [&>[data-testid=driver-card-panel]]:pt-0">
        <DriverCardPanel driverId={driver.id} isAr={isAr} />
      </section>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o && !busy) setDraft(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? (isAr ? "تعديل حساب المنصة" : "Edit platform account") : (isAr ? "إضافة حساب منصة" : "Add platform account")}</DialogTitle>
            <DialogDescription>{isAr ? "رقم المندوب كما يظهر في تطبيق المنصة أو كشف الرواتب." : "The rider ID exactly as shown in the platform app or payout sheet."}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="dpa-platform">{isAr ? "المنصة" : "Platform"}</Label>
                <Select value={draft.code || undefined} onValueChange={(v) => setDraft({ ...draft, code: v })} disabled={!!draft.id}>
                  <SelectTrigger id="dpa-platform" className="w-full"><SelectValue placeholder={isAr ? "اختر المنصة" : "Choose platform"} /></SelectTrigger>
                  <SelectContent>
                    {DELIVERY_PLATFORMS.map((p) => (
                      <SelectItem key={p.code} value={p.code} disabled={used.has(p.code) && p.code !== draft.code}>
                        <PlatformDot code={p.code} />{isAr ? p.ar : p.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dpa-rider">{isAr ? "رقم المندوب" : "Rider ID"}</Label>
                <Input id="dpa-rider" dir="ltr" className="font-mono" maxLength={64} value={draft.riderId} onChange={(e) => setDraft({ ...draft, riderId: e.target.value })} aria-invalid={!!draftError} aria-describedby={draftError ? "dpa-rider-error" : undefined} />
                {draftError && <p id="dpa-rider-error" className="text-xs text-destructive">{draftError}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="dpa-status">{isAr ? "الحالة" : "Status"}</Label>
                  <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as Draft["status"] })}>
                    <SelectTrigger id="dpa-status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(STATUS) as Draft["status"][]).map((k) => <SelectItem key={k} value={k}>{isAr ? STATUS[k].ar : STATUS[k].en}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <label className="flex items-end justify-between gap-2 pb-2 text-sm">
                  <span>{isAr ? "المنصة الرئيسية" : "Primary platform"}</span>
                  <Switch checked={draft.isPrimary} onCheckedChange={(v) => setDraft({ ...draft, isPrimary: v })} />
                </label>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dpa-notes">{isAr ? "ملاحظات" : "Notes"}</Label>
                <Textarea id="dpa-notes" rows={2} maxLength={500} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => void onSave()} disabled={busy || !draft?.code || !draft?.riderId.trim() || !!draftError}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}{isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => { if (!o && !busy) setRemoving(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAr ? "حذف حساب المنصة؟" : "Remove platform account?"}</DialogTitle>
            <DialogDescription>
              {removing && `${platformLabel(removing.platform_code, isAr)} · ${removing.platform_driver_id}`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>{isAr ? "تراجع" : "Cancel"}</Button>
            <Button variant="destructive" onClick={() => void onRemove()} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />}{isAr ? "حذف" : "Remove"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type PrintLogRow = { id: string; platform_code: string; rider_id: string | null; format: string; printed_at: string }

/** Platform rider card print history (append-only, newest first). */
function PlatformCardPrintLog({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [rows, setRows] = useState<PrintLogRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () => void createClient().from("driver_platform_card_prints")
      .select("id,platform_code,rider_id,format,printed_at").eq("driver_id", driverId)
      .order("printed_at", { ascending: false }).limit(20)
      .then(({ data, error }) => { if (!cancelled) setRows(error ? [] : ((data ?? []) as PrintLogRow[])) })
    load()
    const onPrinted = (e: Event) => { if ((e as CustomEvent<{ driverId: string }>).detail?.driverId === driverId) load() }
    window.addEventListener("platform-card-printed", onPrinted)
    return () => { cancelled = true; window.removeEventListener("platform-card-printed", onPrinted) }
  }, [driverId])
  if (!rows || rows.length === 0) return null
  return (
    <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm" data-testid="platform-card-print-log">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Printer className="size-4 text-elite-blue-500" />{isAr ? "سجل طباعة بطاقات المنصات" : "Platform card print log"}</h3>
      <ul className="divide-y rounded-xl border text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="flex items-center gap-2"><PlatformDot code={r.platform_code} />{platformLabel(r.platform_code, isAr)}{r.rider_id && <span dir="ltr" className="font-mono text-muted-foreground">{r.rider_id}</span>}</span>
            <span className="flex items-center gap-3 text-muted-foreground"><span className="uppercase">{r.format}</span><time dateTime={r.printed_at} className="tabular-nums">{new Date(r.printed_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</time></span>
          </li>
        ))}
      </ul>
    </section>
  )
}
