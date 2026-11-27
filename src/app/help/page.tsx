import { LocalizedText } from "@/components/localized-text"
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CircleQuestionMark, FileSearch, Mail, UserPlus } from 'lucide-react';

export const metadata: Metadata = {
  title: 'المساعدة والدعم | نخبة التطوير',
  description: 'مركز المساعدة لمنصة نخبة التطوير — إجابات سريعة وروابط الدعم لمشغلي اللوجستيات.',
  robots: { index: true, follow: true },
};

const cards = [
  {
    icon: CircleQuestionMark,
    title: 'الأسئلة الشائعة',
    desc: 'إجابات عن المنصة والرواتب والعقود واللغة والعمليات السعودية.',
    href: '/landing#faq',
    cta: 'تصفح الأسئلة',
  },
  {
    icon: UserPlus,
    title: 'تسجيل شركة جديدة',
    desc: 'أنشئ مساحة عمل شركتك بشعارها وألوانها وابدأ التجربة المجانية 14 يومًا.',
    href: '/platform/register',
    cta: 'سجّل شركتك',
  },
  {
    icon: FileSearch,
    title: 'حالة طلب السائق',
    desc: 'سائق؟ تابع حالة طلب التسجيل الخاص بك برقم التتبع دون الحاجة لحساب.',
    href: '/driver-application-status',
    cta: 'تتبع الطلب',
  },
  {
    icon: Mail,
    title: 'تواصل مع الدعم',
    desc: 'فريقنا في القصيم، السعودية. نرد عادة خلال يوم عمل واحد.',
    href: 'mailto:support@elite-dev.com',
    cta: 'support@elite-dev.com',
  },
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 py-10 sm:py-16 lg:px-8">
        <Link href="/landing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <LocalizedText text="Back to home" />
        </Link>
        <div className="mt-10 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight leading-tight sm:text-4xl"><LocalizedText text="How can we help?" /></h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            <LocalizedText text="Quick answers and direct links for logistics operators and drivers." />
          </p>
        </div>
        <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.title} className="border-t border-border pt-6">
              <span className="flex h-6 w-6 items-center text-muted-foreground">
                <card.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-foreground"><LocalizedText text={card.title} /></h2>
              <p className="mt-2 max-w-[36ch] text-sm leading-7 text-muted-foreground"><LocalizedText text={card.desc} /></p>
              <Link href={card.href} className="mt-4 inline-flex items-center gap-1.5 min-h-11 text-sm font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground">
                <LocalizedText text={card.cta} />
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-12 text-center text-xs text-muted-foreground">
          <LocalizedText text="For legal information, see" /> <Link href="/terms" className="underline underline-offset-4 hover:text-foreground"><LocalizedText text="شروط الخدمة" /></Link> <LocalizedText text="and" /> <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground"><LocalizedText text="سياسة الخصوصية" /></Link>.
        </p>
      </div>
    </main>
  );
}
