'use client';

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, ArrowLeft, Sparkles, Menu, X, Moon } from 'lucide-react';
import { REDIRECTS, withLocale } from '@/lib/redirects';
import { useTranslation } from '@/hooks/use-translation';
import { LanguageToggle } from '@/components/language-toggle';

const navItems = [
  { href: '#platform', label: 'المنصة' },
  { href: '#driver360', label: 'ملف السائق' },
  { href: '#payroll', label: 'الرواتب' },
  { href: '#fleet', label: 'الأسطول' },
  { href: '#operations', label: 'العمليات' },
  { href: '#compliance', label: 'الامتثال' },
  { href: '#reports', label: 'التقارير' },
  { href: '#pricing', label: 'الأسعار' },
  { href: '#faq', label: 'الأسئلة' },
];

export function LandingHeader() {
  const ui = useUiText()
  const { locale } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function toggleTheme() {
    try {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('elite-ui-theme', isDark ? 'dark' : 'light');
    } catch {
      /* noop */
    }
  }

  return (
    <header className="sticky top-0 z-50 transition-all duration-500 border-b border-transparent bg-background">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:px-8 min-[1700px]:max-w-[1600px]">
        <Link className="flex shrink-0 items-center gap-3 group" aria-label={ui("نخبة التطوير")} href="/landing">
          <div className="relative">
            <div className="relative flex items-center justify-center rounded-2xl bg-elite-blue-500 shadow-elite-blue-500/20" style={{ width: 36, height: 36 }}>
              <Image alt={ui("Elite Development")} width={36} height={36} className="rounded-2xl object-cover" style={{ width: 36, height: 36 }} src="/logo.png" />
            </div>
          </div>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-bold text-foreground"><LocalizedText text="نخبة التطوير" /></span>
            <span className="block text-[11px] font-medium text-muted-foreground"><LocalizedText text="منصة لوجستيات التشغيل المؤسسي" /></span>
          </span>
        </Link>

        <div className="mx-auto hidden items-center gap-0.5 min-[1700px]:flex">
          {navItems.map(item => (
            <a key={item.href} href={item.href} className="relative rounded-xl px-3 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-elite-blue-500/5 hover:text-foreground hover:shadow-sm">{ui(item.label)}</a>
          ))}
          <a href="/driver-registration" target="_blank" rel="noopener noreferrer" className="ms-2 inline-flex items-center gap-1.5 rounded-xl border border-elite-blue-500/30 bg-elite-blue-500/5 px-3.5 py-2 text-[13px] font-bold text-elite-blue-600 transition-all duration-200 hover:bg-elite-blue-500/10 hover:border-elite-blue-500/50 hover:shadow-elite-blue-500/10 dark:text-elite-blue-300">
            <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" /><LocalizedText text="سجّل كسائق" /></a>
        </div>

        <div className="ms-auto flex items-center gap-2 min-[1700px]:ms-0">
          <LanguageToggle />
          <button onClick={toggleTheme} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground size-9 cursor-pointer relative overflow-hidden" aria-label={ui("Toggle theme")}>
            <Moon className="h-[1.2rem] w-[1.2rem] transition-transform duration-300" aria-hidden="true" />
            <span className="sr-only"><LocalizedText text="Switch theme" /></span>
          </button>
          <Link className="items-center justify-center whitespace-nowrap text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-8 gap-1.5 px-3 hidden rounded-xl sm:inline-flex" href={withLocale(REDIRECTS.signInUrl, locale)}><LocalizedText text="تسجيل الدخول" /></Link>
          <Link className="items-center justify-center whitespace-nowrap text-sm font-medium transition-all h-8 gap-1.5 px-3 hidden rounded-xl bg-elite-blue-500 text-white shadow-elite-blue-500/25 duration-300 hover:bg-elite-blue-600 hover:shadow-elite-blue-500/40 hover:scale-[1.02] active:scale-[0.98] sm:inline-flex" href={withLocale(REDIRECTS.registerUrl, locale)}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /><LocalizedText text="ابدأ الآن" /><ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
          <button onClick={() => setMenuOpen(o => !o)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground size-9 rounded-xl min-[1700px]:hidden" aria-label={ui("Menu")} aria-expanded={menuOpen} aria-controls="landing-mobile-menu">
            {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <div id="landing-mobile-menu" className={`overflow-hidden border-t border-border/40 bg-background transition-all duration-300 min-[1700px]:hidden ${menuOpen ? 'max-h-[560px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="mx-auto max-w-7xl space-y-1 px-4 py-4">
          {navItems.map(item => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-elite-blue-500/5">{ui(item.label)}</a>
          ))}
          <a href="/driver-registration" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-elite-blue-600 dark:text-elite-blue-300">
            <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /><LocalizedText text="سجّل كسائق" /></a>
          <div className="flex gap-3 pt-4">
            <Link className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent h-8 gap-1.5 px-3 flex-1 rounded-xl" href={withLocale(REDIRECTS.signInUrl, locale)}><LocalizedText text="تسجيل الدخول" /></Link>
            <Link className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all h-8 gap-1.5 px-3 flex-1 rounded-xl bg-elite-blue-500 text-white shadow-elite-blue-500/25" href={withLocale(REDIRECTS.registerUrl, locale)}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /><LocalizedText text="ابدأ الآن" /></Link>
          </div>
        </div>
      </div>
    </header>
  );
}
