"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { issueDriverCard, recordCardPrint, revokeDriverCard } from "@/app/actions/drivers/driver-cards"
import type { DriverCard, DriverCardPrint } from "@/lib/drivers/cards"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CreditCard, Printer } from "lucide-react"

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

export function DriverCardPanel({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [card, setCard] = useState<DriverCard | null>(null)
  const [prints, setPrints] = useState<DriverCardPrint[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState("")
  const [format, setFormat] = useState<"pvc" | "a4" | "screen">("pvc")

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

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const c = await fetchCard()
      const p = await fetchPrints(c?.id ?? null)
      if (cancelled) return
      setCard(c)
      setPrints(p)
      setLoading(false)
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [fetchCard, fetchPrints])

  const refreshAll = async () => {
    const c = await fetchCard()
    const p = await fetchPrints(c?.id ?? null)
    setCard(c)
    setPrints(p)
  }

  const onIssue = async () => {
    setBusy(true)
    setError(null)
    const res = await issueDriverCard({ driverId })
    if (!res.ok) setError(res.error)
    setBusy(false)
    await refreshAll()
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

  const onPrint = async () => {
    if (!card) return
    setBusy(true)
    setError(null)
    const res = await recordCardPrint({ cardId: card.id, format })
    if (!res.ok) setError(res.error)
    setBusy(false)
    await refreshAll()
  }

  const statusLbl = card ? cardStatusLabels[card.status] : undefined

  return (
    <div className="mt-5 border-t border-border/40 pt-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CreditCard className="h-4 w-4 text-elite-blue-500" />
        {isAr ? "بطاقة السائق" : "Driver card"}
      </h4>

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
                  <Select value={format} onValueChange={(v) => setFormat(v as "pvc" | "a4" | "screen")}>
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pvc">PVC</SelectItem>
                      <SelectItem value="a4">A4</SelectItem>
                      <SelectItem value="screen">{isAr ? "شاشة" : "Screen"}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={onPrint} disabled={busy}>
                    <Printer className="h-3.5 w-3.5" />
                    {isAr ? "تسجيل طباعة" : "Record print"}
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
