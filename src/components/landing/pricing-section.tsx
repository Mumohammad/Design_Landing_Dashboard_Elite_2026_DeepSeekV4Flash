import { LocalizedText } from "@/components/localized-text"
import Link from 'next/link';
import { ArrowLeft, Check, Sparkles, Zap } from 'lucide-react';

type Plan = {
  name: string;
  tagline: string;
  price: string;
  unit: string;
  features: string[];
  cta: string;
  featured?: boolean;
  badge?: string;
};

const plans: Plan[] = [
  {
    name: 'البداية',
    tagline: 'للأساطيل الصغيرة التي تنظم عملها',
    price: '299',
    unit: 'ر.س / شهريًا',
    features: ['حتى 25 سائقًا', 'سجلات السائقين والمركبات', 'تتبع الحضور', 'الرواتب الشهرية', 'تقارير قياسية'],
    cta: 'ابدأ الآن',
  },
  {
    name: 'النمو',
    tagline: 'للعمليات المتنامية',
    price: '799',
    unit: 'ر.س / شهريًا',
    features: ['حتى 100 سائق', 'جميع وحدات المنصة الـ12', 'قواعد الرواتب والخصومات', 'تقارير متقدمة وتصدير', 'دعم أولوية'],
    cta: 'ابدأ الآن',
    featured: true,
    badge: 'الأكثر شيوعًا',
  },
  {
    name: 'المؤسسات',
    tagline: 'للعمليات متعددة الفروع',
    price: 'حسب الطلب',
    unit: 'لكل عملية',
    features: ['سائقون ومركبات بلا حدود', 'جاهزة لعدة جهات', 'قواعد رواتب مخصصة', 'إعداد مخصص', 'اتفاقية مستوى خدمة ومدير حساب'],
    cta: 'اطلب الوصول',
  },
];

function CheckIcon() {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      <Check className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-24">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold tracking-wide border-elite-blue-500/30 bg-elite-blue-500/5 text-elite-blue-600 dark:text-elite-blue-300">
            <span className="h-1.5 w-1.5 rounded-full bg-elite-blue-500 animate-pulse"></span><LocalizedText text="الأسعار" /></span>
          <h2 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-foreground"><LocalizedText text="خطط بسيطة لأي حجم أسطول" /></h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground"><LocalizedText text="ابدأ بالأساسيات وانمُ مع نمو عمليتك. الخطط المعروضة استرشادية — السعر النهائي يُحدد لكل عملية." /></p>
        </div>

        <div className="mt-14 grid items-stretch gap-7 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={
                plan.featured
                  ? 'relative flex h-full flex-col rounded-3xl bg-background p-7 transition-all duration-300 sm:p-8 card-premium border-elite-blue-500/50 shadow-2xl shadow-elite-blue-500/15 ring-1 ring-inset ring-elite-blue-500/30 scale-[1.02] z-10'
                  : 'relative flex h-full flex-col rounded-3xl bg-background p-7 transition-all duration-300 sm:p-8 card-premium'
              }
            >
              {plan.featured && plan.badge && (
                <>
                  <span className="absolute -top-3.5 start-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 px-4 py-1.5 text-[11px] font-bold whitespace-nowrap text-white shadow-xl shadow-elite-blue-500/30 rtl:translate-x-1/2">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <LocalizedText text={plan.badge} />
                  </span>
                  <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-elite-blue-500/10 to-elite-orange-500/10 blur-xl opacity-50"></div>
                </>
              )}
              <div className="relative">
                <h3 className="text-xl font-extrabold text-foreground"><LocalizedText text={plan.name} /></h3>
                <p className="mt-2 text-sm text-muted-foreground"><LocalizedText text={plan.tagline} /></p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl"><LocalizedText text={plan.price} /></span>
                  <span className="text-sm font-medium text-muted-foreground"><LocalizedText text={plan.unit} /></span>
                </div>
                <ul className="mt-7 flex-1 space-y-3 border-t border-border/50 pt-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-foreground">
                      <CheckIcon />
                      <LocalizedText text={feature} />
                    </li>
                  ))}
                </ul>
                <Link
                  href="/platform/register"
                  className={
                    plan.featured
                      ? 'mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-4 py-2 text-sm font-bold text-white shadow-xl shadow-elite-blue-500/25 transition-all duration-300 hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40 hover:scale-[1.02] active:scale-[0.98]'
                      : 'mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border bg-background px-4 py-2 text-sm font-bold shadow-xs transition-all duration-300 hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                  }
                >
                  {plan.featured && <Zap className="h-4 w-4" aria-hidden="true" />}
                  <LocalizedText text={plan.cta} />
                  <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-elite-orange-500"></span><LocalizedText text="الخطط استرشادية — السعر والحدود يُحددان لكل عملية عند الطلب." /></p>
      </div>
    </section>
  );
}

export default PricingSection;
