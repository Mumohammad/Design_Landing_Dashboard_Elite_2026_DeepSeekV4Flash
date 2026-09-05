'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Users, Rocket, PauseCircle, PlayCircle, Plus, Search, Loader2,
  ShieldCheck, X, RefreshCw, ArrowLeft, LayoutDashboard, CreditCard,
  ScrollText, Pencil, Trash2, KeyRound, BadgeDollarSign, TrendingUp,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/platform/browser';

type Stats = { total: number; active: number; suspended: number; terminated: number; trial: number; new_this_month: number };
type Company = {
  id: string; name_en: string; name_ar: string | null; slug: string | null; domain: string | null;
  logo_url: string | null; status: 'active' | 'suspended' | 'terminated'; plan: string;
  trial_ends_at: string | null; billing_status: string; created_at: string; users_count: number;
};
type AdminUser = { id: string; tenant_id: string; email: string; full_name_en: string | null; role: string; status: string; created_at: string; last_login_at: string | null; company_name: string };
type Invoice = { id: string; tenant_id: string; invoice_number: string; period_label: string | null; amount: number; currency: string; status: string; due_date: string | null; paid_at: string | null; created_at: string; company_name: string };
type AuditEntry = { id: string; company_name: string; action: string; entity_type: string | null; module: string; created_at: string };
type Analytics = {
  registrations_by_day: { date: string; count: number }[];
  by_status: Record<string, number>; by_billing: Record<string, number>; by_plan: Record<string, number>;
  total_users: number; top_companies_by_users: { tenant_id: string; users: number; name: string }[];
};
type BillingSummary = { pending_amount: number; overdue_amount: number; paid_this_month: number; unpaid_companies: number };

type Section = 'overview' | 'companies' | 'users' | 'billing' | 'audit';

