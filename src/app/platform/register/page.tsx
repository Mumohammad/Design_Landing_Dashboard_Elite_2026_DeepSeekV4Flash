'use client';

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowRight, Loader2, CheckCircle2, ArrowLeft, MailCheck, ImageIcon } from 'lucide-react';
import { LOGO_ACCEPT, prepareLogoFile, logoPrepMessage } from '@/lib/branding/logo-client';
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
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoWarning, setLogoWarning] = useState('');
  const logoGeneration = useRef(0);
  const [formData, setFormData] = useState({
    company_name: '',
    domain: '',
    email: '',
    password: '',
    logo_base64: '',
    brand_colors: '#1E5A99',
  });

  const loading = state.kind === 'submitting';
  const done = state.kind === 'needs_confirmation' || state.kind === 'ready_to_sign_in';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || done || logoBusy) return;
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
      const warning = locale === 'ar' ? data.logo_message_ar : data.logo_message_en;
      setLogoWarning(warning || '');
      if (data.requires_confirmation) {
        // Email confirmation enabled → "check your inbox" step.
        setState({ kind: 'needs_confirmation' });
      } else {
        // Confirmation disabled → straight to sign-in with a success banner.
        // Full-page nav to the centralized sign-in URL: relative in single-host
        // mode, absolute (dashboard deployment) in the two-host production
        // topology. Deterministic — no dependence on client-router redirects.
        if (warning) setState({ kind: 'ready_to_sign_in' });
        else window.location.replace(withLocale(REDIRECTS.signInUrl + '?registered=1', locale));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setState({ kind: 'idle' });
    }
  };

  const inputCls = 'h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors';

  if (done) {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b border-border bg-background">
          <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
            <Link href="/platform" className="flex items-center gap-2.5 font-bold">
              <span className="flex h-9 w-9 items-center justify-center text-primary"><Building2 className="h-5 w-5" /></span>
              <span><LocalizedText text="نخبة التطوير" /> <span className="hidden font-normal text-muted-foreground sm:inline">· <LocalizedText text="Company platform" /></span></span>
            </Link>
            <LanguageToggle /><Link href={withLocale(REDIRECTS.signInUrl, locale)} className="text-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"><LocalizedText text="لديك حساب؟ دخول" /></Link>
          </div>
        </header>

        <section className="mx-auto max-w-xl px-6 py-20 text-center">
          {state.kind === 'needs_confirmation' ? (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center text-emerald-700 dark:text-emerald-300">
                <MailCheck className="h-8 w-8 text-emerald-700 dark:text-emerald-300" />
              </span>
              <h1 className="mt-6 text-2xl font-semibold tracking-tight"><LocalizedText text="أنشئت مساحة العمل — أكّد بريدك" /></h1>
              <p className="mt-3 text-sm leading-7 text-muted-foreground"><LocalizedText text="أرسلنا رابط تأكيد إلى" /><span dir="ltr" className="font-bold text-foreground">{registeredEmail}</span><LocalizedText text=". افتح الرسالة واضغط «تأكيد البريد» لتفعيل حسابك، ثم سجّل الدخول من صفحة الدخول الرئيسية." /></p>
              <div className="mt-8 rounded-lg border border-border bg-card p-5 text-start">
                <p className="text-xs font-bold text-muted-foreground"><LocalizedText text="لم يصلك البريد؟" /></p>
                <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted-foreground">
                  <li><LocalizedText text="• تحقق من مجلد الرسائل غير المرغوبية (Spam)." /></li>
                  <li><LocalizedText text="• انتظر دقيقة أو دقيقتين — أحياناً يتأخر التسليم." /></li>
                  <li><LocalizedText text="• ما زال غير موجود؟ استخدم" /> <Link href="/auth/forgot-password" className="font-bold text-foreground hover:underline"><LocalizedText text="استعادة كلمة المرور" /></Link> <LocalizedText text="لإرسال رابط جديد، أو تواصل مع الدعم." /></li>
                </ul>
              </div>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push(withLocale(REDIRECTS.signInUrl, locale))}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground hover:bg-foreground/90 px-6 py-3.5 font-medium text-background transition-colors"
                ><LocalizedText text="الانتقال لتسجيل الدخول" /><ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-8 w-8 text-emerald-700 dark:text-emerald-300" />
              </span>
              <h1 className="mt-6 text-2xl font-semibold tracking-tight"><LocalizedText text="تم إنشاء مساحة عمل شركتك 🎉" /></h1>
              <p className="mt-3 text-sm leading-7 text-muted-foreground"><LocalizedText text="كل شيء جاهز — سجّل الدخول الآن بكلمة المرور التي أنشأتها للتو." /></p>
              <div className="mt-8">
                <button
                  type="button"
                  onClick={() => router.push(withLocale(REDIRECTS.signInUrl, locale))}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground hover:bg-foreground/90 px-6 py-3.5 font-medium text-background transition-colors"
                ><LocalizedText text="تسجيل الدخول الآن" /><ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
          {logoWarning && <p role="status" className="mt-6 rounded-lg border border-border p-4 text-sm text-foreground">{logoWarning}</p>}
          <p className="mt-6 text-xs text-muted-foreground">
            <Link href="/platform" className="inline-flex items-center gap-1.5 font-semibold hover:text-foreground transition"><ArrowLeft className="h-3.5 w-3.5 -scale-x-100" /> <LocalizedText text="العودة للمنصة" /></Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <Link href="/platform" className="flex items-center gap-2.5 font-bold">
            <span className="flex h-9 w-9 items-center justify-center text-primary"><Building2 className="h-5 w-5" /></span>
            <span><LocalizedText text="نخبة التطوير" /> <span className="hidden font-normal text-muted-foreground sm:inline">· <LocalizedText text="Company platform" /></span></span>
          </Link>
          <LanguageToggle /><Link href={withLocale(REDIRECTS.signInUrl, locale)} className="text-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"><LocalizedText text="لديك حساب؟ دخول" /></Link>
        </div>
      </header>

      <section className="mx-auto max-w-xl px-6 py-14">
        <Link href="/platform" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition mb-8"><ArrowLeft className="h-4 w-4 -scale-x-100" /> <LocalizedText text="العودة للمنصة" /></Link>

        <div className="rounded-lg border border-border bg-card p-5 sm:p-8">
          <div className="mb-8">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"><LocalizedText text="تجربة مجانية 14 يوم" /></span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight"><LocalizedText text="أنشئ مساحة عمل شركتك" /></h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground"><LocalizedText text="اسم الشركة، الدومين، والهوية البصرية — ثم تدخل عبر صفحة الدخول الرئيسية." /></p>
          </div>

          {error && <div role="alert" className="mb-6 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm font-medium text-destructive">{ui(error)}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label htmlFor="registration-company" className="mb-2 block text-sm font-medium"><LocalizedText text="اسم الشركة *" /></label><input id="registration-company" required type="text" value={formData.company_name} onChange={e => setFormData(previous => ({ ...previous, company_name: e.target.value }))} className={inputCls} placeholder={ui("مثال: أكمي للوجستيات")} /></div>
            <div><label htmlFor="registration-domain" className="mb-2 block text-sm font-medium"><LocalizedText text="دومين الشركة *" /></label><input id="registration-domain" required type="text" value={formData.domain} onChange={e => setFormData(previous => ({ ...previous, domain: e.target.value }))} className={inputCls} placeholder="acme.com" dir="ltr" /></div>
            <div><label htmlFor="registration-email" className="mb-2 block text-sm font-medium"><LocalizedText text="البريد الإلكتروني للعمل *" /></label><input id="registration-email" required type="email" autoComplete="email" value={formData.email} onChange={e => setFormData(previous => ({ ...previous, email: e.target.value }))} className={inputCls} placeholder="you@company.com" dir="ltr" /></div>
            <div><label className="mb-2 block text-sm font-medium" htmlFor="registration-password"><LocalizedText text="كلمة المرور *" /></label><input id="registration-password" required type="password" autoComplete="new-password" aria-describedby="registration-password-policy" value={formData.password} onChange={e => setFormData(previous => ({ ...previous, password: e.target.value }))} className={inputCls} placeholder={ui("10 أحرف على الأقل (أحرف وأرقام)")} minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} /><p id="registration-password-policy" className="mt-2 text-sm text-muted-foreground">{newPasswordHint(locale)}</p></div>
            <div><label htmlFor="registration-logo" className="mb-2 block text-sm font-medium">{locale === 'ar' ? 'شعار الشركة' : 'Company logo'}</label>
              <div className="flex items-center gap-3"><div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border">
                {formData.logo_base64 ? <img src={formData.logo_base64} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="h-6 w-6 text-muted-foreground" />}</div>
                <input id="registration-logo" type="file" accept={LOGO_ACCEPT} disabled={loading} aria-describedby="registration-logo-hint" onChange={async event => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  const generation = ++logoGeneration.current;
                  setFormData(previous => ({...previous,logo_base64:''}));
                  if (!file) { setLogoBusy(false); return; }
                  setLogoBusy(true);
                  try {
                    const prepared = await prepareLogoFile(file);
                    if (generation !== logoGeneration.current) return;
                    if (!prepared.ok) { input.value = ''; setError(logoPrepMessage(prepared.error,locale === 'ar')); return; }
                    setError('');
                    setFormData(previous => ({...previous,logo_base64:prepared.dataUrl}));
                  } finally { if (generation === logoGeneration.current) setLogoBusy(false); }
                }} className="block min-w-0 w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-foreground" />
              </div><p id="registration-logo-hint" className="mt-2 text-sm text-muted-foreground">{logoBusy ? (locale === 'ar' ? 'جارٍ تجهيز الشعار…' : 'Preparing logo…') : (locale === 'ar' ? 'PNG أو JPEG أو WebP حتى 5 ميجابايت. أضفه من الإعدادات بعد إنشاء الحساب وتسجيل الدخول.' : 'PNG, JPEG or WebP up to 5 MB. Add it from Settings after creating your account and signing in.')}</p></div>
            <div><label className="mb-2 block text-sm font-medium"><LocalizedText text="لون العلامة" /></label><div className="flex items-center gap-3"><input type="color" value={formData.brand_colors} onChange={e => setFormData(previous => ({ ...previous, brand_colors: e.target.value }))} className="h-11 w-16 cursor-pointer rounded-lg border border-input bg-background" /><input type="text" value={formData.brand_colors} onChange={e => setFormData(previous => ({ ...previous, brand_colors: e.target.value }))} className={inputCls} dir="ltr" /></div></div>
            <div className="pt-3"><button disabled={loading || logoBusy} type="submit" className="group flex w-full items-center justify-center gap-2 rounded-md bg-foreground hover:bg-foreground/90 px-6 py-3.5 font-medium text-background transition-colors disabled:opacity-60">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} {locale === 'ar' ? (loading ? 'جارٍ إنشاء المساحة…' : 'أنشئ المساحة') : (loading ? 'Creating workspace…' : 'Create workspace')} {!loading && <ArrowRight className="h-4 w-4 -scale-x-100 transition-transform group-hover:-translate-x-0.5" />}</button></div>
            <p className="text-center text-xs leading-5 text-muted-foreground"><LocalizedText text="بالتسجيل أنت توافق على الشروط وسياسة الخصوصية. بعدها تسجّل الدخول من الصفحة الرئيسية مع التحقق بخطوتين." /></p>
          </form>
        </div>
      </section>
    </main>
  );
}
