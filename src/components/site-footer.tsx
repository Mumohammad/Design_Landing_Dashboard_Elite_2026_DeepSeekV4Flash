"use client"

import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"
import { Logo } from "@/components/logo"
import { Heart } from "lucide-react"

export function SiteFooter() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden bg-gradient-to-br from-[#0A1628] via-[#0F3A66] to-[#1E5A99] text-white/90">
      {/* Decorative gradient orbs */}
      <div className="absolute top-0 left-1/4 w-64 h-64 rounded-full bg-elite-blue-500/10 blur-[100px]" />
      <div className="absolute bottom-0 right-1/4 w-48 h-48 rounded-full bg-elite-orange-500/10 blur-[80px]" />

      <div className="relative px-6 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
            {/* Column 0: Brand */}
            <div className="space-y-4 md:col-span-1">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                  <Logo size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{t.app.companyNameArabic}</p>
                  <p className="text-[10px] text-white/40">{t.app.companyName}</p>
                </div>
              </div>
              <p className="text-xs text-white/50 leading-relaxed max-w-[220px]">
                {t.landing.footerCompany}
              </p>
            </div>

            {/* Column 1: Company */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
                {t.footer.company}
              </h3>
              <div className="space-y-2 text-xs text-white/50">
                <p>{t.landing.footerAddress}</p>
                <p>{t.footer.timezone}</p>
              </div>
            </div>

            {/* Column 2: Contact */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
                {t.footer.contact}
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link
                    href="/about"
                    className="text-white/60 hover:text-elite-orange-400 transition-colors duration-200"
                  >
                    {t.footer.aboutUs}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/careers"
                    className="text-white/60 hover:text-elite-orange-400 transition-colors duration-200"
                  >
                    {t.footer.careers}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/help"
                    className="text-white/60 hover:text-elite-orange-400 transition-colors duration-200"
                  >
                    {t.footer.helpSupport}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Legal */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
                {t.footer.legal}
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link
                    href="/privacy"
                    className="text-white/60 hover:text-elite-orange-400 transition-colors duration-200"
                  >
                    {t.footer.privacyPolicy}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="text-white/60 hover:text-elite-orange-400 transition-colors duration-200"
                  >
                    {t.footer.termsOfService}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Copyright bar */}
          <div className="mt-10 border-t border-white/10 pt-6">
            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-xs text-white/40">
                {t.footer.copyright.replace("{year}", String(year))}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-white/30">
                <span>Built with</span>
                <Heart className="h-3 w-3 text-elite-orange-500 fill-elite-orange-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
