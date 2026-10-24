"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useDriverPhoto } from "@/components/drivers/photo-provider"
import { issueDriverCard, recordCardPrint, revokeDriverCard } from "@/app/actions/drivers/driver-cards"
import type { DriverCard, DriverCardPerson, DriverCardPrint } from "@/lib/drivers/cards"
import { buildCardPrintHtml, DriverCardPreview } from "@/components/drivers/driver-card-preview"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import { useTablePage } from "@/hooks/use-table-page"
import { DriverHistoryToolbar } from "./driver-history-toolbar"
import { CreditCard, Eye, Printer } from "lucide-react"

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

type PersonSnapshot=DriverCardPerson&{profileVersion:number}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

export function DriverCardPanel({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  return <DriverCardPanelContent key={driverId} driverId={driverId} isAr={isAr} />
}

function DriverCardPanelContent({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [card, setCard] = useState<DriverCard | null>(null)
  const [person, setPerson] = useState<PersonSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [readFailed,setReadFailed]=useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const [format, setFormat] = useState<"pvc" | "a4">("pvc")
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (card?.status !== "active" || !card.expires_at) return
    const expiresAt = Date.parse(card.expires_at)
    if (!Number.isFinite(expiresAt)) return
    const updateClock = () => setNow(Date.now())
    const interval = window.setInterval(updateClock, 60_000)
    const expiryTimer = window.setTimeout(updateClock, Math.max(0, Math.min(2_147_483_647, expiresAt - Date.now())))
    window.addEventListener("focus", updateClock)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(expiryTimer)
      window.removeEventListener("focus", updateClock)
    }
  }, [card?.status, card?.expires_at])

  // Pure queries: no setState here (react-hooks set-state-in-effect rule).
  const fetchCard = useCallback(async (): Promise<DriverCard | null> => {
    const supabase = createClient()
    const { data,error:readError } = await supabase
      .from("driver_cards")
      .select("id, workflow_version, driver_id, card_serial, status, issued_at, expires_at, reprint_count")
      .eq("driver_id", driverId)
      .is("deleted_at", null)
      .order("issued_at", { ascending: false })
      .limit(1)
    if(readError)throw Error("Card read failed")
    return (data?.[0] as DriverCard | undefined) ?? null
  }, [driverId])

  const printQuery=useCallback((search:string)=>{
    let query=createClient().from("driver_card_prints").select("id,card_id,format,printed_at,batch_ref",{count:"exact"}).eq("card_id",card?.id??"").order("printed_at",{ascending:false}).order("id",{ascending:false})
    if(search)query=query.ilike("format","%"+search.replace(/[\\%_]/g,value=>"\\"+value)+"%")
    return query
  },[card?.id])
  const printHistory=useTablePage<DriverCardPrint>(card?.id?printQuery:null)

  // Card fields (name / mobile / id number) with tolerant fallbacks:
  // driver column naming varies, so read the row and pick what exists.
  // The photo is NOT signed here — useDriverPhoto (layout provider) owns
  // signing so the card always shows the latest uploaded photo.
  const fetchPerson = useCallback(async (): Promise<PersonSnapshot | null> => {
    const supabase = createClient()
    const { data,error:readError } = await supabase.from("drivers").select("*").eq("id", driverId).maybeSingle()
    if (readError||!data||!Number.isSafeInteger(data.profile_version)||data.profile_version<1)throw Error("Card person read failed")
    const row = data as Record<string, unknown>

    return {
      name: str(row.full_name_en) ?? str(row.full_name) ?? str(row.name) ?? str(row.full_name_ar) ?? "—",
      phone: str(row.phone) ?? str(row.mobile) ?? str(row.primary_mobile) ?? str(row.secondary_mobile) ?? str(row.mobile_number),
      idNumber: str(row.identity_number) ?? str(row.national_id) ?? str(row.id_number) ?? str(row.iqama_number),
      photoUrl: null,
      profileVersion:data.profile_version,
    }
  }, [driverId])

  // Shared signed photo from the layout-level DriverPhotoProvider (this panel
  // renders inside the provider tree on the driver detail page). The provider
  // re-reads drivers.photo_url and re-signs on every photo change event, so
  // the card always shows the latest persisted photo without a reload.
  const { photoUrl: sharedPhotoUrl } = useDriverPhoto()

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try{const [c,p]=await Promise.all([fetchCard(),fetchPerson()]);if(cancelled)return;setCard(c);setPerson(p);setReadFailed(false)}catch{if(!cancelled)setReadFailed(true)}finally{if(!cancelled)setLoading(false)}
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [fetchCard, fetchPerson])


  const refreshAll = async () => {
    try{const [c,p]=await Promise.all([fetchCard(),fetchPerson()]);setCard(c);setPerson(p);setReadFailed(false);printHistory.reload();return c}catch{setReadFailed(true);return null}
  }

  // Always re-fetch before previewing so the card reflects the latest photo
  // uploaded from the profile header (or any other surface) without a reload.
  const onPreview = async () => {
    setBusy(true)
    setError(null)
    try {
      const [c, p] = await Promise.all([fetchCard(), fetchPerson()])
      setCard(c)
      setPerson(p)
      if(c?.status==="active"&&(!c.expires_at||new Date(c.expires_at).getTime()>Date.now()))setPreviewOpen(true);else setError(isAr?"البطاقة غير سارية.":"The card is not current.")
    } catch {setReadFailed(true)} finally {
      setBusy(false)
    }
  }

  const onIssue = async () => {
    if(busy||!person)return
    setBusy(true);setError(null)
    try{const res=await issueDriverCard({driverId,expectedDriverVersion:person.profileVersion})
      if(!res.ok){setError(isAr?res.errorAr:res.error);return}
      await refreshAll();emitDriverChanged({driverId,action:"document"})
    }catch{setError(isAr?"تعذر تأكيد إصدار البطاقة. أعد التحميل قبل المحاولة مجدداً.":"Card issuance could not be confirmed. Reload before retrying.")}finally{setBusy(false)}
  }

  const onRevoke = async () => {
    if(busy||!card||!person)return
    setBusy(true);setError(null)
    try{const res=await revokeDriverCard({driverId,expectedDriverVersion:person.profileVersion,cardId:card.id,expectedVersion:card.workflow_version,reason:revokeReason})
      if(!res.ok){setError(isAr?res.errorAr:res.error);return}
      setRevokeOpen(false);setRevokeReason("");await refreshAll();emitDriverChanged({driverId,action:"document"})
    }catch{setError(isAr?"تعذر تأكيد إلغاء البطاقة. أعد التحميل قبل المحاولة مجدداً.":"Card revocation could not be confirmed. Reload before retrying.")}finally{setBusy(false)}
  }

  const onPrintCard = async () => {
    if(busy||!card||!person)return
    const popup=window.open("","_blank","width=760,height=620")
    if(!popup){setError(isAr?"اسمح بالنوافذ المنبثقة ثم أعد طلب الطباعة.":"Allow popups and request the print again.");return}
    let saved=false
    setBusy(true);setError(null)
    try{
      const res=await recordCardPrint({driverId,expectedDriverVersion:person.profileVersion,cardId:card.id,expectedVersion:card.workflow_version,format})
      if(!res.ok){popup.close();setError(isAr?res.errorAr:res.error);return}
      saved=true
      popup.document.write(buildCardPrintHtml(card,{...person,photoUrl:sharedPhotoUrl},format));popup.document.close()
      let timeout:number|undefined
      try{await Promise.race([Promise.all([popup.document.fonts.ready,...Array.from(popup.document.images,image=>image.decode())]),new Promise<never>((_,reject)=>{timeout=window.setTimeout(()=>reject(Error("Print assets unavailable")),8000)})])}finally{if(timeout!==undefined)window.clearTimeout(timeout)}
      popup.focus();popup.print()
      await refreshAll();emitDriverChanged({driverId,action:"document"})
    }catch{
      popup.close()
      if(saved)await refreshAll()
      setError(saved?(isAr?"سُجل طلب الطباعة، لكن تعذر تجهيز المعاينة. أعد تحميل البطاقة قبل الطباعة.":"The print request was recorded, but the preview could not be prepared. Reload the card before printing."):(isAr?"تعذر تأكيد طلب الطباعة. أعد التحميل قبل المحاولة مجدداً.":"The print request could not be confirmed. Reload before retrying."))
    }finally{setBusy(false)}
  }

  const currentCard=card?.status==="active"&&(!card.expires_at||new Date(card.expires_at).getTime()>now)
  const effectiveStatus=card?.status==="active"&&!currentCard?"expired":card?.status
  const statusLbl = effectiveStatus ? cardStatusLabels[effectiveStatus] : undefined

  return (
    <div className="mt-5 border-t border-border/40 pt-4" data-testid="driver-card-panel">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CreditCard className="h-4 w-4 text-elite-blue-500" />
        {isAr ? "بطاقة السائق" : "Driver card"}
      </h4>

      {readFailed?<div role="alert" className="mt-3 space-y-2"><p className="text-sm text-destructive">{isAr?"تعذر تحميل البطاقة وبياناتها. أعد المحاولة.":"Could not load the card and its evidence. Try again."}</p><Button variant="outline" size="sm" onClick={()=>void refreshAll()}>{isAr?"أعد المحاولة":"Try again"}</Button></div>:loading ? (
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
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", cardStatusCls[effectiveStatus??card.status])}>
                    {isAr ? statusLbl.ar : statusLbl.en}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {isAr ? "طلبات الطباعة" : "print requests"}: {card.reprint_count}
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

              {currentCard && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => void onPreview()} disabled={busy}>
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

          {!currentCard && (
            <Button size="sm" onClick={onIssue} disabled={busy||!person} className="mt-3">
              {busy ? (isAr ? "جارٍ الإصدار…" : "Issuing…") : isAr ? "إصدار بطاقة" : "Issue card"}
            </Button>
          )}

          {card&&<div className="mt-3 space-y-2"><p className="text-xs font-semibold text-muted-foreground">{isAr?"سجل طلبات الطباعة":"Print request history"}</p><DriverHistoryToolbar search={printHistory.search} onSearchChange={printHistory.setSearch} pagination={printHistory.pagination} loading={printHistory.loading} error={printHistory.error} onRefresh={printHistory.reload} isAr={isAr}/>{printHistory.error?<p role="alert" className="text-sm text-destructive">{isAr?"تعذر تحميل سجل الطباعة. أعد المحاولة.":"Could not load print request history. Try again."}</p>:<ul className="space-y-1 text-xs tabular-nums text-muted-foreground">{printHistory.rows.map(p=><li key={p.id}>{p.format.toUpperCase()} — {new Date(p.printed_at).toLocaleString(isAr?"ar-SA":"en-GB")}</li>)}</ul>}</div>}
        </>
      )}

      {error&&!revokeOpen&&!previewOpen&&<p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}

      <Dialog open={previewOpen} onOpenChange={next=>{if(!busy)setPreviewOpen(next)}}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isAr ? "معاينة بطاقة السائق" : "Driver card preview"}</DialogTitle>
          </DialogHeader>
          {card && (
            <DriverCardPreview
              card={card}
              person={
                person
                  ? { ...person, photoUrl: sharedPhotoUrl }
                  : { name: "—", phone: null, idNumber: null, photoUrl: sharedPhotoUrl }
              }
            />
          )}
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <Select value={format} onValueChange={(v) => setFormat(v as "pvc" | "a4")} disabled={busy}>
                <SelectTrigger className="h-9 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pvc">PVC</SelectItem>
                  <SelectItem value="a4">A4</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => void onPrintCard()} disabled={busy||!currentCard||!person}>
                <Printer className="h-3.5 w-3.5" />
                {busy ? (isAr ? "جارٍ التجهيز…" : "Preparing…") : isAr ? "طباعة" : "Print"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeOpen} onOpenChange={next=>{if(!busy)setRevokeOpen(next)}}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
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
                disabled={busy}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={isAr ? "مثال: فقدت البطاقة" : "e.g. Card lost"}
              />
            </div>
          </div>
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
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
