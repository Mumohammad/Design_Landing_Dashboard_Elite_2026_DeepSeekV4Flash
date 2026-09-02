'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Building2, Users, Car, ClipboardCheck, CreditCard, Settings, LogOut, Menu, X, TrendingUp, DollarSign, Activity, Star } from 'lucide-react';
import Link from 'next/link';
import type { PlatformCompany, PlatformTrial, PlatformSubscription } from '@/lib/platform/types';

const mockCompany: PlatformCompany = {
  id: '1', name: 'Acme Corp', legal_name: 'Acme Corporation LLC', domain: 'acme.elitedev.com.sa', slug: 'acme',
  logo_url: null, brand_colors: { primary: '#2563eb', secondary: '#64748b', background: '#ffffff' },
  plan_tier: 'pro', drivers_limit: 50, vehicles_limit: 50, drivers_count: 12, vehicles_count: 8,
  is_active: true, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

const mockTrials: PlatformTrial[] = [
  { id: '1', company_id: '1', driver_id: 'd1', driver_name: 'Ahmed Mohamed', driver_phone: '+966501234567', driver_license: 'DL123456', rating: 5, feedback: 'Excellent', status: 'active', started_at: new Date(Date.now() - 7*24*60*60*1000).toISOString(), ended_at: null, converted_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: '2', company_id: '1', driver_id: 'd2', driver_name: 'Khaled Ali', driver_phone: '+966507654321', driver_license: 'DL654321', rating: 4, feedback: 'Good', status: 'active', started_at: new Date(Date.now() - 3*24*60*60*1000).toISOString(), ended_at: null, converted_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

const mockSubscription: PlatformSubscription = {
  id: '1', company_id: '1', plan_tier: 'pro', status: 'active', start_date: new Date().toISOString().split('T')[0],
  end_date: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0], cancel_reason: null, cancelled_at: null, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

export default function PlatformDashboard() {
  const params = useParams();
  const slug = params.slug as string;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [company, setCompany] = useState<PlatformCompany | null>(null);
  const [trials, setTrials] = useState<PlatformTrial[]>([]);
  const [subscription, setSubscription] = useState<PlatformSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [companyRes, trialsRes, subRes] = await Promise.all([
          fetch(`/api/platform/companies/${slug}`),
          fetch(`/api/platform/trials?company_id=${slug}`),
          fetch(`/api/platform/subscriptions/${slug}`),
        ]);
        if (companyRes.ok) setCompany(await companyRes.json()); else setCompany(mockCompany);
        if (trialsRes.ok) setTrials(await trialsRes.json()); else setTrials(mockTrials);
        if (subRes.ok) setSubscription(await subRes.json()); else setSubscription(mockSubscription);
      } catch (error) {
        console.error('Fetch error:', error);
        setCompany(mockCompany); setTrials(mockTrials); setSubscription(mockSubscription);
      } finally { setLoading(false); }
    }
    fetchData();
  }, [slug]);

  if (loading || !company) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="text-white text-xl">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-slate-900 flex">
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-slate-800 border-r border-slate-700 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3"><Building2 className="w-7 h-7 text-blue-400" /><span className="text-white font-bold text-lg">{company.name}</span></div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <nav className="p-4 space-y-1">
          <NavItem href={`/platform/${slug}/dashboard`} icon={<TrendingUp className="w-5 h-5" />} label="Dashboard" active />
          <NavItem href={`/platform/${slug}/drivers`} icon={<Users className="w-5 h-5" />} label="Drivers" />
          <NavItem href={`/platform/${slug}/vehicles`} icon={<Car className="w-5 h-5" />} label="Vehicles" />
          <NavItem href={`/platform/${slug}/trials`} icon={<ClipboardCheck className="w-5 h-5" />} label="Trials" badge={trials.length} />
          <NavItem href={`/platform/${slug}/billing`} icon={<CreditCard className="w-5 h-5" />} label="Billing" />
          <NavItem href={`/platform/${slug}/settings`} icon={<Settings className="w-5 h-5" />} label="Settings" />
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-700">
          <button className="w-full flex items-center gap-3 text-white/70 hover:text-white transition px-3 py-2"><LogOut className="w-5 h-5" /><span>Logout</span></button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-white/70 hover:text-white"><Menu className="w-6 h-6" /></button>
          <div className="flex items-center gap-4 ml-auto">
            <div className="text-right"><div className="text-white font-medium">{company.name}</div><div className="text-white/50 text-sm">{company.plan_tier.toUpperCase()} Plan</div></div>
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">{company.name.charAt(0)}</div>
          </div>
        </header>

        <div className="p-6 space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard icon={<Users className="w-6 h-6" />} label="Drivers" value={`${company.drivers_count}/${company.drivers_limit}`} trend="+2 this month" color="blue" />
            <StatCard icon={<Car className="w-6 h-6" />} label="Vehicles" value={`${company.vehicles_count}/${company.vehicles_limit}`} trend="+1 this month" color="green" />
            <StatCard icon={<ClipboardCheck className="w-6 h-6" />} label="Active Trials" value={trials.filter(t => t.status === 'active').length.toString()} trend="2 pending review" color="purple" />
            <StatCard icon={<DollarSign className="w-6 h-6" />} label="Monthly Cost" value={`$${subscription?.plan_tier === 'pro' ? '799' : subscription?.plan_tier === 'enterprise' ? '1999' : '299'}`} trend="Next billing in 30 days" color="yellow" />
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6"><h2 className="text-xl font-semibold text-white">Recent Trials</h2><Link href={`/platform/${slug}/trials`} className="text-blue-400 hover:text-blue-300 text-sm font-medium">View All →</Link></div>
            <div className="space-y-4">
              {trials.slice(0, 3).map((trial) => (
                <div key={trial.id} className="bg-slate-700/50 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 font-bold">{trial.driver_name.charAt(0)}</div>
                    <div><div className="text-white font-medium">{trial.driver_name}</div><div className="text-white/50 text-sm">{trial.driver_phone}</div></div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1"><Star className="w-4 h-4 text-yellow-400 fill-yellow-400" /><span className="text-white font-medium">{trial.rating || 'N/A'}</span></div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${trial.status === 'active' ? 'bg-green-600/20 text-green-400' : trial.status === 'converted' ? 'bg-blue-600/20 text-blue-400' : 'bg-red-600/20 text-red-400'}`}>{trial.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Current Plan</h2>
            <div className="flex items-center justify-between">
              <div><div className="text-2xl font-bold text-white mb-1">{subscription?.plan_tier.toUpperCase()}</div><div className="text-white/60">${subscription?.plan_tier === 'pro' ? '799' : subscription?.plan_tier === 'enterprise' ? '1999' : '299'}/month</div></div>
              <Link href={`/platform/${slug}/billing`} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg font-medium transition">Manage Billing</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ href, icon, label, active, badge }: { href: string; icon: React.ReactNode; label: string; active?: boolean; badge?: number }) {
  return (
    <Link href={href} className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition ${active ? 'bg-blue-600 text-white' : 'text-white/70 hover:bg-slate-700 hover:text-white'}`}>
      <div className="flex items-center gap-3">{icon}<span className="font-medium">{label}</span></div>
      {badge !== undefined && badge > 0 && <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">{badge}</span>}
    </Link>
  );
}

function StatCard({ icon, label, value, trend, color }: { icon: React.ReactNode; label: string; value: string; trend: string; color: 'blue' | 'green' | 'purple' | 'yellow' }) {
  const colorClasses = { blue: 'bg-blue-600/20 text-blue-400', green: 'bg-green-600/20 text-green-400', purple: 'bg-purple-600/20 text-purple-400', yellow: 'bg-yellow-600/20 text-yellow-400' };
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorClasses[color]}`}>{icon}</div>
        <Activity className="w-5 h-5 text-white/30" />
      </div>
      <div className="text-3xl font-bold text-white mb-1">{value}</div>
      <div className="text-white/50 text-sm">{label}</div>
      <div className="text-white/40 text-xs mt-2">{trend}</div>
    </div>
  );
}
