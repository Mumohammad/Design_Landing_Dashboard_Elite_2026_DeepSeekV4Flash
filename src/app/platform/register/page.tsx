'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, CheckCircle2, Loader2 } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/platform/browser';

export default function PlatformRegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    company_name: '',
    domain: '',
    email: '',
    password: '',
    logo_url: '',
    brand_colors: '#1E5A99',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/platform/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التسجيل');

      const supabase = getBrowserSupabase();
      if (supabase) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (!signInErr) {
          router.push('/dashboard');
          router.refresh();
          return;
        }
      }
      router.push('/platform/login?registered=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
      setLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-xl border border-border/60 bg-background px-4 py-3 text-sm outline-none transition focus:border-elite-blue-500 focus:ring-2 focus:ring-elite-blue-500/20 placeholder:text-muted-foreground/60';

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 gradient-mesh" />
      <div className="absolute inset-0 dot-grid-premium opacity-40" />
      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10">
        <div className="flex items-center justify-between">
          <Link href="/platform" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> العودة للمنصة
          </Link>
          <Link href="/platform/login" className="text-sm font-semibold text-elite-blue-600 dark:text-elite-blue-300">
            لديك حساب؟ دخول
          </Link>
        </div>
        <div className="card-premium mt-8 p-8 sm:p-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 shadow-xl shadow-elite-blue-500/25">
            <Building2 className="h-7 w-7 text-white" />
          </span>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight">سجّل شركتك</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            أنشئ مساحة عمل شركتك المعزولة — بشعارك وألوانك ودومينك. تبدأ بالخطة التجريبية مجانًا.
          </p>
          {error && (
            <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold">اسم الشركة *</label>
              <input required value={form.company_name} onChange={set('company_name')} className={inputCls} placeholder="مثال: شركة النخبة للوجستيات" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold">دومين الشركة</label>
              <input value={form.domain} onChange={set('domain')} className={inputCls} placeholder="example.com" dir="ltr" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">البريد العملي *</label>
                <input required type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="you@company.com" dir="ltr" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">كلمة المرور *</label>
                <input required type="password" minLength={8} value={form.password} onChange={set('password')} className={inputCls} placeholder="8 أحرف على الأقل" dir="ltr" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold">رابط الشعار (اختياري)</label>
              <input type="url" value={form.logo_url} onChange={set('logo_url')} className={inputCls} placeholder="https://cdn.example.com/logo.png" dir="ltr" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold">لون العلامة</label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.brand_colors} onChange={set('brand_colors')} className="h-11 w-16 cursor-pointer rounded-lg border border-border/60 bg-background" />
                <input value={form.brand_colors} onChange={set('brand_colors')} className={inputCls} dir="ltr" />
              </div>
            </div>
            <button
              disabled={loading}
              type="submit"
              className="flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-sm font-bold text-white shadow-xl shadow-elite-blue-500/30 transition hover:scale-[1.01] hover:from-elite-blue-600 hover:to-elite-blue-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {loading ? 'جارٍ إنشاء مساحتك…' : 'أنشئ مساحة عمل شركتي'}
            </button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              بالتسجيل أنت توافق على الشروط والخصوصية. بيانات شركتك معزولة تمامًا عبر RLS.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
