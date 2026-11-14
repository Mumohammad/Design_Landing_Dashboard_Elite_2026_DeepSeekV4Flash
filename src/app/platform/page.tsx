import { LocalizedText } from "@/components/localized-text"
import Link from 'next/link';
import { LanguageToggle } from '@/components/language-toggle';
import { Building2, ShieldCheck, Users, Palette, ArrowLeft, CheckCircle2, Rocket, LogIn, LayoutDashboard } from 'lucide-react';

const features = [
  { icon: Building2, title: 'مساحة معزولة لكل شركة', desc: 'كل شركة تحصل على مساحة عمل مستقلة تمامًا — بياناتها وفريقها وإعداداتها لا تختلط بأحد.' },
  { icon: Palette, title: 'هوية بصرية خاصة', desc: 'شعارك، ألوانك، واسم شركتك — لوحة تحكم تبدو وكأنها لك وحدك.' },
  { icon: Users, title: 'فريقك وصلاحياته', desc: 'أدوار وصلاحيات دقيقة لكل عضو — من المدير العام إلى القارئ فقط.' },
  { icon: ShieldCheck, title: 'أمان مؤسسي', desc: 'مصادقة Supabase مع Row Level Security — عزل كامل بين الشركات على مستوى قاعدة البيانات.' },
];

const steps = [
  { n: '1', title: 'سجّل شركتك', desc: 'الاسم والدومين والهوية البصرية في دقيقتين' },
  { n: '2', title: 'أضف فريقك', desc: 'وجّه الدعوات وحدد الأدوار والصلاحيات' },
  { n: '3', title: 'أدر عملياتك', desc: 'السائقون والمركبات والرواتب والتقارير في مركز واحد' },
];

export default function PlatformPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <Link href="/landing" className="flex items-center gap-2.5 font-bold">
            <span className="flex h-9 w-9 items-center justify-center text-primary"><Building2 className="h-5 w-5" /></span>
            <span><LocalizedText text="نخبة التطوير" /> <span className="hidden font-normal text-muted-foreground sm:inline">· <LocalizedText text="Company platform" /></span></span>
          </Link>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3"><LanguageToggle />
            <Link href="/platform/admin" className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ShieldCheck className="h-4 w-4" /> <LocalizedText text="الإدارة" /></Link>
            <Link href="/platform/login" className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"><LogIn className="h-4 w-4" /> <LocalizedText text="Sign in" /></Link>
            <Link href="/platform/register" className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"><Rocket className="h-4 w-4" /> <LocalizedText text="سجّل شركتك" /></Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> <LocalizedText text="منصة إدارة الأسطول للشركات" /></span>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.2] tracking-tight sm:text-5xl xl:text-6xl"><LocalizedText text="مساحة عمل شركتك." /> <span className="text-muted-foreground"><LocalizedText text="باسمك، وهويتك، وبياناتك." /></span></h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg"><LocalizedText text="كل شركة تحصل على لوحة التحكم الكاملة بهويتها الخاصة — السائقون والمركبات والرواتب والمصروفات والتقارير، معزولة تمامًا ومحمية بأمان مؤسسي." /></p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/platform/register" className="group inline-flex items-center justify-center gap-2.5 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"><LocalizedText text="ابدأ التجربة المجانية" /> <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /></Link>
            <Link href="/platform/login" className="inline-flex items-center justify-center gap-2.5 rounded-md border border-border bg-background px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"><LayoutDashboard className="h-4 w-4" /> <LocalizedText text="دخول إلى لوحة التحكم" /></Link>
          </div>
          <p className="mt-5 text-xs font-semibold text-muted-foreground"><LocalizedText text="14 يومًا مجانًا · بدون بطاقة ائتمان · إعداد في دقيقتين" /></p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="max-w-3xl"><p className="text-sm font-medium text-muted-foreground"><LocalizedText text="لماذا الشركات تختارنا" /></p><h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"><LocalizedText text="بنية متعددة الشركات بحكم التصميم" /></h2></div>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {features.map(f => (
            <div key={f.title} className="border-t border-border pt-6">
              <div className="flex h-6 w-6 items-center text-muted-foreground"><f.icon className="h-5 w-5" /></div>
              <h3 className="mt-5 font-semibold"><LocalizedText text={f.title} /></h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground"><LocalizedText text={f.desc} /></p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-muted py-14">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-3xl"><p className="text-sm font-medium text-muted-foreground"><LocalizedText text="كيف تبدأ" /></p><h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"><LocalizedText text="ثلاث خطوات وتنطلق" /></h2></div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map(s => (
              <div key={s.n} className="relative border-t border-border pt-6">
                <span className="block text-sm font-medium tabular-nums text-muted-foreground">{s.n}</span>
                <h3 className="mt-5 text-lg font-semibold"><LocalizedText text={s.title} /></h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground"><LocalizedText text={s.desc} /></p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="relative border-t border-border bg-muted p-6 text-start sm:p-12">
          <div className="relative">
            <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-foreground sm:text-4xl"><LocalizedText text="جاهز تبني مساحة عمل شركتك؟" /></h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground"><LocalizedText text="سجّل الآن وابدأ تجربتك المجانية — لوحة تحكمك بهويتك تنتظرك." /></p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/platform/register" className="group inline-flex items-center justify-center gap-2.5 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"><LocalizedText text="سجّل شركتك الآن" /> <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /></Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> <LocalizedText text="عزل كامل للبيانات" /></span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> <LocalizedText text="هوية بصرية خاصة" /></span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> <LocalizedText text="تجربة 14 يومًا" /></span>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} <LocalizedText text="Elite Development" /> — <LocalizedText text="Company platform" />. <LocalizedText text="All rights reserved." /></p>
          <Link href="/platform/admin" className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground transition hover:text-foreground"><ShieldCheck className="h-3.5 w-3.5" /> <LocalizedText text="إدارة المنصة" /></Link>
        </div>
      </footer>
    </main>
  );
}
