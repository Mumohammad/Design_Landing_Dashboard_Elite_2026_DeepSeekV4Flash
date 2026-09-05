'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, ArrowLeft, Sparkles, Menu, X, Moon } from 'lucide-react';

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

function FlagEn() {
  return (
    <span className="inline-block h-4 w-6 shrink-0 overflow-hidden rounded-[3px] shadow-sm ring-1 ring-black/10" role="img" aria-label="en">
      <svg viewBox="0 0 90 60" className="h-full w-full" aria-hidden="true">
        <rect width="90" height="60" fill="#012169"></rect>
        <path d="M-8 -10 L64 52" stroke="#ffffff" strokeWidth="10"></path>
        <path d="M98 -10 L26 52" stroke="#ffffff" strokeWidth="10"></path>
        <path d="M-8 -10 L64 52" stroke="#C8102E" strokeWidth="5"></path>
        <path d="M98 -10 L26 52" stroke="#C8102E" strokeWidth="5"></path>
        <rect x="38" y="-10" width="14" height="80" fill="#ffffff"></rect>
        <rect x="-10" y="23" width="110" height="14" fill="#ffffff"></rect>
        <rect x="41" y="-10" width="8" height="80" fill="#C8102E"></rect>
        <rect x="-10" y="26" width="110" height="8" fill="#C8102E"></rect>
      </svg>
    </span>
  );
}

export function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function toggleLocale() {
    try {
      const current = localStorage.getItem('elite-locale') === 'en' ? 'en' : 'ar';
      const next = current === 'ar' ? 'en' : 'ar';
      localStorage.setItem('elite-locale', next);
      window.location.reload();
    } catch {
      /* noop */
    }
  }

  function toggleTheme() {
    try {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('elite-ui-theme', isDark ? 'dark' : 'light');
    } catch {
      /* noop */
    }
  }

  return (
    <header className="sticky top-0 z-50 transition-all duration-500 border-b border-transparent bg-background/30 backdrop-blur-xl">
      <div
        className={`absolute bottom-0 left-0 right-0 h-px transition-opacity duration-500 ${scrolled ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'linear-gradient(90deg, transparent, rgba(30,90,153,0.4) 30%, rgba(232,125,62,0.4) 70%, transparent)' }}
      ></div>
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:px-8">
        <Link className="flex shrink-0 items-center gap-3 group" aria-label="نخبة التطوير" href="/landing">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-40"></div>
            <div className="relative flex items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 shadow-lg shadow-elite-blue-500/20" style={{ width: 36, height: 36 }}>
              <Image alt="Elite Development" width={36} height={36} className="rounded-2xl object-cover" style={{ width: 36, height: 36 }} src="/logo.png" />
            </div>
          </div>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-bold text-foreground">نخبة التطوير</span>
            <span className="block text-[10px] font-medium text-muted-foreground">منصة لوجستيات التشغيل المؤسسي</span>
          </span>
        </Link>

        <div className="mx-auto hidden items-center gap-0.5 xl:flex">
          {navItems.map(item => (
            <a key={item.href} href={item.href} className="relative rounded-xl px-3 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-elite-blue-500/5 hover:text-foreground hover:shadow-sm">{item.label}</a>
          ))}
          <a href="/driver-registration" target="_blank" rel="noopener noreferrer" className="ms-2 inline-flex items-center gap-1.5 rounded-xl border border-elite-blue-500/30 bg-elite-blue-500/5 px-3.5 py-2 text-[13px] font-bold text-elite-blue-600 transition-all duration-200 hover:bg-elite-blue-500/10 hover:border-elite-blue-500/50 hover:shadow-md hover:shadow-elite-blue-500/10 dark:text-elite-blue-300">
            <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            سجّل كسائق
          </a>
        </div>

        <div className="ms-auto flex items-center gap-2 xl:ms-0">
          <button onClick={toggleLocale} className="inline-flex items-center justify-center whitespace-nowrap text-sm h-8 px-3 gap-2 rounded-xl font-semibold transition-all duration-200 hover:bg-elite-blue-500/5" aria-label="Toggle language">
            <FlagEn />
            EN
          </button>
          <button onClick={toggleTheme} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground size-9 cursor-pointer relative overflow-hidden" aria-label="Toggle theme">
            <Moon className="h-[1.2rem] w-[1.2rem] transition-transform duration-300" aria-hidden="true" />
            <span className="sr-only">Switch theme</span>
          </button>
          <Link className="items-center justify-center whitespace-nowrap text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-8 gap-1.5 px-3 hidden rounded-xl sm:inline-flex" href="/platform/login">
            تسجيل الدخول
          </Link>
          <Link className="items-center justify-center whitespace-nowrap text-sm font-medium transition-all h-8 gap-1.5 px-3 hidden rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25 duration-300 hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-xl hover:shadow-elite-blue-500/40 hover:scale-[1.02] active:scale-[0.98] sm:inline-flex" href="/platform/register">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            ابدأ الآن
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
          <button onClick={() => setMenuOpen(o => !o)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground size-9 rounded-xl xl:hidden" aria-label="Menu" aria-expanded={menuOpen} aria-controls="landing-mobile-menu">
            {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <div id="landing-mobile-menu" className={`overflow-hidden border-t border-border/40 bg-background/95 backdrop-blur-2xl transition-all duration-300 xl:hidden ${menuOpen ? 'max-h-[560px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="mx-auto max-w-7xl space-y-1 px-4 py-4">
          {navItems.map(item => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-elite-blue-500/5">{item.label}</a>
          ))}
          <a href="/driver-registration" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-elite-blue-600 dark:text-elite-blue-300">
            <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
            سجّل كسائق
          </a>
          <div className="flex gap-3 pt-4">
            <Link className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent h-8 gap-1.5 px-3 flex-1 rounded-xl" href="/platform/login">
              تسجيل الدخول
            </Link>
            <Link className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all h-8 gap-1.5 px-3 flex-1 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25" href="/platform/register">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              ابدأ الآن
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
