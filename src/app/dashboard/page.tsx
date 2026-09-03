'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TrendingUp, Users, DollarSign, Truck, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface Tenant {
  id: string;
  name: string;
  logo_url?: string;
  brand_colors?: { primary?: string; secondary?: string };
  slug: string;
}

export default function DashboardHome() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    drivers: 0,
    vehicles: 0,
    monthIncome: 0,
    monthExpenses: 0,
  });
  const [recentDrivers, setRecentDrivers] = useState<any[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('tenant');
    if (stored) {
      try {
        setTenant(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse tenant:', e);
      }
    }
    loadStats();
  }, []);

  const loadStats = async () => {
    const supabase = createClient();
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split('T')[0];

    const [driversRes, vehiclesRes, invoicesRes, expensesRes, recentRes] = await Promise.all([
      supabase.from('drivers').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('invoices').select('total').is('deleted_at', null).gte('issue_date', monthStartStr),
      supabase.from('expenses').select('amount').is('deleted_at', null).gte('expense_date', monthStartStr),
      supabase.from('drivers').select('id, full_name_en, full_name_ar, status, created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(4),
    ]);

    const monthIncome = (invoicesRes.data || []).reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
    const monthExpenses = (expensesRes.data || []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

    setStats({
      drivers: driversRes.count || 0,
      vehicles: vehiclesRes.count || 0,
      monthIncome,
      monthExpenses,
    });
    setRecentDrivers(recentRes.data || []);
    setLoading(false);
  };

  const metrics = [
    { title: 'Revenue (This Month)', value: `${stats.monthIncome.toLocaleString()} SAR`, icon: DollarSign, trend: 'up' as const },
    { title: 'Expenses (This Month)', value: `${stats.monthExpenses.toLocaleString()} SAR`, icon: TrendingUp, trend: stats.monthExpenses > stats.monthIncome ? 'down' as const : 'up' as const },
    { title: 'Total Drivers', value: String(stats.drivers), icon: Users, trend: 'up' as const },
    { title: 'Total Vehicles', value: String(stats.vehicles), icon: Truck, trend: 'up' as const },
  ];

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 bg-white/5 rounded w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-white/5 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-white/5 rounded-xl" />
          <div className="h-64 bg-white/5 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Welcome back{tenant ? `, ${tenant.name}` : ''}!</h1>
        <p className="text-white/60">Here is what is happening with your fleet today.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <div key={i} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <metric.icon className="w-5 h-5 text-blue-400" />
              </div>
              <div className={`flex items-center gap-1 text-sm ${metric.trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                {metric.trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              </div>
            </div>
            <div className="text-2xl font-bold text-white mb-1">{metric.value}</div>
            <div className="text-sm text-white/60">{metric.title}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Latest Drivers</h2>
          {recentDrivers.length === 0 ? (
            <div className="text-center py-8 text-white/40">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No drivers yet. Add your first driver to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentDrivers.map((d) => (
                <div key={d.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <div className="w-2 h-2 bg-blue-400 rounded-full" />
                  <div className="flex-1">
                    <div className="text-white text-sm">{d.full_name_en || d.full_name_ar || 'Unnamed'}</div>
                    <div className="text-white/50 text-xs">{d.status || 'unknown'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Net Position (This Month)</h2>
          <div className="flex items-end gap-2 mb-4">
            <span className={`text-4xl font-bold ${stats.monthIncome - stats.monthExpenses >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(stats.monthIncome - stats.monthExpenses).toLocaleString()}
            </span>
            <span className="text-white/50 mb-1">SAR</span>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/70 text-sm">Income</span>
                <span className="text-green-400 font-medium text-sm">{stats.monthIncome.toLocaleString()} SAR</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${stats.monthIncome + stats.monthExpenses > 0 ? (stats.monthIncome / (stats.monthIncome + stats.monthExpenses)) * 100 : 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/70 text-sm">Expenses</span>
                <span className="text-red-400 font-medium text-sm">{stats.monthExpenses.toLocaleString()} SAR</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-red-500 rounded-full" style={{ width: `${stats.monthIncome + stats.monthExpenses > 0 ? (stats.monthExpenses / (stats.monthIncome + stats.monthExpenses)) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
