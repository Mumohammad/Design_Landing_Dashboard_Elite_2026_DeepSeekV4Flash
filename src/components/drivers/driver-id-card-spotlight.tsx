"use client"

import { useEffect, useMemo, useState } from "react"
import { Camera, CheckCircle2, CircleDashed, IdCard, Printer, RotateCw, Settings2 } from "lucide-react"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDriverPhoto } from "@/components/drivers/photo-provider"
import { PlatformDot } from "@/components/drivers/platform-ids-editor"
import { RiderCardFace } from "@/components/drivers/driver-card-preview"
import { cardPersonFromDriver, printRiderCards } from "@/components/drivers/driver-platform-accounts-panel"
import { buildRiderCardsPrintHtml } from "@/lib/drivers/card-print"
import { COMPANY_CARD_THEME, platformLabel, platformTheme } from "@/lib/drivers/platforms"
import { fetchDriverPlatformAccounts, sortAccounts, type DriverPlatformAccount } from "@/lib/drivers/platform-accounts"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import type { Driver } from "@/types/drivers"

const COMPANY = "__company__"

/**
 * Always-visible driver ID card on the profile overview. Shows the primary
 * platform's branded card, or the EliteDev staff card when no platform
 * account exists yet, so a card is never "missing".
 */
export function DriverIdCardSpotlight({ driver, isAr, onUploadPhoto, onManage }: { driver: Driver; isAr: boolean; onUploadPhoto: () => void; onManage: () => void }) {
  const { photoUrl } = useDriverPhoto()
  const [accounts, setAccounts] = useState<DriverPlatformAccount[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [side, setSide] = useState<"front" | "back">("front")
  const [revision, setRevision] = useState(0)

  useEffect(() => subscribeDriverChanged((d) => {
    if ((!d.driverId || d.driverId === driver.id) && (d.action === "platforms" || d.action === "photo" || d.action === "profile")) setRevision((n) => n + 1)
  }), [driver.id])

  useEffect(() => {
    let cancelled = false
    fetchDriverPlatformAccounts(driver.id)
      .then((rows) => { if (!cancelled) setAccounts(sortAccounts(rows).filter((a) => a.status === "active")) })
      .catch(() => { if (!cancelled) setAccounts([]) })
    return () => { cancelled = true }
  }, [driver.id, revision])

  const person = useMemo(() => cardPersonFromDriver(driver, photoUrl), [driver, photoUrl])
  const current = accounts?.find((a) => a.platform_code === selected) ?? (selected === COMPANY ? undefined : accounts?.[0])
  const theme = current ? platformTheme(current.platform_code) : COMPANY_CARD_THEME
  const riderId = current?.platform_driver_id ?? driver.driver_code ?? driver.rider_id ?? "—"
  const checks = [
    { ok: !!photoUrl, label: isAr ? "صورة السائق" : "Driver photo" },
    { ok: !!(driver.full_name_en || driver.full_name_ar), label: isAr ? "الاسم" : "Name" },
    { ok: !!(driver.primary_mobile || driver.secondary_mobile), label: isAr ? "رقم الجوال" : "Mobile" },
    { ok: !!driver.iqama_number, label: isAr ? "رقم الهوية/الإقامة" : "ID / Iqama number" },
    { ok: !!current, label: isAr ? "رقم مندوب في منصة" : "Platform rider ID" },
  ]
  const ready = checks.filter((c) => c.ok).length

  const print = async () => {
    const html = buildRiderCardsPrintHtml([{ theme, riderId, footerRef: driver.driver_code ?? null, title: `${current ? platformLabel(current.platform_code, false) : "EliteDev"} card ${riderId}` }], person, "pvc")
    if (!(await printRiderCards(html))) toast.error(isAr ? "اسمح بالنوافذ المنبثقة ثم أعد المحاولة." : "Allow popups and try again.")
  }

  return (
    <section data-testid="driver-id-card-spotlight" aria-label={isAr ? "بطاقة هوية السائق" : "Driver ID card"}
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${theme.band}22, transparent 60%), radial-gradient(90% 70% at 100% 100%, ${theme.frame}18, transparent 60%)` }} />
      <div className="relative grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          {accounts === null ? <Skeleton className="h-[333px] w-[210px] rounded-2xl" /> : (
            <button type="button" onClick={() => setSide((s) => (s === "front" ? "back" : "front"))} title={isAr ? "اقلب البطاقة" : "Flip card"}
              className="rounded-[18px] shadow-[0_18px_40px_-18px_rgba(15,30,51,0.55)] transition-transform duration-300 hover:-translate-y-1 hover:rotate-[-1deg] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RiderCardFace side={side} theme={theme} riderId={riderId} footerRef={driver.driver_code ?? null} person={person} scale={0.7} />
            </button>
          )}
          <button type="button" onClick={() => setSide((s) => (s === "front" ? "back" : "front"))} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <RotateCw className="size-3" />{side === "front" ? (isAr ? "عرض الخلف" : "Show back") : (isAr ? "عرض الأمام" : "Show front")}
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold"><IdCard className="size-4 text-elite-blue-500" />{isAr ? "بطاقة هوية السائق" : "Driver ID card"}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {current
                ? (isAr ? `بهوية ${platformLabel(current.platform_code, true)} — تتحدث تلقائيًا مع بيانات السائق.` : `${platformLabel(current.platform_code, false)} branding — updates automatically with the driver's data.`)
                : (isAr ? "بطاقة EliteDev الافتراضية. أضف رقم مندوب لإصدار بطاقة المنصة." : "Default EliteDev card. Add a platform rider ID to get the platform-branded card.")}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={isAr ? "تصميم البطاقة" : "Card design"}>
            {(accounts ?? []).map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={current?.id === a.id} onClick={() => setSelected(a.platform_code)}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", current?.id === a.id ? "border-elite-blue-500 bg-elite-blue-500/10 font-semibold" : "border-border/60 bg-background hover:bg-muted")}>
                <PlatformDot code={a.platform_code} />{platformLabel(a.platform_code, isAr)}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={!current} onClick={() => setSelected(COMPANY)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", !current ? "border-elite-blue-500 bg-elite-blue-500/10 font-semibold" : "border-border/60 bg-background hover:bg-muted")}>
              <span className="size-2.5 rounded-full bg-elite-blue-500" />EliteDev
            </button>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/70 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold">{isAr ? "جاهزية البطاقة" : "Card readiness"}</span>
              <span className={cn("font-semibold tabular-nums", ready === checks.length ? "text-emerald-600" : "text-amber-600")}>{ready}/{checks.length}</span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-all", ready === checks.length ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${(ready / checks.length) * 100}%` }} /></div>
            <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
              {checks.map((c) => (
                <li key={c.label} className={cn("flex items-center gap-1.5", c.ok ? "text-foreground" : "text-muted-foreground")}>
                  {c.ok ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <CircleDashed className="size-3.5 text-amber-500" />}{c.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => void print()} data-testid="spotlight-print-card"><Printer className="size-3.5" />{isAr ? "طباعة البطاقة" : "Print card"}</Button>
            {!photoUrl && <Button size="sm" variant="outline" className="gap-1.5" onClick={onUploadPhoto}><Camera className="size-3.5" />{isAr ? "رفع صورة" : "Upload photo"}</Button>}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onManage}><Settings2 className="size-3.5" />{isAr ? "المنصات وكل البطاقات" : "Platforms & all cards"}</Button>
          </div>
        </div>
      </div>
    </section>
  )
}
