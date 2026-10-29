"use client"

// Platform create/edit + payment-record dialogs (Prompt O Part 2).

import { useUiText } from "@/components/localized-text"
import { useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { upsertPlatform, recordPlatformPayment } from "@/lib/platforms-module/actions"
import { Loader2 } from "lucide-react"

export interface PlatformRow {
  id: string
  updated_at: string
  code: string
  name_ar: string
  name_en: string | null
  brand_color: string | null
  is_active: boolean
  rate_type: string
  rate_per_order: number | null
  api_base_url: string | null
  sort_order: number
}

const RATE_TYPES = ["flat", "distance_based", "tiered", "custom"] as const

export function PlatformDialog({
  open,
  platform,
  onClose,
  onDone,
}: {
  open: boolean
  platform: PlatformRow | null
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const pm = t.platformsModule
  const editing = platform != null

  const [code, setCode] = useState(platform?.code ?? "")
  const [nameAr, setNameAr] = useState(platform?.name_ar ?? "")
  const [nameEn, setNameEn] = useState(platform?.name_en ?? "")
  const [color, setColor] = useState(platform?.brand_color ?? "#1E5A99")
  const [rateType, setRateType] = useState<(typeof RATE_TYPES)[number]>(
    (platform?.rate_type as (typeof RATE_TYPES)[number]) ?? "flat"
  )
  const [rate, setRate] = useState(platform?.rate_per_order != null ? String(platform.rate_per_order) : "")
  const [apiUrl, setApiUrl] = useState(platform?.api_base_url ?? "")
  const [sortOrder, setSortOrder] = useState(String(platform?.sort_order ?? 100))
  const [isActive, setIsActive] = useState(platform?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  // NOTE: the parent conditionally mounts this dialog with a per-session
  // `key`, so initial state derives straight from props — no reset effect
  // (the setState-in-effect lint rule / cascading-render hazard).

  async function submit() {
    if (!code.trim()) return onDone(pm.errCodeRequired)
    if (!nameAr.trim()) return onDone(pm.errNameRequired)
    setBusy(true)
    const payload = {
      ...(editing ? { id: platform.id, expected_updated_at:platform.updated_at } : {}),
      code,
      name_ar: nameAr,
      name_en: nameEn || null,
      brand_color: color || null,
      rate_type: rateType,
      rate_per_order: rate ? Number(rate) : null,
      api_base_url: apiUrl || "",
      sort_order: sortOrder.trim() ? Number(sortOrder) : 100,
      is_active: editing ? isActive : true,
    }
    const res = await upsertPlatform(payload)
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? pm.editPlatform : pm.addPlatform}</DialogTitle>
          <DialogDescription>{editing ? pm.editPlatformDesc : pm.addPlatformDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{pm.fieldCode} *</Label>
              <Input aria-label={pm.fieldCode} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} disabled={editing} />
            </div>
            <div className="grid gap-1.5">
              <Label>{pm.fieldBrandColor}</Label>
              <Input aria-label={pm.fieldBrandColor} dir="ltr" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 p-1" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{pm.fieldNameAr} *</Label>
            <Input aria-label={pm.fieldNameAr} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{pm.fieldNameEn}</Label>
            <Input aria-label={pm.fieldNameEn} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{pm.fieldRateType}</Label>
              <select aria-label={pm.fieldRateType} value={rateType} onChange={(e) => setRateType(e.target.value as (typeof RATE_TYPES)[number])} className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm">
                {RATE_TYPES.map((rt) => (
                  <option key={rt} value={rt}>{rt}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{pm.fieldRatePerOrder}</Label>
              <Input aria-label={pm.fieldRatePerOrder} dir="ltr" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{pm.fieldApiBaseUrl}</Label>
              <Input aria-label={pm.fieldApiBaseUrl} dir="ltr" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://" />
            </div>
            <div className="grid gap-1.5">
              <Label>{pm.fieldSortOrder}</Label>
              <Input aria-label={pm.fieldSortOrder} dir="ltr" type="number" min="0" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
        </div>
        {editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={event=>setIsActive(event.target.checked)} />{t.common.active}</label>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PaymentDialog({
  open,
  platformId,
  platformName,
  defaultYear,
  defaultMonth,
  onClose,
  onDone,
  payment,
}: {
  open: boolean
  payment?: {period_year:number;period_month:number;expected_amount:number;received_amount:number;payment_date:string|null;payment_ref:string|null;updated_at:string;notes?:string|null;payment_status?:string} | null
  platformId: string | null
  platformName: string
  defaultYear: number
  defaultMonth: number
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const ui = useUiText()
  const { t,locale } = useTranslation()
  const pm = t.platformsModule
  const [year, setYear] = useState(payment?.period_year ?? defaultYear)
  const [month, setMonth] = useState(payment?.period_month ?? defaultMonth)
  const [expected, setExpected] = useState(payment ? String(payment.expected_amount) : "")
  const [received, setReceived] = useState(payment ? String(payment.received_amount) : "")
  const [paymentDate, setPaymentDate] = useState(payment?.payment_date ?? "")
  const [paymentRef, setPaymentRef] = useState(payment?.payment_ref ?? "")
  const [notes,setNotes]=useState(payment?.notes??"")
  const [paymentState,setPaymentState]=useState<"automatic"|"overdue"|"disputed">(payment?.payment_status==="overdue" || payment?.payment_status==="disputed"?payment.payment_status:"automatic")
  const [busy, setBusy] = useState(false)
  // Session-initialized state — the parent remounts with a fresh key per open.

  async function submit() {
    if (!platformId) return
    const exp = Number(expected)
    const rec = Number(received || 0)
    if (Number.isNaN(exp) || exp < 0 || Number.isNaN(rec) || rec < 0) return onDone(pm.errAmountInvalid)
    setBusy(true)
    const res = await recordPlatformPayment({
      platform_id: platformId,
      expected_updated_at:payment?.updated_at,
      period_year: year,
      period_month: month,
      expected_amount: exp,
      received_amount: rec,
      payment_date: paymentDate || null,
      payment_ref: paymentRef || null,
      notes:notes||null,
      payment_status:paymentState==="automatic"?undefined:paymentState,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pm.recordPayment}</DialogTitle>
          <DialogDescription>{platformName} — {pm.recordPaymentDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{pm.fieldPeriod}</Label>
              <div className="flex gap-1.5">
                <select disabled={!!payment} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 w-full rounded-xl border border-border/50 bg-muted/30 px-2 text-sm" aria-label={ui("month")}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
                    <option key={mo} value={mo}>{mo}</option>
                  ))}
                </select>
                <select disabled={!!payment} value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 w-full rounded-xl border border-border/50 bg-muted/30 px-2 text-sm" aria-label={ui("year")}>
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{pm.fieldPaymentDate}</Label>
              <Input aria-label={pm.fieldPaymentDate} dir="ltr" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{pm.fieldExpected}</Label>
              <Input aria-label={pm.fieldExpected} dir="ltr" type="number" min="0" step="0.01" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{pm.fieldReceived}</Label>
              <Input aria-label={pm.fieldReceived} dir="ltr" type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{pm.fieldPaymentRef}</Label>
            <Input aria-label={pm.fieldPaymentRef} dir="ltr" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2"><Label htmlFor="platform-payment-notes">{locale==="ar"?"ملاحظات التسوية":"Reconciliation notes"}</Label><Input id="platform-payment-notes" value={notes} onChange={event=>setNotes(event.target.value)} maxLength={1000}/><Label htmlFor="platform-payment-state">{t.common.status}</Label><select id="platform-payment-state" value={paymentState} onChange={event=>setPaymentState(event.target.value as typeof paymentState)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="automatic">{locale==="ar"?"تلقائي حسب المبالغ":"Automatic from amounts"}</option><option value="overdue">{locale==="ar"?"متأخر":"Overdue"}</option><option value="disputed">{locale==="ar"?"متنازع عليه":"Disputed"}</option></select></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
