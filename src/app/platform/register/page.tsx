'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowRight, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    company_name: '',
    domain: '',
    email: '',
    password: '',
    logo_url: '',
    brand_colors: '#1E5A99',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/platform/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      // Registration complete — hand off to the main app sign-in (drone layout + MFA)
      router.push('/auth/sign-in?registered=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-[#1E5A99] focus:outline-none focus:ring-2 focus:ring-[#1E5A99]/15 transition';

  return (
    <main dir="rtl" className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/platform" className="flex items-center gap-2.5 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-white"><Building2 className="h-5 w-5" /></span>
            <span>نخبة التطوير <span className="text-slate-400 font-medium">· منصة الشركات</span></span>
          </Link>
          <Link href="/platform/login" className="text-sm font-semibold text-[#1E5A99] hover:text-[#174a7e] transition">لديك حساب؟ دخول</Link>
        </div>
      </header>

      <section className="mx-auto max-w-xl px-6 py-14">
        <Link href="/platform" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition mb-8"><ArrowLeft className="h-4 w-4 -scale-x-100" /> العودة للمنصة</Link>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
          <div className="mb-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#1E5A99]/20 bg-[#1E5A99]/5 px-3.5 py-1.5 text-xs font-bold text-[#1E5A99]">تجربة مجانية 14 يوم</span>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight">أنشئ مساحة عمل شركتك</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">اسم الشركة، الدومين، والهوية البصرية — ثم تدخل عبر صفحة الدخول الرئيسية.</p>
          </div>

          {error && <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label className="mb-2 block text-sm font-bold">اسم الشركة *</label><input required type="text" value={formData.company_name} onChange={e => setFormData({ ...formData, company_name: e.target.value })} className={inputCls} placeholder="مثال: أكمي للوجستيات" /></div>
            <div><label className="mb-2 block text-sm font-bold">دومين الشركة *</label><input required type="text" value={formData.domain} onChange={e => setFormData({ ...formData, domain: e.target.value })} className={inputCls} placeholder="acme.com" dir="ltr" /></div>
            <div><label className="mb-2 block text-sm font-bold">البريد الإلكتروني للعمل *</label><input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className={inputCls} placeholder="you@company.com" dir="ltr" /></div>
            <div><label className="mb-2 block text-sm font-bold">كلمة المرور *</label><input required type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} className={inputCls} placeholder="8 أحرف على الأقل" minLength={8} /></div>
            <div><label className="mb-2 block text-sm font-bold">رابط شعار الشركة</label><input type="url" value={formData.logo_url} onChange={e => setFormData({ ...formData, logo_url: e.target.value })} className={inputCls} placeholder="https://cdn.example.com/logo.png" dir="ltr" /><p className="mt-1.5 text-xs text-slate-400">ارفع الشعار إلى CDN والصق الرابط هنا.</p></div>
            <div><label className="mb-2 block text-sm font-bold">لون العلامة</label><div className="flex items-center gap-3"><input type="color" value={formData.brand_colors} onChange={e => setFormData({ ...formData, brand_colors: e.target.value })} className="h-11 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white" /><input type="text" value={formData.brand_colors} onChange={e => setFormData({ ...formData, brand_colors: e.target.value })} className={inputCls} dir="ltr" /></div></div>
            <div className="pt-3"><button disabled={loading} type="submit" className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-6 py-3.5 font-bold text-white shadow-lg shadow-[#1E5A99]/25 transition hover:shadow-xl hover:shadow-[#1E5A99]/35 disabled:opacity-60">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} {loading ? 'جارٍ إنشاء المساحة…' : 'أنشئ المساحة'} {!loading && <ArrowRight className="h-4 w-4 -scale-x-100 transition-transform group-hover:-translate-x-0.5" />}</button></div>
            <p className="text-center text-xs leading-5 text-slate-400">بالتسجيل أنت توافق على الشروط وسياسة الخصوصية. بعدها تسجّل الدخول من الصفحة الرئيسية مع التحقق بخطوتين.</p>
          </form>
        </div>
      </section>
    </main>
  );
}
