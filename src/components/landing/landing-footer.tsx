'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Mail, MapPin } from 'lucide-react';
import { useTranslation } from '@/hooks/use-translation';
import { landingContent } from '@/lib/landing-content';

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

function LinkColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <Link href={link.href} className="text-[13px] text-muted-foreground transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  const { locale, setLocale, t } = useTranslation();
  const c = landingContent[locale];
  const platformLinks = c.nav.links.filter(link => ['#driver360', '#fleet', '#payroll', '#operations', '#reports'].includes(link.href));
  const companyLinks = [{ href: '/platform', label: c.nav.links[0].label }, { href: '/platform/register', label: c.nav.getStarted }];
  const resourceLinks = [{ href: '/help', label: t.pages.help }, { href: '#faq', label: c.nav.links[8].label }, { href: '/driver-registration', label: c.nav.applyAsDriver }];
  const legalLinks = [{ href: '/privacy', label: t.pages.privacy }, { href: '/terms', label: t.pages.terms }];
  function toggleLocale() {
    setLocale(locale === 'ar' ? 'en' : 'ar');
  }

  return (
    <footer className="border-t border-border/40 bg-card/40">
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 shadow-lg shadow-elite-blue-500/20" style={{ width: 34, height: 34 }}>
                <Image alt="Elite Development" width={34} height={34} className="rounded-2xl object-cover" style={{ width: 34, height: 34 }} src="/logo.png" />
              </div>
              <div className="leading-tight">
                <p className="font-bold text-foreground">{t.app.companyNameArabic}</p>
                <p className="text-[11px] text-muted-foreground">Elite Development</p>
              </div>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{c.footer.tagline}</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {c.footer.address}
              </p>
              <a href="mailto:support@elite-dev.com" className="flex w-fit items-center gap-2 transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                support@elite-dev.com
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-4">
            <LinkColumn title={c.footer.columns[0].title} links={platformLinks} />
            <LinkColumn title={c.footer.columns[1].title} links={companyLinks} />
            <LinkColumn title={c.footer.columns[2].title} links={resourceLinks} />
            <LinkColumn title={c.footer.columns[3].title} links={legalLinks} />
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">{c.footer.copyright.replace('{year}', String(new Date().getFullYear()))}</p>
          <button
            onClick={toggleLocale}
            className="inline-flex items-center justify-center whitespace-nowrap text-sm transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 h-8 rounded-md px-3 gap-2 font-semibold"
            aria-label="Toggle language"
          >
            <FlagEn />
            {locale === 'ar' ? 'English' : 'العربية'}
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}

export default LandingFooter;
