'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, ShieldCheck, Users, TrendingUp, PauseCircle, PlayCircle,
  Plus, Loader2, LogOut, Search, X, AlertTriangle, CheckCircle2, Crown,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/platform/browser';

type Stats = { total: number; active: number; suspended: number; terminated: number; trial: number; new_this_month: number };
type Company = {
  id: string; name_en: string; slug: string; email: string | null; logo_url: string | null;
  status: 'active' | 'suspended' | 'terminated'; plan: string; created_at: string;
  domain: string | null; subscription: string | null; users_count: number;
  brand_colors: { primary?: string } | null;
};

export default function PlatformAdminPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [adminEmail, setAdminEmail] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [form, setForm] = useState({ company_name: '', owner_email: '', domain: '' });

  const authHeader = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : null;
  }, []);

  const load = useCallback(async () => {
    const headers = await authHeader();
    if (!headers) { router.replace('/platform/login'); return; }

    const [statsRes, companiesRes] = await Promise.all([
      fetch('/api/platform/admin/stats', { headers }),
      fetch('/api/platform/admin/companies', { headers }),
    ]);

    if (statsRes.status === 401) { router.replace('/platform/login'); return; }
    if (statsRes.status === 403) { setPhase('denied'); return; }

    const statsData = await statsRes.json();
    const companiesData = await companiesRes.json();
    const supabase = getBrowserSupabase();
    const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

    setStats(statsData.stats);
    setCompanies(companiesData.companies || []);
    setAdminEmail(user?.email || '');
    setPhase('ready');
  }, [authHeader, router]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name_en, c.slug, c.email, c.domain].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [companies, query]);

  async function toggleStatus(company: Company) {
    const next = company.status === 'suspended' ? 'active' : 'suspended';
    setBusyId(company.id);
    const headers = await authHeader();
    if (headers) {
      await fetch(`/api/platform/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      await load();
    }
    setBusyId(null);
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateErr('');
    setCreateMsg('');
    const headers = await authHeader();
    if (headers) {
      const res = await fetch('/api/platform/admin/companies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateErr(data.error || 'فشل إنشاء الشركة');
      } else {
        setCreateMsg(`تم إنشاء «${form.company_name}» وإرسال دعوة إلى ${form.owner_email}`);
        setForm({ company_name: '', owner_email: '', domain: '' });
        await load();
      }
    }
    setCreating(false);
  }

  async function signOut() {
    const supabase = getBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    router.replace('/platform/login');
  }

  if (phase === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-elite-blue-950 text-white">
        <div className="flex items-center gap-3 text-sm text-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-elite-orange-400" /> جارٍ التحقق من صلاحيات المشرف…
        </div>
      </main>
    );
  }

  if (phase === 'denied') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-elite-blue-950 px-4 text-white">
        <div className="max-w-sm rounded-3xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur-xl">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15">
            <AlertTriangle className="h-7 w-7 text-rose-400" />
          </span>
          <h1 className="mt-5 text-xl font-extrabold">غير مصرح</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/60">وحدة التحكم هذه مخصصة لمشرف المنصة فقط.</p>
          <button onClick={() => router.replace('/platform')} className="mt-6 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/15">
            العودة للمنصة
          </button>
        </div>
      </main>
    );
  }

  const kpis = [
    { icon: Building2, label: 'إجمالي الشركات', value: stats?.total ?? 0, tone: 'from-elite-blue-500 to-elite-blue-600' },
    { icon: TrendingUp, label: 'نشطة', value: stats?.active ?? 0, tone: 'from-emerald-500 to-teal-500' },
    { icon: Crown, label: 'تجريبية', value: stats?.trial ?? 0, tone: 'from-elite-orange-500 to-elite-orange-600' },
    { icon: PauseCircle, label: 'موقوفة', value: stats?.suspended ?? 0, tone: 'from-rose-500 to-rose-600' },
    { icon: Plus, label: 'جديدة هذا الشهر', value: stats?.new_this_month ?? 0, tone: 'from-violet-500 to-purple-500' },
  ];

  const inputCls =
    'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-elite-blue-400 focus:ring-2 focus:ring-elite-blue-400/20 placeholder:text-white/40';

  return (
    <main className="min-h-screen bg-elite-blue-950 text-white" dir="rtl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(30,90,153,.35),transparent_45%),radial-gradient(circle_at_90%_20%,rgba(232,125,62,.15),transparent_35%)]" />
      <header className="relative border-b border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:px-8">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 shadow-lg shadow-elite-blue-500/25">
            <ShieldCheck className="h-4.5 w-4.5 text-white" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold">وحدة تحكم المشرف</p>
            <p className="text-[10px] text-white/50">Elite Platform Admin</p>
          </div>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 sm:block" dir="ltr">{adminEmail}</span>
            <button onClick={signOut} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold transition hover:bg-white/10">
              <LogOut className="h-3.5 w-3.5" /> خروج
            </button>
          </div>
        </div>
      </header>
      <div className="relative mx-auto max-w-7xl px-4 py-8 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition hover:border-white/20">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/60">{k.label}</p>
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${k.tone} shadow-lg`}>
                  <k.icon className="h-4 w-4 text-white" />
                </span>
              </div>
              <p className="mt-3 text-3xl font-extrabold tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="text-base font-bold">الشركات المسجلة</h2>
              <p className="text-xs text-white/50">{filtered.length} من {companies.length}</p>
            </div>
            <div className="relative ms-auto w-full sm:w-72">
              <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالاسم أو الدومين…"
                className="w-full rounded-xl border border-white/15 bg-white/5 py-2.5 pe-10 ps-4 text-sm outline-none transition focus:border-elite-blue-400 placeholder:text-white/40"
              />
            </div>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-elite-orange-500 to-elite-orange-600 px-4 py-2.5 text-sm font-bold shadow-lg shadow-elite-orange-500/25 transition hover:scale-[1.02]"
            >
              <Plus className="h-4 w-4" /> إضافة شركة
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-start">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/45">
                  <th className="px-5 py-3 text-start font-semibold">الشركة</th>
                  <th className="px-5 py-3 text-start font-semibold">الدومين / البريد</th>
                  <th className="px-5 py-3 text-start font-semibold">الخطة</th>
                  <th className="px-5 py-3 text-start font-semibold">المستخدمون</th>
                  <th className="px-5 py-3 text-start font-semibold">التسجيل</th>
                  <th className="px-5 py-3 text-start font-semibold">الحالة</th>
                  <th className="px-5 py-3 text-start font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 text-sm transition hover:bg-white/5">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-white"
                          style={{ background: c.brand_colors?.primary || '#1E5A99' }}
                        >
                          {c.name_en?.charAt(0) || '؟'}
                        </span>
                        <div className="min-w-0 leading-tight">
                          <p className="truncate font-semibold">{c.name_en}</p>
                          <p className="truncate text-[10px] text-white/40" dir="ltr">{c.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-white/70" dir="ltr">{c.domain || c.email || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/70">
                        {c.subscription === 'trial' ? 'تجريبي' : c.plan === 'multi_tenant' ? 'متعدد' : 'مفرد'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-white/70">
                      <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-white/40" />{c.users_count}</span>
                    </td>
                    <td className="px-5 py-3.5 text-white/60 tabular-nums">{new Date(c.created_at).toLocaleDateString('ar-SA')}</td>
                    <td className="px-5 py-3.5">
                      {c.status === 'active' && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-300"><span className="h-1 w-1 rounded-full bg-emerald-400" />نشطة</span>}
                      {c.status === 'suspended' && <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold text-amber-300"><span className="h-1 w-1 rounded-full bg-amber-400" />موقوفة</span>}
                      {c.status === 'terminated' && <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[10px] font-bold text-rose-300"><span className="h-1 w-1 rounded-full bg-rose-400" />منتهية</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {c.status !== 'terminated' && (
                        <button
                          disabled={busyId === c.id}
                          onClick={() => toggleStatus(c)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                            c.status === 'suspended'
                              ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                              : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          }`}
                        >
                          {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.status === 'suspended' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                          {c.status === 'suspended' ? 'تفعيل' : 'إيقاف'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-14 text-center text-sm text-white/40">لا توجد شركات مطابقة</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-elite-blue-950 p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-extrabold">إضافة شركة جديدة</h3>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-2 text-sm text-white/55">للعملاء الذين لا يستطيعون التسجيل بأنفسهم — نرسل دعوة للمالك تلقائيًا.</p>
            {createErr && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{createErr}</div>}
            {createMsg && <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{createMsg}</div>}
            <form onSubmit={createCompany} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold">اسم الشركة *</label>
                <input required value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className={inputCls} placeholder="شركة النخبة للوجستيات" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">بريد المالك *</label>
                <input required type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} className={inputCls} placeholder="owner@company.com" dir="ltr" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">الدومين (اختياري)</label>
                <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} className={inputCls} placeholder="company.com" dir="ltr" />
              </div>
              <button
                disabled={creating}
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-elite-orange-500 to-elite-orange-600 text-sm font-bold shadow-lg shadow-elite-orange-500/25 transition hover:scale-[1.01] disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {creating ? 'جارٍ الإنشاء…' : 'أنشئ الشركة وأرسل الدعوة'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
