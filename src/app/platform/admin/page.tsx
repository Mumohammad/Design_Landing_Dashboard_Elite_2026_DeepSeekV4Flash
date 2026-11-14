'use client';

import { useTranslation } from "@/hooks/use-translation";
import { LanguageToggle } from "@/components/language-toggle";
import { LocalizedText, useUiText } from "@/components/localized-text"
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Users, Rocket, PauseCircle, PlayCircle, Plus, Search, Loader2,
  ShieldCheck, X, RefreshCw, ArrowLeft, LayoutDashboard, CreditCard,
  ScrollText, Pencil, Trash2, KeyRound, BadgeDollarSign, TrendingUp, MessageSquare,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/platform/browser';
import { createPlatformRequest } from '@/lib/platform/request';
import { loadPlatformUserChoices, canCreatePlatformUser, PlatformUserChoicesError, type PlatformUserChoices } from '@/lib/platform/user-choices';

type Stats = { total: number; active: number; suspended: number; terminated: number; trial: number; new_this_month: number };
type Company = {
  id: string; name_en: string; name_ar: string | null; slug: string | null; domain: string | null;
  logo_url: string | null; status: 'active' | 'suspended' | 'terminated'; plan: string;
  trial_ends_at: string | null; billing_status: string; created_at: string; users_count: number;
};
type AdminUser = { id: string; tenant_id: string; email: string; full_name_en: string | null; role: string; status: string; created_at: string; last_login_at: string | null; company_name: string; version: string; protected: boolean; tenant_active: boolean };
type Invoice = { id: string; tenant_id: string; invoice_number: string; period_label: string | null; amount: number; currency: string; status: string; due_date: string | null; paid_at: string | null; payment_method?: string | null; created_at: string; company_name: string };
type AuditEntry = { id: string; company_name: string; action: string; entity_type: string | null; module: string; created_at: string };
type Analytics = {
  registrations_by_day: { date: string; count: number }[];
  by_status: Record<string, number>; by_billing: Record<string, number>; by_plan: Record<string, number>;
  total_users: number; top_companies_by_users: { tenant_id: string; users: number; name: string }[];
};
type BillingSummary = { pending_amount: number; overdue_amount: number; paid_this_month: number; unpaid_companies: number };

type Section = 'overview' | 'companies' | 'users' | 'billing' | 'audit' | 'feedback';
type FeedbackEntry = { id: string; company_name: string; kind: 'bug' | 'idea' | 'question' | 'praise'; message: string; page_path: string | null; status: 'new' | 'triaged' | 'closed'; created_at: string };

