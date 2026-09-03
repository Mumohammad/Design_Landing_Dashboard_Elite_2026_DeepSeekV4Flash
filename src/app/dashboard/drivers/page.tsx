'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Users, Plus, Search, Phone, Mail, MoreVertical } from 'lucide-react';

interface Driver {
  id: string;
  driver_code: string | null;
  full_name_en: string | null;
  full_name_ar: string | null;
  primary_mobile: string | null;
  work_email: string | null;
  status: string | null;
  operational_state: string | null;
  current_city: string | null;
  profile_completeness_score: number | null;
}

export default function DriversPage() {
  const [search, setSearch] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDrivers();
  }, []);

  const loadDrivers = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('drivers')
      .select('id, driver_code, full_name_en, full_name_ar, primary_mobile, work_email, status, operational_state, current_city, profile_completeness_score')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    setDrivers(data || []);
    setLoading(false);
  };

  const filtered = drivers.filter(d => {
    const name = (d.full_name_en || d.full_name_ar || '').toLowerCase();
    const email = (d.work_email || '').toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || email.includes(q) || (d.driver_code || '').toLowerCase().includes(q);
  });

  const statusColor = (s: string | null) => {
    const v = (s || '').toLowerCase();
    if (v.includes('active') || v.includes('on_trip') || v.includes('on trip')) return 'bg-green-500/20 text-green-400';
    if (v.includes('pending') || v.includes('onboarding')) return 'bg-yellow-500/20 text-yellow-400';
    if (v.includes('suspend') || v.includes('terminat')) return 'bg-red-500/20 text-red-400';
    return 'bg-slate-500/20 text-slate-400';
  };

  const activeCount = drivers.filter(d => (d.status || '').toLowerCase().includes('active')).length;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 bg-white/5 rounded w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white/5 rounded-xl" />)}
        </div>
        <div className="h-96 bg-white/5 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Drivers</h1>
          <p className="text-white/60">Manage your fleet drivers and assignments.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
          <Plus className="w-4 h-4" />
          Add Driver
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Drivers', value: drivers.length },
          { label: 'Active', value: activeCount },
          { label: 'With Vehicle', value: drivers.filter(d => d.operational_state).length },
          { label: 'Avg Completeness', value: drivers.length ? `${Math.round(drivers.reduce((s, d) => s + (d.profile_completeness_score || 0), 0) / drivers.length)}%` : '0%' },
        ].map((stat, i) => (
          <div key={i} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
            <div className="text-white/60 text-sm mb-2">{stat.label}</div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
        <input type="text" placeholder="Search drivers..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition" />
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-white/40">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">{drivers.length === 0 ? 'No drivers yet' : 'No results found'}</p>
            <p className="text-sm mt-1">{drivers.length === 0 ? 'Add your first driver to get started.' : 'Try a different search.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((driver) => {
              const name = driver.full_name_en || driver.full_name_ar || 'Unnamed';
              const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={driver.id} className="flex items-center justify-between p-4 hover:bg-white/5 transition">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                      {initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{name}</span>
                        {driver.driver_code && <span className="text-xs text-white/40">#{driver.driver_code}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-white/50">
                        {driver.primary_mobile && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{driver.primary_mobile}</span>}
                        {driver.work_email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{driver.work_email}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {driver.current_city && <span className="text-white/50 text-sm hidden md:block">{driver.current_city}</span>}
                    <span className={`text-xs px-3 py-1 rounded-full ${statusColor(driver.status)}`}>{driver.status || 'Unknown'}</span>
                    <button className="p-2 hover:bg-white/10 rounded-lg transition">
                      <MoreVertical className="w-4 h-4 text-white/60" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