const statusMeta: Record<string, { label: string; cls: string }> = {
  active: { label: 'نشطة', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' },
  suspended: { label: 'معلّقة', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/25' },
  terminated: { label: 'منتهية', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/25' },
};
const billingMeta: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'تجريبية', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/25' },
  active_paid: { label: 'مدفوعة', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' },
  past_due: { label: 'متأخرة', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/25' },
  unpaid: { label: 'غير مدفوعة', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/25' },
  cancelled: { label: 'ملغاة', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/25' },
};
const roleLabels: Record<string, string> = {
  general_manager: 'مدير عام', admin: 'مسؤول', accountant: 'محاسب', supervisor: 'مشرف',
  hr_officer: 'موارد بشرية', operations_officer: 'عمليات', payroll_officer: 'رواتب',
  platform_coordinator: 'منسق منصات', readonly_auditor: 'قارئ فقط',
};
const ROLES = Object.keys(roleLabels);

function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('ar-SA') : '—'; }
function fmtMoney(n: number) { return `${new Intl.NumberFormat('ar-SA').format(Math.round(n))} ر.س`; }

export default function PlatformAdminPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'ready'>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('overview');

  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'trial' | 'suspended'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'create-company' | 'create-user' | 'create-invoice' | 'edit-company'>(null);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [companyForm, setCompanyForm] = useState({ company_name: '', domain: '', owner_email: '', owner_name: '' });
  const [userForm, setUserForm] = useState({ tenant_id: '', email: '', full_name: '', role: 'readonly_auditor', password: '' });
  const [invoiceForm, setInvoiceForm] = useState({ tenant_id: '', amount: '', period_label: '', due_date: '' });

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
    return res.json();
  }, [token]);

  const load = useCallback(async () => {
    const [s, c, u, b, an, au] = await Promise.all([
      api('/api/platform/admin/stats'),
      api('/api/platform/admin/companies'),
      api('/api/platform/admin/users'),
      api('/api/platform/admin/billing'),
      api('/api/platform/admin/analytics'),
      api('/api/platform/admin/audit'),
    ]);
    setStats(s); setCompanies(c.companies); setUsers(u.users);
    setInvoices(b.invoices); setBillingSummary(b.summary);
    setAnalytics(an); setAudit(au.entries);
  }, [api]);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { router.replace('/auth/sign-in'); return; }
      const res = await fetch('/api/platform/admin/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) { router.replace('/platform'); return; }
      setToken(session.access_token);
      setPhase('ready');
    })();
  }, [router]);

  useEffect(() => { if (phase === 'ready') load().catch(() => {}); }, [phase, load]);

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
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true); setFormErr('');
    try {
      await api(path, { method: path.endsWith('companies') && body.tenant_id && !body.company_name ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setModal(null); await load();
    } catch (e) { setFormErr(e instanceof Error ? e.message : 'فشل'); } finally { setBusy(false); }
  }

  async function userAction(method: string, body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true); setFormErr('');
    try {
      await api('/api/platform/admin/users', { method, body: JSON.stringify(body) });
      setModal(null); await load();
    } catch (e) { setFormErr(e instanceof Error ? e.message : 'فشل'); } finally { setBusy(false); }
  }

  async function toggleStatus(c: Company) {
    if (busyId) return;
    const next = c.status === 'suspended' ? 'active' : 'suspended';
    if (!confirm(next === 'suspended' ? `تعليق «${c.name_en}»؟` : `تفعيل «${c.name_en}»؟`)) return;
    setBusyId(c.id);
    try { await api('/api/platform/admin/update-status', { method: 'POST', body: JSON.stringify({ tenant_id: c.id, status: next }) }); await load(); }
    finally { setBusyId(null); }
  }

  if (phase !== 'ready') {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 text-sm text-white/60"><Loader2 className="h-5 w-5 animate-spin text-[#E87D3E]" /> جارٍ التحقق من الصلاحيات…</div>
      </main>
    );
  }

  const nav: { key: Section; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
    { key: 'companies', label: 'الشركات', icon: Building2, count: companies.length },
    { key: 'users', label: 'المستخدمون', icon: Users, count: users.length },
    { key: 'billing', label: 'الفوترة', icon: CreditCard, count: billingSummary?.unpaid_companies },
    { key: 'audit', label: 'سجل النشاط', icon: ScrollText },
  ];

  const maxReg = Math.max(1, ...(analytics?.registrations_by_day.map(d => d.count) ?? [1]));

  return (
    <main dir="rtl" className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-l border-white/10 bg-slate-900/50 md:flex">
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E]"><ShieldCheck className="h-5 w-5" /></span>
            <div className="leading-tight"><p className="text-sm font-bold">إدارة المنصة</p><p className="text-[10px] text-white/40">SaaS Control</p></div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {nav.map(n => (
              <button key={n.key} onClick={() => setSection(n.key)} className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${section === n.key ? 'bg-gradient-to-r from-[#1E5A99]/25 to-[#E87D3E]/15 text-white ring-1 ring-inset ring-[#1E5A99]/40' : 'text-white/55 hover:bg-white/5 hover:text-white'}`}>
                <n.icon className="h-4 w-4" /> {n.label}
                {n.count !== undefined && <span className="ms-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] tabular-nums">{n.count}</span>}
              </button>
            ))}
          </nav>
          <div className="border-t border-white/10 p-3">
            <Link href="/platform" className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-white/50 transition hover:bg-white/5 hover:text-white"><ArrowLeft className="h-4 w-4 -scale-x-100" /> العودة للمنصة</Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/85 px-6 backdrop-blur-xl">
            <h1 className="text-lg font-extrabold">{nav.find(n => n.key === section)?.label}</h1>
            <button onClick={() => load()} className="rounded-lg border border-white/10 bg-white/5 p-2 transition hover:bg-white/10" title="تحديث"><RefreshCw className="h-4 w-4" /></button>
          </header>

          <div className="p-6">
            {section === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                  {stats && [
                    { label: 'إجمالي الشركات', value: stats.total, grad: 'from-[#1E5A99] to-[#2f7ac0]', icon: Building2 },
                    { label: 'نشطة', value: stats.active, grad: 'from-emerald-500 to-teal-500', icon: PlayCircle },
                    { label: 'في التجربة', value: stats.trial, grad: 'from-[#E87D3E] to-amber-500', icon: Rocket },
                    { label: 'معلّقة', value: stats.suspended, grad: 'from-rose-500 to-rose-600', icon: PauseCircle },
                    { label: 'غير مدفوعة', value: billingSummary?.unpaid_companies ?? 0, grad: 'from-orange-500 to-red-500', icon: BadgeDollarSign },
                    { label: 'جديدة هذا الشهر', value: stats.new_this_month, grad: 'from-violet-500 to-purple-500', icon: TrendingUp },
                  ].map(c => (
                    <div key={c.label} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.grad} shadow-lg`}><c.icon className="h-5 w-5" /></div>
                      <p className="mt-4 text-3xl font-extrabold tabular-nums">{c.value}</p>
                      <p className="mt-1 text-xs font-semibold text-white/50">{c.label}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 lg:col-span-3">
                    <p className="text-sm font-bold">التسجيلات — آخر 30 يومًا</p>
                    <div className="mt-5 flex h-36 items-end gap-1">
                      {(analytics?.registrations_by_day ?? []).map(d => (
                        <div key={d.date} className="group relative flex-1 rounded-t bg-gradient-to-t from-[#1E5A99]/70 to-[#E87D3E]/70 transition hover:from-[#1E5A99] hover:to-[#E87D3E]" style={{ height: `${Math.max(4, (d.count / maxReg) * 100)}%` }} title={`${d.date}: ${d.count}`}></div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 lg:col-span-2">
                    <p className="text-sm font-bold">أكبر الشركات بالمستخدمين</p>
                    <div className="mt-4 space-y-3">
                      {(analytics?.top_companies_by_users ?? []).map(t => (
                        <div key={t.tenant_id} className="flex items-center justify-between text-sm">
                          <span className="truncate font-semibold text-white/80">{t.name}</span>
                          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs tabular-nums">{t.users}</span>
                        </div>
                      ))}
                      {!(analytics?.top_companies_by_users?.length) && <p className="text-xs text-white/35">لا بيانات بعد</p>}
                    </div>
                    <div className="mt-5 border-t border-white/10 pt-4 text-xs text-white/45">
                      إجمالي المستخدمين: <span className="font-extrabold text-white tabular-nums">{analytics?.total_users ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {section === 'companies' && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="flex flex-col gap-4 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between">
                  <div><h2 className="text-lg font-extrabold">الشركات المسجلة</h2><p className="mt-0.5 text-xs text-white/45">{filtered.length} من {companies.length}</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث…" className="w-48 rounded-xl border border-white/10 bg-slate-950/60 py-2.5 pl-3 pr-9 text-sm placeholder:text-white/30 focus:border-[#1E5A99] focus:outline-none" />
                    </div>
                    <div className="flex overflow-hidden rounded-xl border border-white/10">
                      {([['all', 'الكل'], ['active', 'نشطة'], ['trial', 'تجريبية'], ['suspended', 'معلّقة']] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setFilter(k)} className={`px-3 py-2 text-xs font-bold transition ${filter === k ? 'bg-[#1E5A99] text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>{l}</button>
                      ))}
                    </div>
                    <button onClick={() => { setFormErr(''); setModal('create-company'); }} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E87D3E] to-[#d96c2f] px-4 py-2.5 text-sm font-bold shadow-lg shadow-[#E87D3E]/25 transition hover:scale-[1.02]"><Plus className="h-4 w-4" /> إضافة شركة</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-right">
                    <thead><tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                      <th className="px-5 py-3.5">الشركة</th><th className="px-5 py-3.5">الدومين</th><th className="px-5 py-3.5">الحالة</th><th className="px-5 py-3.5">الفوترة</th><th className="px-5 py-3.5">المستخدمون</th><th className="px-5 py-3.5">التسجيل</th><th className="px-5 py-3.5">إجراءات</th>
                    </tr></thead>
                    <tbody>
                      {filtered.map(c => {
                        const isTrial = c.trial_ends_at && new Date(c.trial_ends_at) > new Date();
                        const meta = statusMeta[c.status] ?? statusMeta.terminated;
                        const bMeta = billingMeta[c.billing_status] ?? billingMeta.trialing;
                        return (
                          <tr key={c.id} className="border-b border-white/5 text-sm transition hover:bg-white/[0.03]">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                {c.logo_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.logo_url} alt="" className="h-9 w-9 rounded-xl border border-white/10 object-cover" />
                                ) : (
                                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E] text-sm font-extrabold">{(c.name_en || '؟').charAt(0)}</span>
                                )}
                                <div className="leading-tight"><p className="font-bold">{c.name_en}</p><p className="text-[11px] text-white/40">{c.slug ?? '—'}</p></div>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-white/60" dir="ltr">{c.domain ?? '—'}</td>
                            <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span></td>
                            <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${isTrial ? billingMeta.trialing.cls : bMeta.cls}`}>{isTrial ? 'تجريبية' : bMeta.label}</span></td>
                            <td className="px-5 py-4 tabular-nums text-white/60">{c.users_count}</td>
                            <td className="px-5 py-4 text-xs text-white/45">{fmtDate(c.created_at)}</td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => { setEditTarget(c); setFormErr(''); setModal('edit-company'); }} className="rounded-lg bg-white/10 p-1.5 text-white/60 transition hover:bg-white/15 hover:text-white" title="تعديل"><Pencil className="h-3.5 w-3.5" /></button>
                                <button disabled={busyId === c.id || c.status === 'terminated'} onClick={() => toggleStatus(c)} className={`rounded-lg p-1.5 transition disabled:opacity-40 ${c.status === 'suspended' ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'}`} title={c.status === 'suspended' ? 'تفعيل' : 'تعليق'}>
                                  {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.status === 'suspended' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                                </button>
                                <button disabled={busyId === c.id} onClick={() => companyAction('/api/platform/admin/companies', { tenant_id: c.id }, `حذف «${c.name_en}» نهائيًا؟ (حذف ناعم — قابل للاسترجاع من قاعدة البيانات)`)} className="rounded-lg bg-rose-500/15 p-1.5 text-rose-400 transition hover:bg-rose-500/25" title="حذف"><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && <tr><td colSpan={7} className="px-5 py-14 text-center text-sm text-white/35">لا توجد شركات مطابقة</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {section === 'users' && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="flex flex-col gap-4 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between">
                  <div><h2 className="text-lg font-extrabold">كل المستخدمين</h2><p className="mt-0.5 text-xs text-white/45">{users.length} مستخدم عبر {companies.length} شركة</p></div>
                  <button onClick={() => { setUserForm({ ...userForm, tenant_id: companies[0]?.id ?? '' }); setFormErr(''); setModal('create-user'); }} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-4 py-2.5 text-sm font-bold shadow-lg shadow-[#1E5A99]/25 transition hover:scale-[1.02]"><Plus className="h-4 w-4" /> إنشاء مستخدم</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-right">
                    <thead><tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                      <th className="px-5 py-3.5">المستخدم</th><th className="px-5 py-3.5">الشركة</th><th className="px-5 py-3.5">الدور</th><th className="px-5 py-3.5">الحالة</th><th className="px-5 py-3.5">آخر دخول</th><th className="px-5 py-3.5">إجراءات</th>
                    </tr></thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="border-b border-white/5 text-sm transition hover:bg-white/[0.03]">
                          <td className="px-5 py-4"><div className="leading-tight"><p className="font-bold">{u.full_name_en || u.email}</p><p className="text-[11px] text-white/40" dir="ltr">{u.email}</p></div></td>
                          <td className="px-5 py-4 text-white/60">{u.company_name}</td>
                          <td className="px-5 py-4">
                            <select value={u.role} onChange={e => userAction('PATCH', { user_id: u.id, role: e.target.value })} className="rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-xs font-bold focus:border-[#1E5A99] focus:outline-none">
                              {ROLES.map(r => <option key={r} value={r}>{roleLabels[r]}</option>)}
                            </select>
                          </td>
                          <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${u.status === 'active' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-slate-500/25 bg-slate-500/10 text-slate-400'}`}>{u.status === 'active' ? 'نشط' : u.status === 'pending_invite' ? 'بانتظار القبول' : u.status === 'locked' ? 'مقفل' : u.status === 'terminated' ? 'موقوف' : u.status}</span></td>
                          <td className="px-5 py-4 text-xs text-white/45">{u.last_login_at ? fmtDate(u.last_login_at) : 'لم يدخل'}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => userAction('PATCH', { user_id: u.id, reset_password: true }, `إرسال رابط إعادة تعيين كلمة المرور إلى ${u.email}؟`)} className="rounded-lg bg-white/10 p-1.5 text-white/60 transition hover:bg-white/15 hover:text-white" title="إعادة تعيين كلمة المرور"><KeyRound className="h-3.5 w-3.5" /></button>
                              <button onClick={() => userAction('DELETE', { user_id: u.id }, `إيقاف «${u.email}» نهائيًا؟`)} className="rounded-lg bg-rose-500/15 p-1.5 text-rose-400 transition hover:bg-rose-500/25" title="إيقاف"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && <tr><td colSpan={6} className="px-5 py-14 text-center text-sm text-white/35">لا مستخدمين بعد</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {section === 'billing' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {billingSummary && [
                    { label: 'معلّق التحصيل', value: fmtMoney(billingSummary.pending_amount), grad: 'from-amber-500 to-orange-500' },
                    { label: 'متأخر', value: fmtMoney(billingSummary.overdue_amount), grad: 'from-rose-500 to-red-500' },
                    { label: 'محصّل هذا الشهر', value: fmtMoney(billingSummary.paid_this_month), grad: 'from-emerald-500 to-teal-500' },
                    { label: 'شركات غير مدفوعة', value: billingSummary.unpaid_companies, grad: 'from-[#1E5A99] to-[#2f7ac0]' },
                  ].map(c => (
                    <div key={c.label} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                      <div className={`h-1.5 w-10 rounded-full bg-gradient-to-r ${c.grad}`}></div>
                      <p className="mt-4 text-2xl font-extrabold tabular-nums">{c.value}</p>
                      <p className="mt-1 text-xs font-semibold text-white/50">{c.label}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="flex items-center justify-between border-b border-white/10 p-5">
                    <h2 className="text-lg font-extrabold">فواتير المنصة</h2>
                    <button onClick={() => { setInvoiceForm({ ...invoiceForm, tenant_id: companies[0]?.id ?? '' }); setFormErr(''); setModal('create-invoice'); }} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E87D3E] to-[#d96c2f] px-4 py-2.5 text-sm font-bold shadow-lg shadow-[#E87D3E]/25 transition hover:scale-[1.02]"><Plus className="h-4 w-4" /> فاتورة جديدة</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-right">
                      <thead><tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                        <th className="px-5 py-3.5">الفاتورة</th><th className="px-5 py-3.5">الشركة</th><th className="px-5 py-3.5">المبلغ</th><th className="px-5 py-3.5">الاستحقاق</th><th className="px-5 py-3.5">الحالة</th><th className="px-5 py-3.5">إجراء</th>
                      </tr></thead>
                      <tbody>
                        {invoices.map(i => (
                          <tr key={i.id} className="border-b border-white/5 text-sm transition hover:bg-white/[0.03]">
                            <td className="px-5 py-4 font-mono text-xs font-bold text-white/80" dir="ltr">{i.invoice_number}</td>
                            <td className="px-5 py-4">{i.company_name}</td>
                            <td className="px-5 py-4 font-extrabold tabular-nums">{fmtMoney(Number(i.amount))}</td>
                            <td className="px-5 py-4 text-xs text-white/45">{fmtDate(i.due_date)}</td>
                            <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${i.status === 'paid' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : i.status === 'overdue' ? 'border-rose-500/25 bg-rose-500/10 text-rose-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400'}`}>{i.status === 'paid' ? 'مدفوعة' : i.status === 'overdue' ? 'متأخرة' : i.status === 'void' ? 'ملغاة' : 'معلّقة'}</span></td>
                            <td className="px-5 py-4">
                              {i.status !== 'paid' && i.status !== 'void' && (
                                <button disabled={busyId === i.id} onClick={async () => { if (!confirm('تأكيد استلام الدفع؟')) return; setBusyId(i.id); try { await api('/api/platform/admin/billing', { method: 'PATCH', body: JSON.stringify({ invoice_id: i.id, action: 'mark_paid' }) }); await load(); } finally { setBusyId(null); } }} className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/25 disabled:opacity-40">
                                  {busyId === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'تأكيد الدفع'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {invoices.length === 0 && <tr><td colSpan={6} className="px-5 py-14 text-center text-sm text-white/35">لا فواتير بعد — أنشئ أول فاتورة</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {section === 'audit' && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
                <h2 className="text-lg font-extrabold">أحدث إجراءات المنصة</h2>
                <div className="mt-5 space-y-2">
                  {audit.map(e => (
                    <div key={e.id} className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#E87D3E]"></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-white/85">{e.action}</p>
                        <p className="text-xs text-white/40">{e.company_name} · {e.module}{e.entity_type ? ` · ${e.entity_type}` : ''}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-white/35 tabular-nums">{new Date(e.created_at).toLocaleString('ar-SA')}</span>
                    </div>
                  ))}
                  {audit.length === 0 && <p className="py-10 text-center text-sm text-white/35">لا نشاط بعد</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setModal(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-7 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold">
                {modal === 'create-company' && 'إضافة شركة جديدة'}
                {modal === 'edit-company' && `تعديل «${editTarget?.name_en}»`}
                {modal === 'create-user' && 'إنشاء مستخدم'}
                {modal === 'create-invoice' && 'فاتورة جديدة'}
              </h3>
              <button onClick={() => setModal(null)} className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            {formErr && <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-300">{formErr}</div>}

            {modal === 'create-company' && (
              <form onSubmit={e => { e.preventDefault(); companyAction('/api/platform/admin/create-company', createCompanyBody(companyForm)); }} className="mt-5 space-y-4">
                <p className="text-xs leading-5 text-white/45">يصل المالك دعوة بالبريد لتعيين كلمة المرور.</p>
                {([['company_name', 'اسم الشركة *'], ['domain', 'الدومين *'], ['owner_email', 'بريد المالك *'], ['owner_name', 'اسم المالك']] as const).map(([k, l]) => (
                  <div key={k}><label className="mb-1.5 block text-xs font-bold text-white/70">{l}</label><input required={l.endsWith('*')} value={companyForm[k]} onChange={e => setCompanyForm({ ...companyForm, [k]: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" /></div>
                ))}
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-4 py-3 text-sm font-bold disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? 'جارٍ الإنشاء…' : 'إنشاء ودعوة'}</button>
              </form>
            )}

            {modal === 'edit-company' && editTarget && (
              <form onSubmit={e => { e.preventDefault(); companyAction('/api/platform/admin/companies', { tenant_id: editTarget.id, name_en: editTarget.name_en, domain: editTarget.domain, logo_url: editTarget.logo_url, billing_status: editTarget.billing_status }); }} className="mt-5 space-y-4">
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">اسم الشركة</label><input value={editTarget.name_en} onChange={e => setEditTarget({ ...editTarget, name_en: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">الدومين</label><input value={editTarget.domain ?? ''} onChange={e => setEditTarget({ ...editTarget, domain: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">رابط الشعار</label><input value={editTarget.logo_url ?? ''} onChange={e => setEditTarget({ ...editTarget, logo_url: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">حالة الفوترة</label><select value={editTarget.billing_status} onChange={e => setEditTarget({ ...editTarget, billing_status: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none">{Object.entries(billingMeta).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-4 py-3 text-sm font-bold disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button>
              </form>
            )}

            {modal === 'create-user' && (
              <form onSubmit={e => { e.preventDefault(); userAction('POST', { ...userForm, password: userForm.password || undefined }); }} className="mt-5 space-y-4">
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">الشركة *</label><select value={userForm.tenant_id} onChange={e => setUserForm({ ...userForm, tenant_id: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none">{companies.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}</select></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">البريد *</label><input required type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">الاسم</label><input value={userForm.full_name} onChange={e => setUserForm({ ...userForm, full_name: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">الدور</label><select value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none">{ROLES.map(r => <option key={r} value={r}>{roleLabels[r]}</option>)}</select></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">كلمة مرور (اختياري — وإلا تصله دعوة)</label><input type="password" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" /></div>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-4 py-3 text-sm font-bold disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم'}</button>
              </form>
            )}

            {modal === 'create-invoice' && (
              <form onSubmit={e => { e.preventDefault(); (async () => { setBusy(true); setFormErr(''); try { await api('/api/platform/admin/billing', { method: 'POST', body: JSON.stringify({ ...invoiceForm, amount: Number(invoiceForm.amount), due_date: invoiceForm.due_date || undefined, period_label: invoiceForm.period_label || undefined }) }); setModal(null); await load(); } catch (err) { setFormErr(err instanceof Error ? err.message : 'فشل'); } finally { setBusy(false); } })(); }} className="mt-5 space-y-4">
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">الشركة *</label><select value={invoiceForm.tenant_id} onChange={e => setInvoiceForm({ ...invoiceForm, tenant_id: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none">{companies.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}</select></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">المبلغ (ر.س) *</label><input required type="number" min="1" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" dir="ltr" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">الفترة</label><input value={invoiceForm.period_label} onChange={e => setInvoiceForm({ ...invoiceForm, period_label: e.target.value })} placeholder="سبتمبر 2026" className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" /></div>
                <div><label className="mb-1.5 block text-xs font-bold text-white/70">تاريخ الاستحقاق</label><input type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm focus:border-[#1E5A99] focus:outline-none" dir="ltr" /></div>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E87D3E] to-[#d96c2f] px-4 py-3 text-sm font-bold disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? 'جارٍ الإنشاء…' : 'إنشاء الفاتورة'}</button>
              </form>
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
