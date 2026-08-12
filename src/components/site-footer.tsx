"use client"

import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"

export function SiteFooter() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="bg-gradient-to-r from-[#0F3A66] to-[#1E5A99] text-white/90">
      <div className="px-6 py-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {/* Column 1: Company */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                {t.footer.company}
              </h3>
              <div className="space-y-1 text-xs text-white/70">
                <p className="font-medium text-white">{t.landing.footerCompany}</p>
                <p>{t.landing.footerAddress}</p>
                <p>{t.footer.timezone}</p>
              </div>
            </div>

            {/* Column 2: Contact */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                {t.footer.contact}
              </h3>
              <ul className="space-y-1 text-xs">
                <li>
                  <Link
                    href="/about"
                    className="text-elite-orange-500 hover:text-elite-orange-400 hover:underline transition-colors"
                  >
                    {t.footer.aboutUs}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/careers"
                    className="text-elite-orange-500 hover:text-elite-orange-400 hover:underline transition-colors"
                  >
                    {t.footer.careers}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/help"
                    className="text-elite-orange-500 hover:text-elite-orange-400 hover:underline transition-colors"
                  >
                    {t.footer.helpSupport}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Legal */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                {t.footer.legal}
              </h3>
              <ul className="space-y-1 text-xs">
                <li>
                  <Link
                    href="/privacy"
                    className="text-elite-orange-500 hover:text-elite-orange-400 hover:underline transition-colors"
                  >
                    {t.footer.privacyPolicy}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="text-elite-orange-500 hover:text-elite-orange-400 hover:underline transition-colors"
                  >
                    {t.footer.termsOfService}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Copyright bar */}
          <div className="mt-8 border-t border-white/10 pt-4">
            <p className="text-center text-xs text-white/50">
              {t.footer.copyright.replace("{year}", String(year))}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
