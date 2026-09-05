'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Users, Rocket, PauseCircle, PlayCircle, Plus, Search,
  Loader2, ShieldCheck, X, RefreshCw, LogIn, ArrowLeft,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/platform/browser';

type Stats = { total: number; active: number; suspended: number; terminated: number; trial: number; new_this_month: number };
type Company = {
  id: string; name_en: string; name_ar: string | null; slug: string | null; domain: string | null;
  logo_url: string | null; status: 'active' | 'suspended' | 'terminated'; plan: string;
  trial_ends_at: string | null; created_at: string; users_count: number;
};

const statusMeta: Record<string, { label: string; cls: string }> = {
  active: { label: 'نشطة', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' },
  suspended: { label: 'معلّقة', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/25' },
  terminated: { label: 'منتهية', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/25' },
};

export default function PlatformAdminPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'denied' | 'ready'>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'trial' | 'suspended'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState({ company_name: '', domain: '', owner_email: '', owner_name: '' });

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
    return res.json();
  }, [token]);

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([
      api('/api/platform/admin/stats'),
      api('/api/platform/admin/companies'),
    ]);
    setStats(s);
    setCompanies(c.companies);
  }, [api]);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        router.replace('/platform/login');
        return;
      }
      const res = await fetch('/api/platform/admin/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) {
        router.replace('/platform');
        return;
      }
      setToken(session.access_token);
      setPhase('ready');
    })();
  }, [router]);

  useEffect(() => {
    if (phase === 'ready') load().catch(() => {});
  }, [phase, load]);

  const filtered = useMemo(() => {
    const now = new Date();
    return companies.filter(c => {
      const matchesSearch = !search || [c.name_en, c.name_ar ?? '', c.domain ?? '', c.slug ?? ''].join(' ').toLowerCase().includes(search.toLowerCase());
      const isTrial = c.trial_ends_at && new Date(c.trial_ends_at) > now;
      const matchesFilter = filter === 'all' || (filter === 'trial' ? isTrial : c.status === filter);
      return matchesSearch && matchesFilter;
    });
  }, [companies, search, filter]);

  async function toggleStatus(c: Company) {
    if (!token || busyId) return;
    const next = c.status === 'suspended' ? 'active' : 'suspended';
    if (!confirm(next === 'suspended' ? `تعليق شركة «${c.name_en}»؟` : `إعادة تفعيل «${c.name_en}»؟`)) return;
    setBusyId(c.id);
    try {
      await api('/api/platform/admin/update-status', { method: 'POST', body: JSON.stringify({ tenant_id: c.id, status: next }) });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await api('/api/platform/admin/create-company', { method: 'POST', body: JSON.stringify(createForm) });
      setShowCreate(false);
      setCreateForm({ company_name: '', domain: '', owner_email: '', owner_name: '' });
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'فشل الإنشاء');
    } finally {
      setCreating(false);
    }
  }

  if (phase !== 'ready') {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 text-sm text-white/60"><Loader2 className="h-5 w-5 animate-spin text-[#E87D3E]" /> جارٍ التحقق من الصلاحيات…</div>
      </main>
    );
  }

  const cards = stats ? [
    { label: 'إجمالي الشركات', value: stats.total, icon: Building2, grad: 'from-[#1E5A99] to-[#2f7ac0]' },
    { label: 'نشطة', value: stats.active, icon: PlayCircle, grad: 'from-emerald-500 to-teal-500' },
    { label: 'في التجربة', value: stats.trial, icon: Rocket, grad: 'from-[#E87D3E] to-amber-500' },
    { label: 'معلّقة', value: stats.suspended, icon: PauseCircle, grad: 'from-rose-500 to-rose-600' },
    { label: 'جديدة هذا الشهر', value: stats.new_this_month, icon: Users, grad: 'from-violet-500 to-purple-500' },
  ] : [];

  return (
    <main dir="rtl" className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E5A99] to-[#E87D3E]"><ShieldCheck className="h-5 w-5" /></span>
            <div className="leading-tight"><p className="font-bold">لوحة إدارة المنصة</p><p className="text-[11px] text-white/40">Platform Admin · نخبة التطوير</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load()} className="rounded-lg border border-white/10 bg-white/5 p-2 transition hover:bg-white/10" title="تحديث"><RefreshCw className="h-4 w-4" /></button>
            <Link href="/platform" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10"><ArrowLeft className="h-3.5 w-3.5 -scale-x-100" /> المنصة</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {cards.map(c => (
            <div key={c.label} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.grad} shadow-lg`}><c.icon className="h-5 w-5" /></div>
              <p className="mt-4 text-3xl font-extrabold tabular-nums">{c.value}</p>
              <p className="mt-1 text-xs font-semibold text-white/50">{c.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/60">
          <div className="flex flex-col gap-4 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-extrabold">الشركات المسجلة</h2>
              <p className="mt-0.5 text-xs text-white/45">{filtered.length} من {companies.length} شركة</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الدومين…" className="w-56 rounded-xl border border-white/10 bg-slate-950/60 py-2.5 pl-3 pr-9 text-sm placeholder:text-white/30 focus:border-[#1E5A99] focus:outline-none" />
              </div>
              <div className="flex overflow-hidden rounded-xl border border-white/10">
                {([['all', 'الكل'], ['active', 'نشطة'], ['trial', 'تجريبية'], ['suspended', 'معلّقة']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)} className={`px-3 py-2 text-xs font-bold transition ${filter === k ? 'bg-[#1E5A99] text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>{l}</button>
                ))}
              </div>
              <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E87D3E] to-[#d96c2f] px-4 py-2.5 text-sm font-bold shadow-lg shadow-[#E87D3E]/25 transition hover:scale-[1.02]"><Plus className="h-4 w-4" /> إضافة شركة</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-right">
              <thead><tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <th className="px-5 py-3.5 font-semibold">الشركة</th>
                <th className="px-5 py-3.5 font-semibold">الدومين</th>
                <th className="px-5 py-3.5 font-semibold">الحالة</th>
                <th className="px-5 py-3.5 font-semibold">التجربة</th>
                <th className="px-5 py-3.5 font-semibold">المستخدمون</th>
                <th className="px-5 py-3.5 font-semibold">التسجيل</th>
                <th className="px-5 py-3.5 font-semibold">إجراءات</th>
              </tr></thead>
              <tbody>
                {filtered.map(c => {
                  const isTrial = c.trial_ends_at && new Date(c.trial_ends_at) > new Date();
                  const meta = statusMeta[c.status] ?? statusMeta.terminated;
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
                      <td className="px-5 py-4"><span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span></td>
                      <td className="px-5 py-4">{isTrial ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-400">تجريبية · حتى {new Date(c.trial_ends_at!).toLocaleDateString('ar-SA')}</span> : <span className="text-xs text-white/30">—</span>}</td>
                      <td className="px-5 py-4 tabular-nums text-white/60">{c.users_count}</td>
                      <td className="px-5 py-4 text-xs text-white/45">{new Date(c.created_at).toLocaleDateString('ar-SA')}</td>
                      <td className="px-5 py-4">
                        <button disabled={busyId === c.id || c.status === 'terminated'} onClick={() => toggleStatus(c)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${c.status === 'suspended' ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'}`}>
                          {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.status === 'suspended' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                          {c.status === 'suspended' ? 'تفعيل' : 'تعليق'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-14 text-center text-sm text-white/35">لا توجد شركات مطابقة</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-7 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold">إضافة شركة جديدة</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">يصل المالك دعوة بالبريد لتعيين كلمة المرور — لا حاجة لكلمة مرور يدوية.</p>
            {createError && <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-300">{createError}</div>}
            <form onSubmit={createCompany} className="mt-5 space-y-4">
              {([
                ['company_name', 'اسم الشركة *', 'أكمي للوجستيات', 'text'],
                ['domain', 'الدومين *', 'acme.com', 'text'],
                ['owner_email', 'بريد المالك *', 'owner@acme.com', 'email'],
                ['owner_name', 'اسم المالك', 'محمد أحمد', 'text'],
              ] as const).map(([key, label, ph, type]) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs font-bold text-white/70">{label}</label>
                  <input required={label.endsWith('*')} type={type} value={createForm[key]} onChange={e => setCreateForm({ ...createForm, [key]: e.target.value })} placeholder={ph} className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm placeholder:text-white/25 focus:border-[#1E5A99] focus:outline-none" />
                </div>
              ))}
              <button disabled={creating} type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E5A99] to-[#174a7e] px-4 py-3 text-sm font-bold shadow-lg shadow-[#1E5A99]/25 transition hover:shadow-xl disabled:opacity-60">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} {creating ? 'جارٍ الإنشاء والدعوة…' : 'إنشاء ودعوة المالك'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
