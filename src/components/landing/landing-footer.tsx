'use client';

import { LocalizedText, useUiText } from "@/components/localized-text"
import Link from 'next/link';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslation } from '@/hooks/use-translation';
import { REDIRECTS, withLocale } from '@/lib/redirects';
import Image from 'next/image';
import { Mail, MapPin } from 'lucide-react';

const platformLinks = [
  { href: '#driver360', label: 'السائقون' },
  { href: '#fleet', label: 'الأسطول' },
  { href: '#payroll', label: 'الرواتب' },
  { href: '#operations', label: 'العمليات' },
  { href: '#reports', label: 'التقارير' },
];

const companyLinks = [
  { href: '/platform', label: 'المنصة' },
  { href: '/platform/register', label: 'سجّل شركتك' },
  { href: REDIRECTS.signInUrl, label: 'تسجيل الدخول' },
];

const resourceLinks = [
  { href: '/help', label: 'المساعدة والدعم' },
  { href: '#faq', label: 'الأسئلة الشائعة' },
  { href: '/driver-registration', label: 'تسجيل السائقين' },
];

const legalLinks = [
  { href: '/privacy', label: 'سياسة الخصوصية' },
  { href: '/terms', label: 'شروط الخدمة' },
];

function LinkColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  const { locale } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-foreground"><LocalizedText text={title} /></p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <Link href={link.href === REDIRECTS.signInUrl ? withLocale(link.href, locale) : link.href} className="text-[13px] text-muted-foreground transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
              <LocalizedText text={link.label} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  const ui = useUiText()
  return (
    <footer className="border-t border-border/40 bg-card/40">
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center rounded-2xl bg-elite-blue-500 shadow-elite-blue-500/20" style={{ width: 34, height: 34 }}>
                <Image alt={ui("Elite Development")} width={34} height={34} className="rounded-2xl object-cover" style={{ width: 34, height: 34 }} src="/logo.png" />
              </div>
              <div className="leading-tight">
                <p className="font-bold text-foreground"><LocalizedText text="نخبة التطوير" /></p>
                <p className="text-[11px] text-muted-foreground"><LocalizedText text="Elite Development" /></p>
              </div>
            </div>
            <p className="max-w-sm text-base leading-relaxed text-foreground/75"><LocalizedText text="نظام التشغيل للعملية اللوجستية." /></p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /><LocalizedText text="القصيم، المملكة العربية السعودية" /></p>
              <a href="mailto:support@elite-dev.com" className="flex w-fit items-center gap-2 transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                support@elite-dev.com
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-4">
            <LinkColumn title={ui("المنصة")} links={platformLinks} />
            <LinkColumn title={ui("الشركة")} links={companyLinks} />
            <LinkColumn title={ui("الموارد")} links={resourceLinks} />
            <LinkColumn title={ui("قانوني")} links={legalLinks} />
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} <LocalizedText text="Elite Development" /> — <LocalizedText text="All rights reserved." /></p>
          <LanguageToggle />
        </div>
      </div>
    </footer>
  );
}

export default LandingFooter;
