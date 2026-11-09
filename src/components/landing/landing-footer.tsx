'use client';

import { LocalizedText, useUiText } from "@/components/localized-text"
import Link from 'next/link';
import Image from 'next/image';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslation } from '@/hooks/use-translation';
import { REDIRECTS, withLocale } from '@/lib/redirects';

const platformLinks = [{ href: '#driver360', label: 'السائقون' }, { href: '#fleet', label: 'الأسطول' }, { href: '#payroll', label: 'الرواتب' }, { href: '#operations', label: 'العمليات' }, { href: '#reports', label: 'التقارير' }]
const companyLinks = [{ href: '/platform', label: 'المنصة' }, { href: '/platform/register', label: 'سجّل شركتك' }, { href: REDIRECTS.signInUrl, label: 'تسجيل الدخول' }]
const resourceLinks = [{ href: '/help', label: 'المساعدة والدعم' }, { href: '#faq', label: 'الأسئلة الشائعة' }, { href: '/driver-registration', label: 'تسجيل السائقين' }]
const legalLinks = [{ href: '/privacy', label: 'سياسة الخصوصية' }, { href: '/terms', label: 'شروط الخدمة' }]

function LinkColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  const { locale } = useTranslation()
  return <div>
    <p className="text-base font-semibold">
      <LocalizedText text={title} />
    </p>
    <ul className="mt-4 space-y-3">{links.map(link => <li key={link.href + link.label}>
      <Link href={link.href === REDIRECTS.signInUrl ? withLocale(link.href, locale) : link.href} className="text-sm text-white/80 underline-offset-4 hover:text-white hover:underline">
        <LocalizedText text={link.label} />
      </Link>
    </li>)}</ul>
  </div>
}

export function LandingFooter() {
  const ui = useUiText()
  const { locale } = useTranslation()
  return (
    <footer className="bg-elite-blue-950 text-white">
      <div className="mx-auto flex min-h-[75svh] max-w-7xl flex-col justify-between gap-20 px-5 pb-8 pt-16 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <div className="flex items-center gap-3">
              <Image alt={ui("Elite Development")} width={36} height={36} className="object-cover" src="/logo.png" />
              <p className="text-base font-semibold">
                <LocalizedText text="نخبة التطوير" />
              </p>
            </div>
            <p className="mt-5 max-w-[30ch] text-base leading-relaxed">
              <LocalizedText text="نظام التشغيل للعملية اللوجستية." />
            </p>
            <p className="mt-5 text-sm text-white/80">
              <LocalizedText text="القصيم، المملكة العربية السعودية" />
            </p>
            <a href="mailto:support@elite-dev.com" className="mt-3 inline-block text-sm text-white/80 underline-offset-4 hover:text-white hover:underline">support@elite-dev.com</a>
          </div>
          <div className="grid grid-cols-2 gap-9 sm:grid-cols-4">
            <LinkColumn title={ui("المنصة")} links={platformLinks} />
            <LinkColumn title={ui("الشركة")} links={companyLinks} />
            <LinkColumn title={ui("الموارد")} links={resourceLinks} />
            <LinkColumn title={ui("قانوني")} links={legalLinks} />
          </div>
        </div>
        <div>
          <p className="text-[clamp(3rem,9.5vw,9rem)] font-medium leading-[.95] tracking-[-.055em]">{locale === "ar" ? "نخبة التطوير" : <>Elite <br className="sm:hidden" />Development</>}</p>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-white/75">© {new Date().getFullYear()} <LocalizedText text="Elite Development" /> — <LocalizedText text="All rights reserved." />
            </p>
            <LanguageToggle />
          </div>
        </div>
      </div>
    </footer>
  )
}
export default LandingFooter
