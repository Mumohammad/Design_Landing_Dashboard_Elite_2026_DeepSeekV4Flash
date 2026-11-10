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
      <div className="mx-auto max-w-4xl px-4 py-16 lg:px-8">
        <Link href="/landing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <LocalizedText text="Back to home" />
        </Link>
        <div className="mt-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl"><LocalizedText text="How can we help?" /></h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            <LocalizedText text="Quick answers and direct links for logistics operators and drivers." />
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-border/50 bg-card/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-elite-blue-500/40">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl text-elite-blue-600 dark:text-elite-blue-300">
                <card.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-base font-bold text-foreground"><LocalizedText text={card.title} /></h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground"><LocalizedText text={card.desc} /></p>
              <Link href={card.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-elite-blue-600 transition-colors hover:text-elite-blue-700 dark:text-elite-blue-300">
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
