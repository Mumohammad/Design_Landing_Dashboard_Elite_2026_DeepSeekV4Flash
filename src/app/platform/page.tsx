import Link from 'next/link';
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
    <main dir="rtl" className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/landing" className="flex items-center gap-2.5 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-white"><Building2 className="h-5 w-5" /></span>
            <span>نخبة التطوير <span className="text-slate-400 font-medium">· منصة الشركات</span></span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/platform/login" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100"><LogIn className="h-4 w-4" /> دخول</Link>
            <Link href="/platform/register" className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-4 py-2 text-sm font-bold text-white shadow-lg shadow-[#1E5A99]/25 transition hover:shadow-xl"><Rocket className="h-4 w-4" /> سجّل شركتك</Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(30,90,153,.08),transparent_40%),radial-gradient(circle_at_15%_30%,rgba(232,125,62,.07),transparent_35%)]" />
        <div className="relative mx-auto max-w-6xl px-6 py-20 text-center md:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#1E5A99]/20 bg-[#1E5A99]/5 px-4 py-1.5 text-xs font-bold text-[#1E5A99]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#E87D3E]" /> منصة إدارة الأسطول للشركات</span>
          <h1 className="mx-auto mt-7 max-w-3xl text-4xl font-extrabold leading-[1.15] tracking-tight sm:text-5xl xl:text-6xl">مساحة عمل شركتك. <span className="bg-gradient-to-r from-[#1E5A99] to-[#E87D3E] bg-clip-text text-transparent">باسمك، وهويتك، وبياناتك.</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-500">كل شركة تحصل على لوحة التحكم الكاملة بهويتها الخاصة — السائقون والمركبات والرواتب والمصروفات والتقارير، معزولة تمامًا ومحمية بأمان مؤسسي.</p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/platform/register" className="group inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-8 py-4 text-sm font-bold text-white shadow-2xl shadow-[#1E5A99]/30 transition hover:scale-[1.02] hover:shadow-[#1E5A99]/45 active:scale-[0.98]">ابدأ التجربة المجانية <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /></Link>
            <Link href="/platform/login" className="inline-flex items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-8 py-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-[#1E5A99]/40 hover:bg-[#1E5A99]/5"><LayoutDashboard className="h-4 w-4" /> دخول إلى لوحة التحكم</Link>
          </div>
          <p className="mt-5 text-xs font-semibold text-slate-400">14 يومًا مجانًا · بدون بطاقة ائتمان · إعداد في دقيقتين</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E87D3E]">لماذا الشركات تختارنا</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">بنية متعددة الشركات بحكم التصميم</h2></div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(f => (
            <div key={f.title} className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-[#1E5A99]/30 hover:shadow-xl hover:shadow-[#1E5A99]/10">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-white shadow-lg shadow-[#1E5A99]/20 transition group-hover:scale-110"><f.icon className="h-5 w-5" /></div>
              <h3 className="mt-5 font-extrabold">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200/70 bg-white py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1E5A99]">كيف تبدأ</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">ثلاث خطوات وتنطلق</h2></div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map(s => (
              <div key={s.n} className="relative rounded-3xl border border-slate-200 bg-[#f6f8fb] p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-lg font-extrabold text-white shadow-lg shadow-[#1E5A99]/25">{s.n}</span>
                <h3 className="mt-5 text-lg font-extrabold">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0c1f38] via-[#123a63] to-[#1E5A99] p-10 text-center sm:p-14">
          <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="absolute -end-24 -top-24 h-72 w-72 rounded-full bg-[#E87D3E]/20 blur-[90px]" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold leading-tight text-white sm:text-4xl">جاهز تبني مساحة عمل شركتك؟</h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-white/60">سجّل الآن وابدأ تجربتك المجانية — لوحة تحكمك بهويتك تنتظرك.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/platform/register" className="group inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#E87D3E] to-[#d96c2f] px-8 py-4 text-sm font-bold text-white shadow-2xl shadow-[#E87D3E]/30 transition hover:scale-[1.02] active:scale-[0.98]">سجّل شركتك الآن <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /></Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-white/45">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> عزل كامل للبيانات</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> هوية بصرية خاصة</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> تجربة 14 يومًا</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/70 px-6 py-8 text-center text-xs text-slate-400">© {new Date().getFullYear()} نخبة التطوير — منصة الشركات. جميع الحقوق محفوظة.</footer>
    </main>
  );
}