const statusMeta: Record<string, { label: string; cls: string }> = {
  active: { label: 'نشطة', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' },
  suspended: { label: 'معلّقة', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
  terminated: { label: 'منتهية', cls: 'bg-slate-500/10 text-muted-foreground border-slate-500/25' },
};
const billingMeta: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'تجريبية', cls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25' },
  active_paid: { label: 'مدفوعة', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' },
  past_due: { label: 'متأخرة', cls: 'bg-orange-500/10 text-orange-800 dark:text-orange-300 border-orange-500/25' },
  unpaid: { label: 'غير مدفوعة', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
  cancelled: { label: 'ملغاة', cls: 'bg-slate-500/10 text-muted-foreground border-slate-500/25' },
};
const roleLabels: Record<string, string> = {
  general_manager: 'مدير عام', admin: 'مسؤول', accountant: 'محاسب', supervisor: 'مشرف',
  hr_officer: 'موارد بشرية', operations_officer: 'عمليات', payroll_officer: 'رواتب',
  platform_coordinator: 'منسق منصات', readonly_auditor: 'قارئ فقط',
};
const ROLES = Object.keys(roleLabels).filter(role => role !== 'general_manager');


export default function PlatformAdminPage() {
  const { locale } = useTranslation();
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-GB") : "—";
  const fmtMoney = (n: number) => new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(n);
  const ui = useUiText()
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'ready'>('checking');
  const [section, setSection] = useState<Section>('overview');

  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'trial' | 'suspended'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'create-company' | 'create-user' | 'create-invoice' | 'edit-company' | 'review-user'>(null);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const busyLock = useRef(false);
  const lifecycle = useRef({ mounted: false, generation: 0, choiceGeneration: 0 });
  useEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    return () => { state.mounted = false; state.generation++; state.choiceGeneration++; };
  }, []);
  const [authError, setAuthError] = useState(false);
  const [notice,setNotice]=useState('');
  const [creationPending,setCreationPending]=useState(false);
  const [userRoles,setUserRoles]=useState<{tenant_id:string;name:string}[]>([]);
  const [userChoices,setUserChoices]=useState<PlatformUserChoices|null>(null);
  const [userChoicesState,setUserChoicesState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [userChoicesFailure,setUserChoicesFailure]=useState<PlatformUserChoicesError|null>(null);
  const [userReview,setUserReview]=useState<{user:AdminUser;action:'role'|'status'|'archive'|'reset';value?:string}|null>(null);
  const [userReason,setUserReason]=useState('');
  const [companyForm, setCompanyForm] = useState({ company_name: '', domain: '', owner_email: '', owner_name: '' });
  const [userForm, setUserForm] = useState({ request_id:'', tenant_id: '', email: '', full_name: '', role: 'readonly_auditor', password: '' });
  const [invoiceForm, setInvoiceForm] = useState({ tenant_id: '', amount: '', period_label: '', due_date: '' });

  const api = useMemo(() => createPlatformRequest(() => getBrowserSupabase().auth.getSession(),locale),[locale]);

  const refreshUserChoices = useCallback(async () => {
    const request = ++lifecycle.current.choiceGeneration;
    setUserChoicesState('loading');setUserChoices(null);setUserChoicesFailure(null);
    try {
      const choices = await loadPlatformUserChoices(api);
      if (!lifecycle.current.mounted || request !== lifecycle.current.choiceGeneration) return;
      setUserChoices(choices);setUserChoicesState('ready');
    } catch(error) {
      if (!lifecycle.current.mounted || request !== lifecycle.current.choiceGeneration) return;
      setUserChoicesFailure(error instanceof PlatformUserChoicesError ? error : new PlatformUserChoicesError('companies'));
      setUserChoicesState('error');
    }
  },[api]);
  const createUserReady = userChoicesState==='ready' && canCreatePlatformUser(userChoices,userForm,ROLES);
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    const generation = ++lifecycle.current.generation;
    const result = await Promise.allSettled([
      api('/api/platform/admin/stats'),api('/api/platform/admin/companies'),api('/api/platform/admin/users'),
      api('/api/platform/admin/billing'),api('/api/platform/admin/analytics'),api('/api/platform/admin/audit'),
    ]);
    if (!lifecycle.current.mounted || generation !== lifecycle.current.generation || !isCurrent()) return;
    if(result[0].status==='fulfilled')setStats(result[0].value);
    if(result[1].status==='fulfilled')setCompanies(result[1].value.companies);
    if(result[2].status==='fulfilled'){setUsers(result[2].value.users);setUserRoles(result[2].value.active_roles??[]);}
    if(result[3].status==='fulfilled'){setInvoices(result[3].value.invoices);setBillingSummary(result[3].value.summary);}
    if(result[4].status==='fulfilled')setAnalytics(result[4].value);
    if(result[5].status==='fulfilled')setAudit(result[5].value.entries);
    // Support inbox loads independently so it never blocks the core console.
    api('/api/platform/admin/feedback').then((r) => { if (lifecycle.current.mounted) setFeedback(r.feedback ?? []) }, () => undefined);
    if(result.some(item=>item.status==='rejected'))throw Error('Some platform data could not be loaded.');
  }, [api]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const supabase = getBrowserSupabase();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if(current&&event==='SIGNED_OUT'){current=false;controller.abort();setPhase('checking');router.replace('/auth/sign-in');}
    });
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!current) return;
      if (!session?.access_token) { router.replace('/auth/sign-in'); return; }
      const res = await fetch('/api/platform/admin/me', { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal });
      if (!current) return;
      if (res.status === 401 || res.status === 403) { router.replace('/platform'); return; }
      if (!res.ok) throw new Error('Authority check unavailable');
      setPhase('ready');
    })().catch(() => { if (current) setAuthError(true); });
    return () => { current = false; controller.abort(); subscription.unsubscribe(); };
  }, [router]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let current = true;
    void (async () => {
      try { await load(() => current); }
      catch { if (current) setFormErr(locale==='ar'?'تعذر تحميل البيانات. أعد المحاولة.':'Data could not be loaded. Retry.'); }
    })();
    return () => { current = false; };
  }, [phase, load, locale]);

  const filtered = useMemo(() => {
    const now = new Date();
    return companies.filter(c => {
      const ms = !search || [c.name_en, c.name_ar ?? '', c.domain ?? '', c.slug ?? ''].join(' ').toLowerCase().includes(search.toLowerCase());
      const isTrial = c.trial_ends_at && new Date(c.trial_ends_at) > now;
      const mf = filter === 'all' || (filter === 'trial' ? isTrial : c.status === filter);
      return ms && mf;
    });
  }, [companies, search, filter]);

  async function companyAction(path: string, body: Record<string, unknown>, confirmMsg?: string) {
    if (busyLock.current) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    busyLock.current = true;
    setBusy(true); setFormErr('');
    try {
      await api(path, { method: path.endsWith('companies') && body.tenant_id && !body.company_name ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setModal(null); await load();
    } catch (e) { setFormErr(e instanceof Error ? e.message : ui("فشل")); } finally { busyLock.current = false; setBusy(false); }
  }

  async function userAction(method: string, body: Record<string, unknown>) {
    if(busyLock.current)return;
    busyLock.current=true;
    setBusy(true);setFormErr('');setNotice('');
    if(method==='POST')setCreationPending(true);
    try {
      const result=await api('/api/platform/admin/users',{method,body:JSON.stringify(body)});
      setModal(null);setUserReason('');setUserReview(null);
      if(method==='POST') {setCreationPending(false);setUserForm({request_id:'',tenant_id:'',email:'',full_name:'',role:'readonly_auditor',password:''});}
      setNotice(result.delivery==='queued'?(locale==='ar'?'تم إنشاء الدعوة وقبول طلب البريد للإرسال.':'Invitation created; email accepted for sending.'):
        result.delivery==='unavailable'||result.delivery==='unconfirmed'?(locale==='ar'?'الدعوة محفوظة؛ لم يتم تأكيد تسليم البريد. تحقق قبل إعادة الإرسال.':'Invitation saved; email delivery is unconfirmed. Check before resending.'):
        result.delivery==='requested'?(locale==='ar'?'تم طلب استعادة كلمة المرور؛ لم يتم تأكيد تسليم البريد.':'Password recovery requested; email delivery is unconfirmed.'):
        result.notice?(locale==='ar'?'تم الاحتفاظ بكلمة المرور الأصلية. استخدمها أو رابط نسيت كلمة المرور.':'The original password is preserved. Use it or Forgot password.'):
        (locale==='ar'?'تم حفظ التغيير.':'Change saved.'));
      try{await load();}catch{setFormErr(locale==='ar'?'تم الحفظ لكن تعذر تحديث القائمة. أعد التحميل.':'Saved, but the roster could not refresh. Reload.');}
    }catch(e){setFormErr(e instanceof Error?e.message:(locale==='ar'?'تعذر إكمال العملية.':'The operation could not be completed.'));if(method==='POST'&&e&&typeof e==='object'&&'status' in e&&typeof e.status==='number'&&e.status<500)setCreationPending(false);}
    finally{busyLock.current=false;setBusy(false);}
  }
  function reviewUser(user:AdminUser,action:'role'|'status'|'archive'|'reset',value?:string){
    if(busyLock.current||busy||user.protected||!user.tenant_active)return;
    setUserReview({user,action,value});setUserReason('');setFormErr('');setModal('review-user');
  }

  async function toggleStatus(c: Company) {
    if (busyLock.current || busyId) return;
    const next = c.status === 'suspended' ? 'active' : 'suspended';
    if (!confirm(locale === "ar" ? (next === 'suspended' ? `تعليق «${c.name_en}»؟` : `تفعيل «${c.name_en}»؟`) : `${next === "suspended" ? "Suspend" : "Activate"} “${c.name_en}”?`)) return;
    busyLock.current = true;
    setBusyId(c.id);
    try { await api('/api/platform/admin/update-status', { method: 'POST', body: JSON.stringify({ tenant_id: c.id, status: next }) }); await load(); }
    catch { setFormErr(locale==='ar'?'تعذر تأكيد تغيير الحالة. حدّث البيانات قبل إعادة المحاولة.':'The status change could not be confirmed. Refresh before retrying.'); }
    finally { busyLock.current = false; setBusyId(null); }
  }

  if (phase !== 'ready') {
    return (
      <main  className="flex min-h-dvh items-center justify-center bg-background text-foreground">
        {authError ? <div role="alert" className="space-y-3 p-6 text-center text-sm"><p>{locale==='ar'?'تعذر التحقق من الصلاحيات. أعد المحاولة.':'Access could not be verified. Try again.'}</p><button type="button" className="rounded-lg border border-input px-4 py-2" onClick={() => window.location.reload()}>{locale==='ar'?'أعد المحاولة':'Try again'}</button></div> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /><LocalizedText text="جارٍ التحقق من الصلاحيات…" /></div>}
      </main>
    );
  }

  const nav: { key: Section; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { key: 'overview', label: ui("نظرة عامة"), icon: LayoutDashboard },
    { key: 'companies', label: ui("الشركات"), icon: Building2, count: companies.length },
    { key: 'users', label: ui("المستخدمون"), icon: Users, count: users.length },
    { key: 'billing', label: ui("الفوترة"), icon: CreditCard, count: billingSummary?.unpaid_companies },
    { key: 'audit', label: ui("سجل النشاط"), icon: ScrollText },
    { key: 'feedback', label: locale === 'ar' ? 'ملاحظات العملاء' : 'Customer feedback', icon: MessageSquare, count: feedback.filter(f => f.status === 'new').length },
  ];

  const maxReg = Math.max(1, ...(analytics?.registrations_by_day.map(d => d.count) ?? [1]));

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh flex-col md:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-background md:sticky md:top-0 md:h-dvh md:w-60 md:border-b-0 md:border-e">
          <div className="flex items-center gap-3 border-b border-border px-5 py-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground"><ShieldCheck className="h-5 w-5" /></span>
            <div className="leading-tight"><p className="text-sm font-medium"><LocalizedText text="إدارة المنصة" /></p><p className="text-xs text-muted-foreground">SaaS Control</p></div>
          </div>
          <div className="px-3"><LanguageToggle /></div>
          <nav className="flex flex-wrap gap-1 p-3 md:flex-1 md:flex-col md:content-stretch">
            {nav.map(n => (
              <button data-testid={n.key==='users'?'platform-users-tab':undefined} key={n.key} onClick={() => setSection(n.key)} className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 md:w-full text-sm font-medium transition ${section === n.key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <n.icon className="h-4 w-4" /> {ui(n.label)}
                {n.count !== undefined && <span className="ms-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{n.count}</span>}
              </button>
            ))}
          </nav>
          <div className="border-t border-border p-3">
            <Link href="/platform" className="flex items-center gap-2 rounded-md px-3.5 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"><ArrowLeft className="h-4 w-4 -scale-x-100" /> <LocalizedText text="العودة للمنصة" /></Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background px-6">
            <h1 className="text-lg font-semibold">{nav.find(n => n.key === section)?.label}</h1>
            <button onClick={() => {setFormErr('');load().catch(()=>setFormErr(locale==='ar'?'تعذر تحميل البيانات. أعد المحاولة.':'Data could not be loaded. Retry.'));}} className="rounded-lg border border-border bg-muted p-2 transition hover:bg-muted" title={ui("تحديث")}><RefreshCw className="h-4 w-4" /></button>
          </header>

          <div className="p-4 sm:p-6">
            {!modal&&formErr&&<div role="alert" className="mb-5 rounded-md border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{formErr}<button className="ms-3 underline" onClick={()=>{setFormErr('');load().catch(()=>setFormErr(locale==='ar'?'تعذر تحديث القائمة.':'The roster could not refresh.'));}}>{locale==='ar'?'إعادة المحاولة':'Retry'}</button></div>}
            {notice&&<p role="status" className="mb-5 rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
            {section === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
                  {stats && [
                    { label: ui("إجمالي الشركات"), value: stats.total, icon: Building2 },
                    { label: ui("نشطة"), value: stats.active, icon: PlayCircle },
                    { label: ui("في التجربة"), value: stats.trial, icon: Rocket },
                    { label: ui("معلّقة"), value: stats.suspended, icon: PauseCircle },
                    { label: ui("غير مدفوعة"), value: billingSummary?.unpaid_companies ?? 0, icon: BadgeDollarSign },
                    { label: ui("جديدة هذا الشهر"), value: stats.new_this_month, icon: TrendingUp },
                  ].map(c => (
                    <div key={c.label} className="bg-card p-5">
                      <p className="text-3xl font-medium tabular-nums">{c.value}</p>
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">{ui(c.label)}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="rounded-lg border border-border bg-card p-6 lg:col-span-3">
                    <p className="text-sm font-medium"><LocalizedText text="التسجيلات — آخر 30 يومًا" /></p>
                    <div className="mt-5 flex h-36 items-end gap-1">
                      {(analytics?.registrations_by_day ?? []).map(d => (
                        <div key={d.date} className="group relative flex-1 rounded-t bg-elite-blue-500 transition-colors hover:bg-elite-blue-600" style={{ height: `${(d.count / maxReg) * 100}%` }} title={`${d.date}: ${d.count}`}></div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-6 lg:col-span-2">
                    <p className="text-sm font-medium"><LocalizedText text="أكبر الشركات بالمستخدمين" /></p>
                    <div className="mt-4 space-y-3">
                      {(analytics?.top_companies_by_users ?? []).map(t => (
                        <div key={t.tenant_id} className="flex items-center justify-between text-sm">
                          <span className="truncate font-semibold text-foreground">{t.name}</span>
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs tabular-nums">{t.users}</span>
                        </div>
                      ))}
                      {!(analytics?.top_companies_by_users?.length) && <p className="text-xs text-muted-foreground"><LocalizedText text="لا بيانات بعد" /></p>}
                    </div>
                    <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground"><LocalizedText text="إجمالي المستخدمين:" /><span className="font-semibold text-foreground tabular-nums">{analytics?.total_users ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {section === 'companies' && (
              <div className="rounded-lg border border-border bg-card">
                <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
                  <div><h2 className="text-lg font-semibold"><LocalizedText text="الشركات المسجلة" /></h2><p className="mt-0.5 text-xs text-muted-foreground">{filtered.length} <LocalizedText text="من" /> {companies.length}</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder={ui("بحث…")} className="w-48 rounded-md border border-border bg-background py-2.5 pe-3 ps-9 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
                    </div>
                    <div className="flex overflow-hidden rounded-md border border-border">
                      {([['all', ui("الكل")], ['active', ui("نشطة")], ['trial', ui("تجريبية")], ['suspended', ui("معلّقة")]] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setFilter(k)} className={`px-3 py-2 text-xs font-medium transition ${filter === k ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted'}`}>{l}</button>
                      ))}
                    </div>
                    <button disabled={busy} onClick={() => { if(busyLock.current)return; setFormErr(''); setModal('create-company'); }} className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-2.5 text-sm font-medium transition-colors"><Plus className="h-4 w-4" /><LocalizedText text="إضافة شركة" /></button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-start">
                    <thead><tr className="border-b border-border text-xs font-normal text-muted-foreground">
                      <th className="px-5 py-3.5"><LocalizedText text="الشركة" /></th><th className="px-5 py-3.5"><LocalizedText text="الدومين" /></th><th className="px-5 py-3.5"><LocalizedText text="الحالة" /></th><th className="px-5 py-3.5"><LocalizedText text="الفوترة" /></th><th className="px-5 py-3.5"><LocalizedText text="المستخدمون" /></th><th className="px-5 py-3.5"><LocalizedText text="التسجيل" /></th><th className="px-5 py-3.5"><LocalizedText text="إجراءات" /></th>
                    </tr></thead>
                    <tbody>
                      {filtered.map(c => {
                        const isTrial = c.trial_ends_at && new Date(c.trial_ends_at) > new Date();
                        const meta = statusMeta[c.status] ?? statusMeta.terminated;
                        const bMeta = billingMeta[c.billing_status] ?? billingMeta.trialing;
                        return (
                          <tr key={c.id} className="border-b border-border text-sm transition hover:bg-muted">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                {c.logo_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.logo_url} alt="" className="h-9 w-9 rounded-md border border-border object-cover" />
                                ) : (
                                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground text-sm font-semibold">{(c.name_en || '؟').charAt(0)}</span>
                                )}
                                <div className="leading-tight"><p className="font-medium">{c.name_en}</p><p className="text-xs text-muted-foreground">{c.slug ?? '—'}</p></div>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-muted-foreground" dir="ltr">{c.domain ?? '—'}</td>
                            <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${meta.cls}`}>{meta.label}</span></td>
                            <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${isTrial ? billingMeta.trialing.cls : bMeta.cls}`}>{isTrial ? ui("تجريبية") : bMeta.label}</span></td>
                            <td className="px-5 py-4 tabular-nums text-muted-foreground">{c.users_count}</td>
                            <td className="px-5 py-4 text-xs text-muted-foreground">{fmtDate(c.created_at)}</td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-1.5">
                                <button disabled={busy} onClick={() => { if(busyLock.current)return; setEditTarget(c); setFormErr(''); setModal('edit-company'); }} className="rounded-lg bg-muted p-1.5 text-muted-foreground transition hover:bg-white/15 hover:text-foreground" title={ui("تعديل")}><Pencil className="h-3.5 w-3.5" /></button>
                                <button disabled={busyId === c.id || c.status === 'terminated'} onClick={() => toggleStatus(c)} className={`rounded-lg p-1.5 transition disabled:opacity-40 ${c.status === 'suspended' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-500/25'}`} title={c.status === 'suspended' ? ui("تفعيل") : ui("تعليق")}>
                                  {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.status === 'suspended' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                                </button>
                                <button disabled={busyId === c.id} onClick={() => companyAction('/api/platform/admin/companies', { tenant_id: c.id }, locale === "ar" ? `أرشفة «${c.name_en}»؟` : `Archive “${c.name_en}”?`)} className="rounded-lg bg-rose-500/15 p-1.5 text-rose-700 dark:text-rose-300 transition hover:bg-rose-500/25" title={ui("حذف")}><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && <tr><td colSpan={7} className="px-5 py-14 text-center text-sm text-muted-foreground"><LocalizedText text="لا توجد شركات مطابقة" /></td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {section === 'users' && (
              <div data-testid="platform-users" className="rounded-lg border border-border bg-card">
                <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
                  <div><h2 className="text-lg font-semibold"><LocalizedText text="كل المستخدمين" /></h2><p className="mt-0.5 text-xs text-muted-foreground">{users.length}<LocalizedText text="مستخدم عبر" />{companies.length}<LocalizedText text="شركة" /></p></div>
                  <button data-testid="platform-user-create" disabled={busy} onClick={() => { if(busyLock.current)return; if(!userForm.request_id)setUserForm({...userForm,request_id:crypto.randomUUID(),tenant_id:'',role:'readonly_auditor'}); setFormErr(''); setModal('create-user'); void refreshUserChoices(); }} className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-2.5 text-sm font-medium transition-colors"><Plus className="h-4 w-4" /><LocalizedText text="إنشاء مستخدم" /></button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-start">
                    <thead><tr className="border-b border-border text-xs font-normal text-muted-foreground">
                      <th className="px-5 py-3.5"><LocalizedText text="المستخدم" /></th><th className="px-5 py-3.5"><LocalizedText text="الشركة" /></th><th className="px-5 py-3.5"><LocalizedText text="الدور" /></th><th className="px-5 py-3.5"><LocalizedText text="الحالة" /></th><th className="px-5 py-3.5"><LocalizedText text="آخر دخول" /></th><th className="px-5 py-3.5"><LocalizedText text="إجراءات" /></th>
                    </tr></thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} data-testid="platform-user-row" data-user-id={u.id} className="border-b border-border text-sm transition hover:bg-muted">
                          <td className="px-5 py-4"><div className="leading-tight"><p className="font-medium">{u.full_name_en || u.email}</p><p className="text-xs text-muted-foreground" dir="ltr">{u.email}</p></div></td>
                          <td className="px-5 py-4 text-muted-foreground">{u.company_name}</td>
                          <td className="px-5 py-4">
                            <select aria-label={locale==='ar'?'دور المستخدم':'User role'} disabled={busy||u.protected||!u.tenant_active||u.status==='terminated'} value={u.role} onChange={e => reviewUser(u,'role',e.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20">
                              {u.role==='general_manager'&&<option value="general_manager">{ui(roleLabels.general_manager)}</option>}{userRoles.filter(r=>r.tenant_id===u.tenant_id&&ROLES.includes(r.name)).map(r=><option key={r.name} value={r.name}>{ui(roleLabels[r.name]??r.name)}</option>)}
                            </select>
                          </td>
                          <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${u.status === 'active' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-500/25 bg-slate-500/10 text-muted-foreground'}`}>{u.status === 'active' ? ui("نشط") : u.status === 'pending_invite' ? ui("بانتظار القبول") : u.status === 'locked' ? ui("مقفل") : u.status === 'terminated' ? ui("موقوف") : u.status}</span></td>
                          <td className="px-5 py-4 text-xs text-muted-foreground">{u.last_login_at ? fmtDate(u.last_login_at) : ui("لم يدخل")}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1.5">
                              <button data-testid="platform-user-reset" disabled={busy||u.protected||!u.tenant_active||u.status!=='active'} onClick={()=>reviewUser(u,'reset')} className="rounded-lg bg-muted p-1.5 text-muted-foreground transition hover:bg-white/15 hover:text-foreground disabled:opacity-40" title={locale==='ar'?'استعادة كلمة المرور':'Password recovery'} aria-label={locale==='ar'?'استعادة كلمة المرور':'Password recovery'}><KeyRound className="h-3.5 w-3.5" /></button>
                              {(u.status==='active'||u.status==='inactive'||u.status==='locked')&&<button data-testid="platform-user-status" disabled={busy||u.protected||!u.tenant_active} onClick={()=>reviewUser(u,'status',u.status==='active'?'inactive':'active')} className="rounded-lg bg-amber-500/15 p-1.5 text-amber-300 disabled:opacity-40" aria-label={u.status==='active'?(locale==='ar'?'إيقاف التفعيل':'Deactivate'):(locale==='ar'?'تفعيل':'Activate')} title={u.status==='active'?(locale==='ar'?'إيقاف التفعيل':'Deactivate'):(locale==='ar'?'تفعيل':'Activate')}><PauseCircle className="h-3.5 w-3.5" /></button>}
                              {(u.status==='inactive'||u.status==='terminated')&&<button data-testid="platform-user-archive" disabled={busy||u.protected||!u.tenant_active} onClick={()=>reviewUser(u,'archive')} className="rounded-lg bg-rose-500/15 p-1.5 text-rose-700 dark:text-rose-300 disabled:opacity-40" aria-label={locale==='ar'?'أرشفة':'Archive'} title={locale==='ar'?'أرشفة':'Archive'}><Trash2 className="h-3.5 w-3.5" /></button>}

                            </div>
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && <tr><td colSpan={6} className="px-5 py-14 text-center text-sm text-muted-foreground"><LocalizedText text="لا مستخدمين بعد" /></td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {section === 'billing' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {billingSummary && [
                    { label: ui("معلّق التحصيل"), value: fmtMoney(billingSummary.pending_amount) },
                    { label: ui("متأخر"), value: fmtMoney(billingSummary.overdue_amount) },
                    { label: ui("محصّل هذا الشهر"), value: fmtMoney(billingSummary.paid_this_month) },
                    { label: ui("شركات غير مدفوعة"), value: billingSummary.unpaid_companies },
                  ].map(c => (
                    <div key={c.label} className="bg-card p-5">
                      <div className="h-1.5 w-10 rounded-full bg-foreground"></div>
                      <p className="mt-4 text-2xl font-semibold tabular-nums">{c.value}</p>
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">{ui(c.label)}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border p-5">
                    <h2 className="text-lg font-semibold"><LocalizedText text="فواتير المنصة" /></h2>
                    <button disabled={busy} onClick={() => { if(busyLock.current)return; setInvoiceForm({ ...invoiceForm, tenant_id: companies[0]?.id ?? '' }); setFormErr(''); setModal('create-invoice'); }} className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-2.5 text-sm font-medium transition-colors"><Plus className="h-4 w-4" /><LocalizedText text="فاتورة جديدة" /></button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-start">
                      <thead><tr className="border-b border-border text-xs font-normal text-muted-foreground">
                        <th className="px-5 py-3.5"><LocalizedText text="الفاتورة" /></th><th className="px-5 py-3.5"><LocalizedText text="الشركة" /></th><th className="px-5 py-3.5"><LocalizedText text="المبلغ" /></th><th className="px-5 py-3.5"><LocalizedText text="الاستحقاق" /></th><th className="px-5 py-3.5"><LocalizedText text="الحالة" /></th><th className="px-5 py-3.5"><LocalizedText text="إجراء" /></th>
                      </tr></thead>
                      <tbody>
                        {invoices.map(i => (
                          <tr key={i.id} className="border-b border-border text-sm transition hover:bg-muted">
                            <td className="px-5 py-4 font-mono text-xs font-medium text-foreground" dir="ltr">{i.invoice_number}</td>
                            <td className="px-5 py-4">{i.company_name}</td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums">{fmtMoney(Number(i.amount))}</td>
                            <td className="px-5 py-4 text-xs text-muted-foreground">{fmtDate(i.due_date)}</td>
                            <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${i.status === 'paid' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : i.status === 'overdue' ? 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>{i.status === 'paid' ? ui("مدفوعة") : i.status === 'overdue' ? ui("متأخرة") : i.status === 'void' ? 'ملغاة' : ui("معلّقة")}</span>{i.status === 'paid' && i.payment_method === 'card' && <span className="ms-2 text-xs text-muted-foreground">{ui("بطاقة")}</span>}</td>
                            <td className="px-5 py-4">
                              {i.status !== 'paid' && i.status !== 'void' && (
                                <button disabled={busyId === i.id} onClick={async () => { if (!confirm(ui("تأكيد استلام الدفع؟"))) return; setBusyId(i.id); try { await api('/api/platform/admin/billing', { method: 'PATCH', body: JSON.stringify({ invoice_id: i.id, action: 'mark_paid' }) }); await load(); } finally { setBusyId(null); } }} className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40">
                                  {busyId === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ui("تأكيد الدفع")}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {invoices.length === 0 && <tr><td colSpan={6} className="px-5 py-14 text-center text-sm text-muted-foreground"><LocalizedText text="لا فواتير بعد — أنشئ أول فاتورة" /></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {section === 'audit' && (
              <div className="rounded-lg border border-border bg-card p-6">
                <h2 className="text-lg font-semibold"><LocalizedText text="أحدث إجراءات المنصة" /></h2>
                <div className="mt-5 space-y-2">
                  {audit.map(e => (
                    <div key={e.id} className="flex items-center gap-4 rounded-md border border-border bg-muted px-4 py-3 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">{e.action}</p>
                        <p className="text-xs text-muted-foreground">{e.company_name} · {e.module}{e.entity_type ? ` · ${e.entity_type}` : ''}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{new Date(e.created_at).toLocaleString('ar-SA')}</span>
                    </div>
                  ))}
                  {audit.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground"><LocalizedText text="لا نشاط بعد" /></p>}
                </div>
              </div>
            )}

            {section === 'feedback' && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6" data-testid="platform-feedback">
                <h2 className="text-lg font-extrabold">{locale === 'ar' ? 'ملاحظات العملاء' : 'Customer feedback'}</h2>
                <div className="mt-5 space-y-2">
                  {feedback.map(f => (
                    <div key={f.id} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-bold">{({ bug: locale === 'ar' ? 'مشكلة' : 'Bug', idea: locale === 'ar' ? 'اقتراح' : 'Idea', question: locale === 'ar' ? 'سؤال' : 'Question', praise: locale === 'ar' ? 'إشادة' : 'Praise' })[f.kind]}</span>
                        <span className="font-semibold text-white/85">{f.company_name}</span>
                        {f.page_path && <span className="font-mono text-[11px] text-white/40" dir="ltr">{f.page_path}</span>}
                        <span className="ms-auto text-[11px] text-white/35 tabular-nums">{new Date(f.created_at).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-GB')}</span>
                        <select
                          value={f.status}
                          aria-label={locale === 'ar' ? 'الحالة' : 'Status'}
                          onChange={async (e) => {
                            const status = e.target.value as FeedbackEntry['status'];
                            try {
                              await api('/api/platform/admin/feedback', { method: 'PATCH', body: JSON.stringify({ id: f.id, status }) });
                              setFeedback(list => list.map(x => (x.id === f.id ? { ...x, status } : x)));
                            } catch { /* keep previous status */ }
                          }}
                          className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs"
                        >
                          <option value="new">{locale === 'ar' ? 'جديد' : 'New'}</option>
                          <option value="triaged">{locale === 'ar' ? 'قيد المعالجة' : 'Triaged'}</option>
                          <option value="closed">{locale === 'ar' ? 'مغلق' : 'Closed'}</option>
                        </select>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-white/70">{f.message}</p>
                    </div>
                  ))}
                  {feedback.length === 0 && <p className="py-10 text-center text-sm text-white/35">{locale === 'ar' ? 'لا ملاحظات بعد' : 'No feedback yet'}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { if(!busyLock.current)setModal(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="platform-admin-dialog-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-popover p-7 shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 id="platform-admin-dialog-title" className="text-lg font-semibold">
                {modal === 'create-company' && ui("إضافة شركة جديدة")}
                {modal === 'edit-company' && `تعديل «${editTarget?.name_en}»`}
                {modal === 'create-user' && ui("إنشاء مستخدم")}
                {modal==='review-user'&&(locale==='ar'?'مراجعة تغيير الحساب':'Review account change')}
                {modal === 'create-invoice' && ui("فاتورة جديدة")}
              </h3>
              <button aria-label={locale==='ar'?'إغلاق':'Close'} disabled={busy} onClick={() => { if(!busyLock.current)setModal(null); }} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            {formErr && <div className="mt-4 rounded-md border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{formErr}</div>}

            {modal === 'create-company' && (
              <form onSubmit={e => { e.preventDefault(); companyAction('/api/platform/admin/create-company', createCompanyBody(companyForm)); }} className="mt-5 space-y-4"><fieldset disabled={busy} className="min-w-0 space-y-4">
                <p className="text-xs leading-5 text-muted-foreground"><LocalizedText text="يصل المالك دعوة بالبريد لتعيين كلمة المرور." /></p>
                {([['company_name', ui("اسم الشركة *")], ['domain', ui("الدومين *")], ['owner_email', ui("بريد المالك *")], ['owner_name', ui("اسم المالك")]] as const).map(([k, l]) => (
                  <div key={k}><label className="mb-1.5 block text-xs font-medium text-foreground">{l}</label><input required={l.endsWith('*')} value={companyForm[k]} onChange={e => setCompanyForm({ ...companyForm, [k]: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></div>
                ))}
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-3 text-sm font-medium disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? ui("جارٍ الإنشاء…") : ui("إنشاء ودعوة")}</button>
              </fieldset></form>
            )}

            {modal === 'edit-company' && editTarget && (
              <form onSubmit={e => { e.preventDefault(); companyAction('/api/platform/admin/companies', { tenant_id: editTarget.id, name_en: editTarget.name_en, domain: editTarget.domain, logo_url: editTarget.logo_url, billing_status: editTarget.billing_status }); }} className="mt-5 space-y-4"><fieldset disabled={busy} className="min-w-0 space-y-4">
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="اسم الشركة" /></label><input value={editTarget.name_en} onChange={e => setEditTarget({ ...editTarget, name_en: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="الدومين" /></label><input value={editTarget.domain ?? ''} onChange={e => setEditTarget({ ...editTarget, domain: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="رابط الشعار" /></label><input value={editTarget.logo_url ?? ''} onChange={e => setEditTarget({ ...editTarget, logo_url: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="حالة الفوترة" /></label><select value={editTarget.billing_status} onChange={e => setEditTarget({ ...editTarget, billing_status: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20">{Object.entries(billingMeta).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-3 text-sm font-medium disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? ui("جارٍ الحفظ…") : 'حفظ التعديلات'}</button>
              </fieldset></form>
            )}

            {modal==='review-user'&&userReview&&(
              <form data-testid="platform-user-review" onSubmit={e=>{e.preventDefault();const r=userReview;userAction(r.action==='archive'?'DELETE':'PATCH',{user_id:r.user.id,expected_version:r.user.version,reason:userReason,...(r.action==='role'?{role:r.value}:r.action==='status'?{status:r.value}:r.action==='reset'?{reset_password:true}:{})});}} className="mt-5 space-y-4"><fieldset disabled={busy} className="min-w-0 space-y-4">
                <p className="break-words text-sm text-foreground">{userReview.user.email}</p>
                <p className="text-sm">{userReview.action==='role'?(locale==='ar'?'تغيير الدور إلى: ':'Change role to: ')+ui(roleLabels[userReview.value??'']??userReview.value??''):userReview.action==='status'?(locale==='ar'?'تغيير الحالة إلى: ':'Change status to: ')+(userReview.value==='active'?(locale==='ar'?'نشط':'Active'):(locale==='ar'?'غير نشط':'Inactive')):userReview.action==='archive'?(locale==='ar'?'ستتم أرشفة الحساب مع الاحتفاظ بالسجل.':'Archive this account while preserving its history.'):(locale==='ar'?'طلب رابط استعادة كلمة المرور. التسليم يتطلب قبول مزود البريد.':'Request password recovery. Delivery requires acceptance by the email provider.')}</p>
                <div><label htmlFor="platform-user-reason" className="mb-1.5 block text-xs font-medium text-foreground">{locale==='ar'?'سبب التغيير':'Reason'}</label><textarea id="platform-user-reason" data-testid="platform-user-reason" required minLength={5} maxLength={500} value={userReason} onChange={e=>setUserReason(e.target.value)} className="min-h-24 w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></div>
                <p className="text-xs text-muted-foreground">{locale==='ar'?'إذا تغير السجل، أعد تحميله ثم راجع العملية من جديد.':'If this record changes, reload and review the operation again.'}</p>
                <button data-testid="platform-user-confirm" disabled={busy||userReason.trim().length<5} className="w-full rounded-md bg-foreground text-background px-4 py-3 text-sm font-medium disabled:opacity-50">{busy?(locale==='ar'?'جارٍ الحفظ…':'Saving…'):(locale==='ar'?'تأكيد التغيير':'Confirm change')}</button>
              </fieldset></form>
            )}
            {modal === 'create-user' && (
              <form data-testid="platform-user-create-form" onSubmit={e => { e.preventDefault(); if(!createUserReady){setFormErr(locale==='ar'?'تحقق من المنشأة والدور قبل الإنشاء.':'Verify the company and role before creating.');return;} void userAction('POST', { ...userForm, password: userForm.password || undefined }); }} className="mt-5 space-y-4">
                <div data-testid="platform-user-choices" data-state={userChoicesState} data-error-endpoint={userChoicesFailure?.endpoint} data-http-status={userChoicesFailure?.status}>
                  {(userChoicesState==='idle'||userChoicesState==='loading')&&<p role="status" className="text-sm text-muted-foreground">{locale==='ar'?'جارٍ تحميل المنشآت والأدوار…':'Loading companies and roles…'}</p>}
                  {userChoicesState==='error'&&<div role="alert" className="space-y-2 rounded-md border border-rose-500/30 p-3 text-sm text-rose-800 dark:text-rose-200"><p>{locale==='ar'?'تعذر التحقق من المنشآت والأدوار. أعد المحاولة قبل الإنشاء.':'Companies and roles could not be verified. Retry before creating.'}</p><button type="button" onClick={()=>void refreshUserChoices()} className="rounded-lg border border-input px-3 py-1.5">{locale==='ar'?'أعد المحاولة':'Retry'}</button></div>}
                  {userChoicesState==='ready'&&!userChoices?.companies.some(c=>c.status==='active')&&<p role="status" className="text-sm text-amber-800 dark:text-amber-200">{locale==='ar'?'لا توجد منشأة نشطة متاحة لإنشاء المستخدم.':'No active company is available for user creation.'}</p>}
                </div>
                <fieldset disabled={busy||userChoicesState!=='ready'} className="min-w-0 space-y-4">
                <div><label htmlFor="platform-new-tenant" className="mb-1.5 block text-xs font-medium text-foreground">{locale==='ar'?'المنشأة':'Company'}</label><select id="platform-new-tenant" required disabled={creationPending} value={userForm.tenant_id} onChange={e => setUserForm({ ...userForm, tenant_id:e.target.value,role:userChoices?.roles.find(r=>r.tenant_id===e.target.value&&ROLES.includes(r.name))?.name??'' })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"><option value="">{locale==='ar'?'اختر المنشأة':'Choose company'}</option>{(userChoices?.companies??[]).filter(c=>c.status==='active').map(c => <option key={c.id} value={c.id}>{locale==='ar'&&c.name_ar?c.name_ar:c.name_en}</option>)}</select></div>
                <div><label htmlFor="platform-new-email" className="mb-1.5 block text-xs font-medium text-foreground">{locale==='ar'?'البريد الإلكتروني':'Email'}</label><input id="platform-new-email" required type="email" disabled={creationPending} value={userForm.email} onChange={e => setUserForm({ ...userForm, email:e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" dir="ltr" /></div>
                <div><label htmlFor="platform-new-name" className="mb-1.5 block text-xs font-medium text-foreground">{locale==='ar'?'الاسم':'Name'}</label><input id="platform-new-name" maxLength={150} disabled={creationPending} value={userForm.full_name} onChange={e => setUserForm({ ...userForm, full_name:e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></div>
                <div><label htmlFor="platform-new-role" className="mb-1.5 block text-xs font-medium text-foreground">{locale==='ar'?'الدور':'Role'}</label><select id="platform-new-role" required disabled={creationPending} value={userForm.role} onChange={e => setUserForm({ ...userForm, role:e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"><option value="">{locale==='ar'?'اختر الدور':'Choose role'}</option>{(userChoices?.roles??[]).filter(r=>r.tenant_id===userForm.tenant_id&&ROLES.includes(r.name)).map(r=><option key={r.name} value={r.name}>{ui(roleLabels[r.name]??r.name)}</option>)}</select></div>
                <div><label htmlFor="platform-new-password" className="mb-1.5 block text-xs font-medium text-foreground">{locale==='ar'?'كلمة مرور أولية (اختياري)':'Initial password (optional)'}</label><input id="platform-new-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} disabled={creationPending} value={userForm.password} onChange={e => setUserForm({ ...userForm, password:e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /><p className="mt-2 text-xs text-muted-foreground">{locale==='ar'?'اتركها فارغة لإرسال دعوة. كلمة المرور الأولية تتطلب تغييرها عند أول دخول.':'Leave blank for an invitation. An initial password must be changed at first sign-in.'}</p></div>
                {creationPending&&<p role="status" className="text-xs text-amber-800 dark:text-amber-200">{locale==='ar'?'احتفظ بنفس التفاصيل وأعد محاولة الطلب للتحقق من نتيجته. لن تتغير كلمة المرور الأصلية.':'Retry these same details to confirm the outcome. The original password is preserved.'}</p>}
                <button data-testid="platform-new-submit" disabled={busy||!createUserReady} className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-3 text-sm font-medium disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? (locale==='ar'?'جارٍ الإنشاء…':'Creating…'):(locale==='ar'?'إنشاء المستخدم أو الدعوة':'Create user or invitation')}</button>
              </fieldset></form>
            )}

            {modal === 'create-invoice' && (
              <form onSubmit={e => { e.preventDefault(); (async () => { if(busyLock.current)return; busyLock.current=true; setBusy(true); setFormErr(''); try { await api('/api/platform/admin/billing', { method: 'POST', body: JSON.stringify({ ...invoiceForm, amount: Number(invoiceForm.amount), due_date: invoiceForm.due_date || undefined, period_label: invoiceForm.period_label || undefined }) }); setModal(null); await load(); } catch (err) { setFormErr(err instanceof Error ? err.message : ui("فشل")); } finally { busyLock.current=false; setBusy(false); } })(); }} className="mt-5 space-y-4"><fieldset disabled={busy} className="min-w-0 space-y-4">
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="الشركة *" /></label><select value={invoiceForm.tenant_id} onChange={e => setInvoiceForm({ ...invoiceForm, tenant_id: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20">{companies.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}</select></div>
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="المبلغ (ر.س) *" /></label><input required type="number" min="1" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="الفترة" /></label><input value={invoiceForm.period_label} onChange={e => setInvoiceForm({ ...invoiceForm, period_label: e.target.value })} placeholder={ui("سبتمبر 2026")} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-foreground"><LocalizedText text="تاريخ الاستحقاق" /></label><input type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" dir="ltr" /></div>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground text-background hover:bg-foreground/90 px-4 py-3 text-sm font-medium disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? ui("جارٍ الإنشاء…") : ui("إنشاء الفاتورة")}</button>
              </fieldset></form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function createCompanyBody(f: { company_name: string; domain: string; owner_email: string; owner_name: string }) {
  return { company_name: f.company_name, domain: f.domain, owner_email: f.owner_email, owner_name: f.owner_name || undefined };
}
