"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, ArrowUpRight, Bike, CalendarCheck, Car, ClipboardList, Package, Receipt, Wallet, Wrench } from "lucide-react"
import type { Driver } from "@/types/drivers"

type ModuleLink = { href: string; icon: LucideIcon; en: string; ar: string; hintEn: string; hintAr: string; tone: string }

/** Deep links into every module, pre-filtered to this driver via `?q=`. */
export function DriverConnectedModules({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const q = encodeURIComponent(driver.driver_code || driver.full_name_ar)
  const name = encodeURIComponent(driver.full_name_ar)
  const links: ModuleLink[] = [
    { href: `/orders?q=${q}`, icon: Package, en: "Orders", ar: "الطلبات", hintEn: "Daily delivered orders", hintAr: "الطلبات اليومية", tone: "text-emerald-600 bg-emerald-500/10" },
    { href: `/attendance?q=${q}`, icon: CalendarCheck, en: "Attendance", ar: "الحضور", hintEn: "Check-ins & absences", hintAr: "الحضور والغياب", tone: "text-sky-600 bg-sky-500/10" },
    { href: `/payroll`, icon: Wallet, en: "Payroll", ar: "الرواتب", hintEn: "Runs & payslips", hintAr: "المسيرات والقسائم", tone: "text-elite-blue-600 bg-elite-blue-500/10" },
    { href: `/violations?q=${q}`, icon: AlertTriangle, en: "Violations", ar: "المخالفات", hintEn: "Fines & deductions", hintAr: "الغرامات والخصومات", tone: "text-red-600 bg-red-500/10" },
    { href: `/expenses?q=${q}`, icon: Receipt, en: "Expenses", ar: "المصروفات", hintEn: "Fuel, repairs, advances", hintAr: "وقود وإصلاحات", tone: "text-amber-600 bg-amber-500/10" },
    { href: `/vehicles`, icon: Car, en: "Vehicles", ar: "المركبات", hintEn: "Fleet & assignments", hintAr: "الأسطول والتسليم", tone: "text-slate-600 bg-slate-500/10" },
    { href: `/maintenance?q=${name}`, icon: Wrench, en: "Maintenance", ar: "الصيانة", hintEn: "Repairs on driver vehicles", hintAr: "صيانة مركبات السائق", tone: "text-orange-600 bg-orange-500/10" },
    { href: `/platforms`, icon: Bike, en: "Platforms", ar: "المنصات", hintEn: "HungerStation, Keeta, Jahez…", hintAr: "هنقرستيشن، كيتا، جاهز…", tone: "text-violet-600 bg-violet-500/10" },
    { href: `/hr?q=${q}`, icon: ClipboardList, en: "HR & performance", ar: "الموارد البشرية", hintEn: "Scores & reviews", hintAr: "التقييم والأداء", tone: "text-teal-600 bg-teal-500/10" },
  ]
  return (
    <section aria-label={isAr ? "الوحدات المرتبطة" : "Connected modules"} data-testid="driver-connected-modules" className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{isAr ? "مرتبط بكل الوحدات" : "Connected modules"}</h3>
        <p className="text-[11px] text-muted-foreground">{isAr ? "تفتح الوحدة مُصفّاة على هذا السائق" : "Opens each module filtered to this driver"}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-9">
        {links.map((l) => (
          <Link key={l.en} href={l.href} prefetch={false}
            className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-border/50 bg-background p-2.5 transition-all hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex-col xl:items-start">
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${l.tone}`}><l.icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 truncate text-xs font-semibold">{isAr ? l.ar : l.en}<ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-60 rtl:-scale-x-100" /></span>
              <span className="block truncate text-[10.5px] text-muted-foreground">{isAr ? l.hintAr : l.hintEn}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
