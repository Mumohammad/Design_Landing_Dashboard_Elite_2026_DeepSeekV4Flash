"use client"

import { useEffect, useMemo, useState } from "react"
import { Camera, CheckCircle2, CircleDashed, IdCard, Printer, Settings2 } from "lucide-react"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDriverPhoto } from "@/components/drivers/photo-provider"
import { PlatformDot } from "@/components/drivers/platform-ids-editor"
import { RiderCardFace } from "@/components/drivers/driver-card-preview"
import { cardPersonFromDriver, printRiderCards } from "@/components/drivers/driver-platform-accounts-panel"
import { buildRiderCardsPrintHtml } from "@/lib/drivers/card-print"
import { DEFAULT_CARD_THEME, platformLabel, platformTheme } from "@/lib/drivers/platforms"
import { fetchDriverPlatformAccounts, sortAccounts, type DriverPlatformAccount } from "@/lib/drivers/platform-accounts"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import type { Driver } from "@/types/drivers"


/**
 * Always-visible driver ID card on the profile overview. Shows the primary
 * platform's branded card, or the HungerStation-design card when no platform
 * account exists yet, so a card is never "missing".
 */
export function DriverIdCardSpotlight({ driver, isAr, onUploadPhoto, onManage }: { driver: Driver; isAr: boolean; onUploadPhoto: () => void; onManage: () => void }) {
  const { photoUrl } = useDriverPhoto()
  const [accounts, setAccounts] = useState<DriverPlatformAccount[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
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
  const current = accounts?.find((a) => a.platform_code === selected) ?? accounts?.[0]
  const theme = current ? platformTheme(current.platform_code) : DEFAULT_CARD_THEME
  const riderId = current?.platform_driver_id ?? driver.rider_id ?? driver.driver_code ?? "—"
  const checks = [
    { ok: !!photoUrl, label: isAr ? "صورة السائق" : "Driver photo" },
    { ok: !!(driver.full_name_en || driver.full_name_ar), label: isAr ? "الاسم" : "Name" },
    { ok: !!(driver.primary_mobile || driver.secondary_mobile), label: isAr ? "رقم الجوال" : "Mobile" },
    { ok: !!driver.iqama_number, label: isAr ? "رقم الهوية/الإقامة" : "ID / Iqama number" },
    { ok: !!current, label: isAr ? "رقم مندوب في منصة" : "Platform rider ID" },
  ]
  const ready = checks.filter((c) => c.ok).length

  const print = async () => {
    const html = buildRiderCardsPrintHtml([{ theme, riderId, footerRef: driver.driver_code ?? null, title: `${current ? platformLabel(current.platform_code, false) : "Rider"} card ${riderId}` }], person, "pvc")
    if (!(await printRiderCards(html))) toast.error(isAr ? "اسمح بالنوافذ المنبثقة ثم أعد المحاولة." : "Allow popups and try again.")
  }

  return (
    <section data-testid="driver-id-card-spotlight" aria-label={isAr ? "بطاقة هوية السائق" : "Driver ID card"}
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${theme.band}22, transparent 60%), radial-gradient(90% 70% at 100% 100%, ${theme.frame}18, transparent 60%)` }} />
      <div className="relative grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          {accounts === null ? <div className="flex gap-3"><Skeleton className="h-[286px] w-[180px] rounded-2xl" /><Skeleton className="h-[286px] w-[180px] rounded-2xl" /></div> : (
            <div className="flex gap-3" data-testid="spotlight-card-faces">
              {(["front", "back"] as const).map((face) => (
                <div key={face} className="rounded-[14px] shadow-[0_18px_40px_-18px_rgba(15,30,51,0.55)] transition-transform duration-300 hover:-translate-y-1">
                  <RiderCardFace side={face} theme={theme} riderId={riderId} footerRef={driver.driver_code ?? null} person={person} scale={0.6} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold"><IdCard className="size-4 text-elite-blue-500" />{isAr ? "بطاقة هوية السائق" : "Driver ID card"}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {current
                ? (isAr ? `بهوية ${platformLabel(current.platform_code, true)} — تتحدث تلقائيًا مع بيانات السائق.` : `${platformLabel(current.platform_code, false)} branding — updates automatically with the driver's data.`)
                : (isAr ? "تصميم هنقرستيشن. أضف رقم المندوب ليظهر على البطاقة." : "HungerStation design. Add the platform rider ID to show it on the card.")}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={isAr ? "تصميم البطاقة" : "Card design"}>
            {(accounts ?? []).map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={current?.id === a.id} onClick={() => setSelected(a.platform_code)}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", current?.id === a.id ? "border-elite-blue-500 bg-elite-blue-500/10 font-semibold" : "border-border/60 bg-background hover:bg-muted")}>
                <PlatformDot code={a.platform_code} />{platformLabel(a.platform_code, isAr)}
              </button>
            ))}
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
