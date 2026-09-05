import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, Building2, CheckCircle2, Globe, KeyRound, Palette, Rocket, ShieldCheck, Sparkles } from 'lucide-react';

export const metadata: Metadata = {
  title: 'المنصة للشركات | Elite Platform — سجّل شركتك',
  description: 'منصة نخبة التطوير للشركات: مساحة عمل خاصة لكل شركة مع شعارها وألوانها وبياناتها المعزولة — سجّل شركتك وابدأ خلال دقائق.',
};

const steps = [
  { n: '1', title: 'سجّل شركتك', desc: 'الاسم والدومين والشعار ولون العلامة — أقل من دقيقتين.' },
  { n: '2', title: 'مساحتك جاهزة', desc: 'ننشئ لك مساحة عمل معزولة ببياناتك وفريقك فورًا.' },
  { n: '3', title: 'أدر عمليتك', desc: 'لوحة التحكم الكاملة: السائقون، الأسطول، الرواتب، التقارير.' },
];

const features = [
  { icon: Building2, title: 'مساحة عمل لكل شركة', desc: 'كل شركة تعمل في بيئة معزولة تمامًا — بياناتك لا تختلط مع غيرك أبدًا.' },
  { icon: Palette, title: 'بهويتك البصرية', desc: 'شعارك واسمك وألوان علامتك تظهر في لوحة التحكم — white-label جاهز.' },
  { icon: Globe, title: 'بدومين شركتك', desc: 'سجّل بدومين شركتك الرسمي وامنح فريقك عنوانًا مهنيًا واحدًا.' },
  { icon: KeyRound, title: 'دخول آمن', desc: 'مصادقة Supabase مع MFA وقفل الحسابات وسجل دخول كامل.' },
  { icon: ShieldCheck, title: 'عزل على مستوى الصف', desc: 'Row Level Security تفصل كل شركة عن الأخرى في قاعدة البيانات نفسها.' },
  { icon: Rocket, title: 'جاهز خلال دقائق', desc: 'بدون تثبيت وبدون خوادم — سجّل وادخل مباشرة إلى لوحة التحكم.' },
];

export default function PlatformPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:px-8">
          <Link href="/landing" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 shadow-lg shadow-elite-blue-500/20">
              <Building2 className="h-4.5 w-4.5 text-white" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold">نخبة التطوير</span>
              <span className="block text-[10px] font-medium text-muted-foreground">منصة الشركات</span>
            </span>
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <Link href="/platform/login" className="rounded-xl border border-border/60 bg-background px-4 py-2 text-sm font-semibold transition hover:bg-muted/50">دخول</Link>
            <Link href="/platform/register" className="rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition hover:from-elite-blue-600 hover:to-elite-blue-700">سجّل شركتك</Link>
          </div>
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 gradient-mesh" />
        <div className="absolute inset-0 dot-grid-premium opacity-50" />
        <div className="absolute rounded-full blur-3xl opacity-40 bg-elite-blue-500/30 top-[-5%] left-[10%]" style={{ width: 400, height: 400 }} />
        <div className="absolute rounded-full blur-3xl opacity-30 bg-elite-orange-500/20 top-[30%] right-[-5%]" style={{ width: 320, height: 320 }} />
        <div className="relative mx-auto max-w-5xl px-4 py-24 text-center lg:px-8 lg:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-elite-blue-500/30 bg-elite-blue-500/5 px-4 py-1.5 text-xs font-semibold text-elite-blue-600 dark:text-elite-blue-300">
            <Sparkles className="h-3.5 w-3.5" /> منصة الشركات — Multi-Tenant
          </span>
          <h1 className="mx-auto mt-7 max-w-3xl text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-5xl xl:text-[3.6rem]">
            شركتك. مساحتك. <span className="text-gradient-elite">لوحتك الخاصة.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            كل شركة تحصل على مساحة عمل معزولة بشعارها وألوانها وبياناتها — على نفس المنصة المؤسسية. سجّل شركتك وابدأ العمل خلال دقائق.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/platform/register" className="group inline-flex h-13 items-center gap-2.5 rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-2xl shadow-elite-blue-500/30 transition hover:scale-[1.02] hover:from-elite-blue-600 hover:to-elite-blue-700">
              سجّل شركتك مجانًا
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:-scale-x-100" />
            </Link>
            <Link href="/platform/login" className="inline-flex h-13 items-center rounded-2xl border border-border/60 bg-background px-8 text-sm font-bold backdrop-blur-sm transition hover:border-elite-blue-500/40 hover:bg-elite-blue-500/5">
              دخول الشركات المسجلة
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">بدون بطاقة ائتمان · إعداد في دقيقتين · بيانات معزولة بالكامل</p>
        </div>
      </section>

      <section className="border-y border-border/40 bg-card/40 py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">كيف تبدأ؟</h2>
            <p className="mt-3 text-muted-foreground">ثلاث خطوات — وكل خطوة تغذي التالية.</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="card-premium p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-base font-extrabold text-white shadow-lg shadow-elite-blue-500/25">{s.n}</span>
                <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-24 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">ماذا تحصل شركتك؟</h2>
          <p className="mt-3 text-muted-foreground">كل ما تحتاجه عمليتك — معزولًا وآمنًا وبجودة المؤسسات.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card-premium group p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-white shadow-lg transition group-hover:scale-110">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="card-premium mx-auto mt-14 max-w-4xl p-8">
          <h3 className="text-xl font-bold">كل تسجيل يشمل</h3>
          <ul className="mt-5 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            {['مساحة عمل معزولة بصلاحيات وأدوار', 'السائقون والمركبات والطلبات والرواتب', 'التقارير والمحاسبة والفواتير', 'شعارك وألوانك في كل الشاشات'].map((item) => (
              <li key={item} className="flex items-center gap-2.5"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />{item}</li>
            ))}
          </ul>
          <Link href="/platform/register" className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-elite-orange-500 to-elite-orange-600 px-7 py-3 text-sm font-bold text-white shadow-xl shadow-elite-orange-500/25 transition hover:scale-[1.02]">
            ابدأ التسجيل الآن <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border/40 px-4 py-8 text-center text-xs text-muted-foreground">
        © 2026 نخبة التطوير — منصة الشركات
      </footer>
    </main>
  );
}
