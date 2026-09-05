'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, Loader2, LogIn } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/platform/browser';

export default function PlatformLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError('إعدادات النظام غير مكتملة — تواصل مع الدعم');
      setLoading(false);
      return;
    }
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError('بيانات الدخول غير صحيحة أو الحساب غير مفعّل');
      setLoading(false);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  const inputCls =
    'w-full rounded-xl border border-border/60 bg-background px-4 py-3 text-sm outline-none transition focus:border-elite-blue-500 focus:ring-2 focus:ring-elite-blue-500/20 placeholder:text-muted-foreground/60';

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 gradient-mesh" />
      <div className="absolute inset-0 dot-grid-premium opacity-40" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <Link href="/platform" className="mb-8 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> العودة للمنصة
        </Link>
        <div className="card-premium p-8 sm:p-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 shadow-xl shadow-elite-blue-500/25">
            <Building2 className="h-7 w-7 text-white" />
          </span>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight">دخول الشركات</h1>
          <p className="mt-2 text-sm text-muted-foreground">ادخل إلى مساحة عمل شركتك على لوحة التحكم.</p>
          {error && (
            <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold">البريد العملي</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" dir="ltr" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold">كلمة المرور</label>
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" dir="ltr" />
            </div>
            <button
              disabled={loading}
              type="submit"
              className="flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-sm font-bold text-white shadow-xl shadow-elite-blue-500/30 transition hover:scale-[1.01] hover:from-elite-blue-600 hover:to-elite-blue-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {loading ? 'جارٍ الدخول…' : 'دخول إلى لوحة التحكم'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            شركة جديدة؟{' '}
            <Link href="/platform/register" className="font-semibold text-elite-blue-600 dark:text-elite-blue-300">
              سجّل شركتك
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
