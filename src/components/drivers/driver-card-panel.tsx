"use client"

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react"
import { createClient } from "@/lib/supabase/client"
import { issueDriverCard, recordCardPrint, revokeDriverCard } from "@/app/actions/drivers/driver-cards"
import { updateDriverPhoto } from "@/app/actions/drivers/driver-photo"
import type { DriverCard, DriverCardPerson, DriverCardPrint } from "@/lib/drivers/cards"
import { buildCardPrintHtml, DriverCardPreview } from "@/components/drivers/driver-card-preview"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CreditCard, Eye, Printer, User } from "lucide-react"

const cardStatusCls: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  suspended: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  revoked: "bg-red-500/15 text-red-700 dark:text-red-400",
  expired: "bg-muted text-muted-foreground",
}

const cardStatusLabels: Record<string, { en: string; ar: string }> = {
  active: { en: "Active", ar: "نشطة" },
  suspended: { en: "Suspended", ar: "موقوفة" },
  revoked: { en: "Revoked", ar: "ملغاة" },
  expired: { en: "Expired", ar: "منتهية" },
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // driver-photos bucket limit

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

export function DriverCardPanel({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [card, setCard] = useState<DriverCard | null>(null)
  const [prints, setPrints] = useState<DriverCardPrint[]>([])
  const [person, setPerson] = useState<DriverCardPerson | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const [format, setFormat] = useState<"pvc" | "a4" | "screen">("pvc")
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Pure queries: no setState here (react-hooks set-state-in-effect rule).
  const fetchCard = useCallback(async (): Promise<DriverCard | null> => {
    const supabase = createClient()
    const { data } = await supabase
      .from("driver_cards")
      .select("id, driver_id, card_serial, status, issued_at, expires_at, reprint_count")
      .eq("driver_id", driverId)
      .is("deleted_at", null)
      .order("issued_at", { ascending: false })
      .limit(1)
    return (data?.[0] as DriverCard | undefined) ?? null
  }, [driverId])

  const fetchPrints = useCallback(async (cardId: string | null): Promise<DriverCardPrint[]> => {
    if (!cardId) return []
    const supabase = createClient()
    const { data } = await supabase
      .from("driver_card_prints")
      .select("id, card_id, format, printed_at, batch_ref")
      .eq("card_id", cardId)
      .order("printed_at", { ascending: false })
      .limit(20)
    return (data ?? []) as DriverCardPrint[]
  }, [])

  // Card fields (name / mobile / id number / photo) with tolerant fallbacks:
  // driver column naming varies, so read the row and pick what exists.
  const fetchPerson = useCallback(async (): Promise<DriverCardPerson | null> => {
    const supabase = createClient()
    const { data } = await supabase.from("drivers").select("*").eq("id", driverId).maybeSingle()
    if (!data) return null
    const row = data as Record<string, unknown>

    const photoRaw = str(row.photo_url)
    let photoUrl: string | null = null
    if (photoRaw) {
      if (/^https?:\/\//.test(photoRaw)) {
        photoUrl = photoRaw
      } else {
        const { data: signed } = await supabase.storage.from("driver-photos").createSignedUrl(photoRaw, 300)
        photoUrl = signed?.signedUrl ?? null
      }
    }

    return {
      name: str(row.full_name_en) ?? str(row.full_name) ?? str(row.name) ?? str(row.full_name_ar) ?? "—",
      phone: str(row.phone) ?? str(row.mobile) ?? str(row.mobile_number),
      idNumber: str(row.identity_number) ?? str(row.national_id) ?? str(row.id_number) ?? str(row.iqama_number),
      photoUrl,
    }
  }, [driverId])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const [c, p] = await Promise.all([fetchCard(), fetchPerson()])
      const pr = await fetchPrints(c?.id ?? null)
      if (cancelled) return
      setCard(c)
      setPerson(p)
      setPrints(pr)
      setLoading(false)
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [fetchCard, fetchPerson, fetchPrints])

  const refreshAll = async () => {
    const [c, p] = await Promise.all([fetchCard(), fetchPerson()])
    const pr = await fetchPrints(c?.id ?? null)
    setCard(c)
    setPerson(p)
    setPrints(pr)
  }

  const onIssue = async () => {
    setBusy(true)
    setError(null)
    const res = await issueDriverCard({ driverId })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    await refreshAll()
    setPreviewOpen(true) // show the printable card right after issuing
  }

  const onRevoke = async () => {
    if (!card) return
    setBusy(true)
    const res = await revokeDriverCard({ cardId: card.id, reason: revokeReason })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRevokeOpen(false)
    setRevokeReason("")
    await refreshAll()
  }

  const onPrintCard = async () => {
    if (!card) return
    setBusy(true)
    setError(null)
    const res = await recordCardPrint({ cardId: card.id, format })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const w = window.open("", "_blank", "width=760,height=620")
    if (w) {
      w.document.write(buildCardPrintHtml(card, person))
      w.document.close()
      w.focus()
    }
    await refreshAll()
  }

  // Photo upload from the driver profile: browser → driver-photos bucket,
  // then the server action stores the path on drivers.photo_url (engine input).
  const onPhotoSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    if (f.size > MAX_PHOTO_BYTES) {
      setError(isAr ? "الصورة أكبر من 5 ميجابايت" : "Photo exceeds the 5 MB limit")
      return
    }
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { data: drow } = await supabase.from("drivers").select("tenant_id").eq("id", driverId).maybeSingle()
    const tenantId = (drow as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) {
      setError(isAr ? "تعذر تحديد المستأجر" : "Could not resolve tenant")
      setBusy(false)
      return
    }

    const ext = (f.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
    const path = `${tenantId}/${driverId}/photo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from("driver-photos")
      .upload(path, f, { contentType: f.type || undefined })
    if (uploadError) {
      setError(uploadError.message)
      setBusy(false)
      return
    }

    const res = await updateDriverPhoto({ driverId, filePath: path })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    await refreshAll()
  }

  const statusLbl = card ? cardStatusLabels[card.status] : undefined

  return (
    <div className="mt-5 border-t border-border/40 pt-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CreditCard className="h-4 w-4 text-elite-blue-500" />
        {isAr ? "بطاقة السائق" : "Driver card"}
      </h4>

      {/* Photo lives on the driver profile and feeds the printed card. */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-muted">
          {person?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic signed URL
            <img src={person.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <User className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{person?.name ?? ""}</p>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={busy}
            className="text-[11px] font-semibold text-elite-blue-500 hover:underline disabled:opacity-50"
          >
            {person?.photoUrl
              ? isAr ? "تغيير الصورة" : "Change photo"
              : isAr ? "رفع الصورة" : "Upload photo"}
          </button>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPhotoSelected(e)}
        />
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : (
        <>
          {card ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground" dir="ltr">
                  {card.card_serial}
                </span>
                {statusLbl && (
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", cardStatusCls[card.status])}>
                    {isAr ? statusLbl.ar : statusLbl.en}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {isAr ? "إعادة طباعة" : "reprints"}: {card.reprint_count}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {isAr ? "أصدرت" : "Issued"} {new Date(card.issued_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                {card.expires_at && (
                  <>
                    {" · "}
                    {isAr ? "تنتهي" : "expires"} {new Date(card.expires_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                  </>
                )}
              </p>

              {card.status === "active" && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} disabled={busy}>
                    <Eye className="h-3.5 w-3.5" />
                    {isAr ? "معاينة البطاقة" : "Preview card"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setRevokeOpen(true); setError(null) }} disabled={busy} className="text-red-600 dark:text-red-400">
                    {isAr ? "إلغاء البطاقة" : "Revoke card"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {isAr ? "لم تصدر بطاقة بعد." : "No card issued yet."}
            </p>
          )}

          {(!card || card.status !== "active") && (
            <Button size="sm" onClick={onIssue} disabled={busy} className="mt-3">
              {busy ? (isAr ? "جارٍ الإصدار…" : "Issuing…") : isAr ? "إصدار بطاقة" : "Issue card"}
            </Button>
          )}

          {prints.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {isAr ? "سجل الطباعة" : "Print history"}
              </p>
              <ul className="mt-1 space-y-1 text-[11px] tabular-nums text-muted-foreground">
                {prints.map((p) => (
                  <li key={p.id}>
                    {p.format.toUpperCase()} — {new Date(p.printed_at).toLocaleString(isAr ? "ar-SA" : "en-GB")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isAr ? "معاينة بطاقة السائق" : "Driver card preview"}</DialogTitle>
          </DialogHeader>
          {card && <DriverCardPreview card={card} person={person} />}
          <DialogFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <Select value={format} onValueChange={(v) => setFormat(v as "pvc" | "a4" | "screen")}>
                <SelectTrigger className="h-9 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pvc">PVC</SelectItem>
                  <SelectItem value="a4">A4</SelectItem>
                  <SelectItem value="screen">{isAr ? "شاشة" : "Screen"}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => void onPrintCard()} disabled={busy}>
                <Printer className="h-3.5 w-3.5" />
                {busy ? (isAr ? "جارٍ التجهيز…" : "Preparing…") : isAr ? "طباعة" : "Print"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? "إلغاء بطاقة السائق" : "Revoke driver card"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {isAr ? `البطاقة: ${card?.card_serial ?? ""}` : `Card: ${card?.card_serial ?? ""}`}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="revoke-reason">{isAr ? "سبب الإلغاء (إلزامي)" : "Revoke reason (required)"}</Label>
              <Textarea
                id="revoke-reason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={isAr ? "مثال: فقدت البطاقة" : "e.g. Card lost"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeOpen(false)} disabled={busy}>
              {isAr ? "تراجع" : "Cancel"}
            </Button>
            <Button onClick={() => void onRevoke()} disabled={busy || revokeReason.trim().length < 5} variant="destructive">
              {busy ? (isAr ? "جارٍ الإلغاء…" : "Revoking…") : isAr ? "إلغاء البطاقة" : "Revoke card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
