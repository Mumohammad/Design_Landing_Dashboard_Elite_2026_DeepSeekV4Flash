'use client';

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, Moon } from 'lucide-react';
import { REDIRECTS, withLocale } from '@/lib/redirects';
import { useTranslation } from '@/hooks/use-translation';
import { LanguageToggle } from '@/components/language-toggle';
import { useCircularTransition } from '@/hooks/use-circular-transition';

const navItems = [
  { href: '#platform', label: 'المنصة' }, { href: '#driver360', label: 'ملف السائق' },
  { href: '#payroll', label: 'الرواتب' }, { href: '#fleet', label: 'الأسطول' },
  { href: '#operations', label: 'العمليات' }, { href: '#compliance', label: 'الامتثال' },
  { href: '#reports', label: 'التقارير' }, { href: '#pricing', label: 'الأسعار' }, { href: '#faq', label: 'الأسئلة' },
];

export function LandingHeader() {
  const ui = useUiText()
  const { locale } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { toggleTheme } = useCircularTransition()
  return (
    <header className="relative z-50 bg-elite-blue-950 text-white">
      <nav className="mx-auto flex min-h-20 max-w-7xl items-center gap-4 px-5 py-4 lg:px-8" aria-label={ui("Main navigation")}>
        <Link className="flex shrink-0 items-center gap-3" aria-label={ui("نخبة التطوير")} href="/landing">
          <Image alt="" width={36} height={36} className="object-cover" src="/logo.png" />
          <span className="hidden text-sm font-semibold sm:block">
            <LocalizedText text="نخبة التطوير" />
          </span>
        </Link>
        <div className="ms-auto hidden items-center gap-6 xl:flex">
          {[navItems[0], navItems[7], navItems[8]].map(item => <a key={item.href} href={item.href} className="py-2 text-sm underline-offset-4 hover:underline">{ui(item.label)}</a>)}
        </div>
        <div className="ms-auto flex items-center gap-1.5 xl:ms-4">
          <LanguageToggle />
          <button onClick={toggleTheme} className="flex size-10 items-center justify-center transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={ui("Toggle theme")}>
            <Moon className="h-4 w-4" aria-hidden="true" />
          </button>
          <Link className="hidden px-3 py-3 text-sm underline-offset-4 hover:underline md:inline-flex" href={withLocale(REDIRECTS.signInUrl, locale)}>
            <LocalizedText text="تسجيل الدخول" />
          </Link>
          <Link className="hidden min-h-10 items-center bg-white px-4 text-sm font-semibold text-elite-blue-950 transition-transform hover:-translate-y-0.5 sm:inline-flex" href={withLocale(REDIRECTS.registerUrl, locale)}>
            <LocalizedText text="ابدأ الآن" />
          </Link>
          <button onClick={() => setMenuOpen(open => !open)} className="ms-1 inline-flex min-h-10 items-center gap-2 px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={ui("Menu")} aria-expanded={menuOpen} aria-controls="landing-mobile-menu">{menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}<span className="hidden sm:inline">{ui("Menu")}</span>
          </button>
        </div>
      </nav>
      <div id="landing-mobile-menu" hidden={!menuOpen} inert={!menuOpen} className="bg-elite-blue-900">
        <div className="mx-auto grid max-w-7xl gap-x-8 gap-y-1 px-5 py-6 sm:grid-cols-2 lg:grid-cols-3 lg:px-8">
          {navItems.map(item => <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="py-3 text-base underline-offset-4 hover:underline">{ui(item.label)}</a>)}
          <a href="/driver-registration" target="_blank" rel="noopener noreferrer" className="py-3 text-base underline-offset-4 hover:underline">
            <LocalizedText text="سجّل كسائق" />
          </a>
          <Link className="py-3 text-base underline-offset-4 hover:underline" href={withLocale(REDIRECTS.signInUrl, locale)}>
            <LocalizedText text="تسجيل الدخول" />
          </Link>
          <Link className="py-3 text-base underline-offset-4 hover:underline" href={withLocale(REDIRECTS.registerUrl, locale)}>
            <LocalizedText text="ابدأ الآن" />
          </Link>
        </div>
      </div>
    </header>
  )
}
