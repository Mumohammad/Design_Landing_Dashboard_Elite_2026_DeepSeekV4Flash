'use client';

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowRight, Loader2, CheckCircle2, ArrowLeft, MailCheck } from 'lucide-react';
import { REDIRECTS, withLocale } from '@/lib/redirects';
import { useTranslation } from '@/hooks/use-translation';
import { LanguageToggle } from '@/components/language-toggle';
import { isValidNewPassword, newPasswordHint, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/lib/auth/password-policy';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'needs_confirmation' }
  | { kind: 'ready_to_sign_in' };

export default function RegisterPage() {
  const ui = useUiText()
  const { locale } = useTranslation()
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [formData, setFormData] = useState({
    company_name: '',
    domain: '',
    email: '',
    password: '',
    logo_url: '',
    brand_colors: '#1E5A99',
  });

  const loading = state.kind === 'submitting';
  const done = state.kind === 'needs_confirmation' || state.kind === 'ready_to_sign_in';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || done) return;
    setError('');

    // FX-08: mirror the server-side password policy client-side (min 10
    // chars + at least one letter and one digit).
    const password = formData.password;
    if (!isValidNewPassword(password)) {
      setError(newPasswordHint(locale));
      return;
    }

    setState({ kind: 'submitting' });

    try {
      const res = await fetch('/api/platform/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((locale === 'en' ? data.message_en : data.message_ar) || data.error || ui('Registration failed'));

      setRegisteredEmail(formData.email);
      if (data.requires_confirmation) {
        // Email confirmation enabled → "check your inbox" step.
        setState({ kind: 'needs_confirmation' });
      } else {
        // Confirmation disabled → straight to sign-in with a success banner.
        // Full-page nav to the centralized sign-in URL: relative in single-host
        // mode, absolute (dashboard deployment) in the two-host production
        // topology. Deterministic — no dependence on client-router redirects.
        window.location.replace(withLocale(REDIRECTS.signInUrl + '?registered=1', locale));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setState({ kind: 'idle' });
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-[#1E5A99] focus:outline-none focus:ring-2 focus:ring-[#1E5A99]/15 transition';

  if (done) {
    return (
      <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
        <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <Link href="/platform" className="flex items-center gap-2.5 font-bold">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-white"><Building2 className="h-5 w-5" /></span>
              <span><LocalizedText text="نخبة التطوير" /> <span className="text-slate-400 font-medium">· <LocalizedText text="Company platform" /></span></span>
            </Link>
            <LanguageToggle /><Link href={withLocale(REDIRECTS.signInUrl, locale)} className="text-sm font-semibold text-[#1E5A99] hover:text-[#174a7e] transition"><LocalizedText text="لديك حساب؟ دخول" /></Link>
          </div>
        </header>

        <section className="mx-auto max-w-xl px-6 py-20 text-center">
          {state.kind === 'needs_confirmation' ? (
            <>
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
                <MailCheck className="h-8 w-8 text-emerald-600" />
              </span>
              <h1 className="mt-6 text-2xl font-extrabold tracking-tight"><LocalizedText text="أنشئت مساحة العمل — أكّد بريدك" /></h1>
              <p className="mt-3 text-sm leading-7 text-slate-500"><LocalizedText text="أرسلنا رابط تأكيد إلى" /><span dir="ltr" className="font-bold text-slate-800">{registeredEmail}</span><LocalizedText text=". افتح الرسالة واضغط «تأكيد البريد» لتفعيل حسابك، ثم سجّل الدخول من صفحة الدخول الرئيسية." /></p>
              <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-start shadow-sm">
                <p className="text-xs font-bold text-slate-400"><LocalizedText text="لم يصلك البريد؟" /></p>
                <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-500">
                  <li><LocalizedText text="• تحقق من مجلد الرسائل غير المرغوبية (Spam)." /></li>
                  <li><LocalizedText text="• انتظر دقيقة أو دقيقتين — أحياناً يتأخر التسليم." /></li>
                  <li><LocalizedText text="• ما زال غير موجود؟ استخدم" /> <Link href="/auth/forgot-password" className="font-bold text-[#1E5A99] hover:underline"><LocalizedText text="استعادة كلمة المرور" /></Link> <LocalizedText text="لإرسال رابط جديد، أو تواصل مع الدعم." /></li>
                </ul>
              </div>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push(withLocale(REDIRECTS.signInUrl, locale))}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-6 py-3.5 font-bold text-white shadow-lg shadow-[#1E5A99]/25 transition hover:shadow-xl"
                ><LocalizedText text="الانتقال لتسجيل الدخول" /><ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </span>
              <h1 className="mt-6 text-2xl font-extrabold tracking-tight"><LocalizedText text="تم إنشاء مساحة عمل شركتك 🎉" /></h1>
              <p className="mt-3 text-sm leading-7 text-slate-500"><LocalizedText text="كل شيء جاهز — سجّل الدخول الآن بكلمة المرور التي أنشأتها للتو." /></p>
              <div className="mt-8">
                <button
                  type="button"
                  onClick={() => router.push(withLocale(REDIRECTS.signInUrl, locale))}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-6 py-3.5 font-bold text-white shadow-lg shadow-[#1E5A99]/25 transition hover:shadow-xl"
                ><LocalizedText text="تسجيل الدخول الآن" /><ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
          <p className="mt-6 text-xs text-slate-400">
            <Link href="/platform" className="inline-flex items-center gap-1.5 font-semibold hover:text-slate-600 transition"><ArrowLeft className="h-3.5 w-3.5 -scale-x-100" /> <LocalizedText text="العودة للمنصة" /></Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/platform" className="flex items-center gap-2.5 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-white"><Building2 className="h-5 w-5" /></span>
            <span><LocalizedText text="نخبة التطوير" /> <span className="text-slate-400 font-medium">· <LocalizedText text="Company platform" /></span></span>
          </Link>
          <LanguageToggle /><Link href={withLocale(REDIRECTS.signInUrl, locale)} className="text-sm font-semibold text-[#1E5A99] hover:text-[#174a7e] transition"><LocalizedText text="لديك حساب؟ دخول" /></Link>
        </div>
      </header>

      <section className="mx-auto max-w-xl px-6 py-14">
        <Link href="/platform" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition mb-8"><ArrowLeft className="h-4 w-4 -scale-x-100" /> <LocalizedText text="العودة للمنصة" /></Link>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
          <div className="mb-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#1E5A99]/20 bg-[#1E5A99]/5 px-3.5 py-1.5 text-xs font-bold text-[#1E5A99]"><LocalizedText text="تجربة مجانية 14 يوم" /></span>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight"><LocalizedText text="أنشئ مساحة عمل شركتك" /></h1>
            <p className="mt-2 text-sm leading-6 text-slate-500"><LocalizedText text="اسم الشركة، الدومين، والهوية البصرية — ثم تدخل عبر صفحة الدخول الرئيسية." /></p>
          </div>

          {error && <div role="alert" className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{ui(error)}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label htmlFor="registration-company" className="mb-2 block text-sm font-bold"><LocalizedText text="اسم الشركة *" /></label><input id="registration-company" required type="text" value={formData.company_name} onChange={e => setFormData({ ...formData, company_name: e.target.value })} className={inputCls} placeholder={ui("مثال: أكمي للوجستيات")} /></div>
            <div><label htmlFor="registration-domain" className="mb-2 block text-sm font-bold"><LocalizedText text="دومين الشركة *" /></label><input id="registration-domain" required type="text" value={formData.domain} onChange={e => setFormData({ ...formData, domain: e.target.value })} className={inputCls} placeholder="acme.com" dir="ltr" /></div>
            <div><label htmlFor="registration-email" className="mb-2 block text-sm font-bold"><LocalizedText text="البريد الإلكتروني للعمل *" /></label><input id="registration-email" required type="email" autoComplete="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className={inputCls} placeholder="you@company.com" dir="ltr" /></div>
            <div><label className="mb-2 block text-sm font-bold" htmlFor="registration-password"><LocalizedText text="كلمة المرور *" /></label><input id="registration-password" required type="password" autoComplete="new-password" aria-describedby="registration-password-policy" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} className={inputCls} placeholder={ui("10 أحرف على الأقل (أحرف وأرقام)")} minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} /><p id="registration-password-policy" className="mt-2 text-sm text-muted-foreground">{newPasswordHint(locale)}</p></div>
            <div><label className="mb-2 block text-sm font-bold"><LocalizedText text="رابط شعار الشركة" /></label><input type="url" value={formData.logo_url} onChange={e => setFormData({ ...formData, logo_url: e.target.value })} className={inputCls} placeholder="https://cdn.example.com/logo.png" dir="ltr" /><p className="mt-1.5 text-xs text-slate-400"><LocalizedText text="ارفع الشعار إلى CDN والصق الرابط هنا." /></p></div>
            <div><label className="mb-2 block text-sm font-bold"><LocalizedText text="لون العلامة" /></label><div className="flex items-center gap-3"><input type="color" value={formData.brand_colors} onChange={e => setFormData({ ...formData, brand_colors: e.target.value })} className="h-11 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white" /><input type="text" value={formData.brand_colors} onChange={e => setFormData({ ...formData, brand_colors: e.target.value })} className={inputCls} dir="ltr" /></div></div>
            <div className="pt-3"><button disabled={loading} type="submit" className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-6 py-3.5 font-bold text-white shadow-lg shadow-[#1E5A99]/25 transition hover:shadow-xl hover:shadow-[#1E5A99]/35 disabled:opacity-60">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} {locale === 'ar' ? (loading ? 'جارٍ إنشاء المساحة…' : 'أنشئ المساحة') : (loading ? 'Creating workspace…' : 'Create workspace')} {!loading && <ArrowRight className="h-4 w-4 -scale-x-100 transition-transform group-hover:-translate-x-0.5" />}</button></div>
            <p className="text-center text-xs leading-5 text-slate-400"><LocalizedText text="بالتسجيل أنت توافق على الشروط وسياسة الخصوصية. بعدها تسجّل الدخول من الصفحة الرئيسية مع التحقق بخطوتين." /></p>
          </form>
        </div>
      </section>
    </main>
  );
}
