'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Truck, Plus, Search, MapPin, Gauge } from 'lucide-react';

interface Vehicle {
  id: string;
  vehicle_code: string | null;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string | null;
  odometer_current: number | null;
  current_driver_id: string | null;
  photo_url: string | null;
}

export default function VehiclesPage() {
  const [search, setSearch] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, vehicle_code, plate_number, make, model, year, status, odometer_current, current_driver_id, photo_url')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    setVehicles(data || []);
    setLoading(false);
  };

  const filtered = vehicles.filter(v => {
    const q = search.toLowerCase();
    return (v.plate_number || '').toLowerCase().includes(q)
      || (v.model || '').toLowerCase().includes(q)
      || (v.make || '').toLowerCase().includes(q)
      || (v.vehicle_code || '').toLowerCase().includes(q);
  });

  const statusColor = (s: string | null) => {
    const v = (s || '').toLowerCase();
    if (v.includes('active') || v.includes('available') || v.includes('assigned')) return 'bg-green-500/20 text-green-400';
    if (v.includes('maintenance') || v.includes('repair') || v.includes('workshop')) return 'bg-red-500/20 text-red-400';
    return 'bg-slate-500/20 text-slate-400';
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 bg-white/5 rounded w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white/5 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-48 bg-white/5 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Vehicles</h1>
          <p className="text-white/60">Track and manage your fleet vehicles.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
          <Plus className="w-4 h-4" />
          Add Vehicle
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vehicles', value: vehicles.length, icon: Truck },
          { label: 'Assigned', value: vehicles.filter(v => v.current_driver_id).length, icon: MapPin },
          { label: 'In Maintenance', value: vehicles.filter(v => (v.status || '').toLowerCase().includes('maintenance')).length, icon: Gauge },
          { label: 'Total Odometer', value: `${Math.round(vehicles.reduce((s, v) => s + (v.odometer_current || 0), 0) / 1000)}k km`, icon: Gauge },
        ].map((stat, i) => (
          <div key={i} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <stat.icon className="w-5 h-5 text-blue-400" />
              <span className="text-white/60 text-sm">{stat.label}</span>
            </div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
        <input type="text" placeholder="Search by plate, make, or model..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition" />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl text-center py-16 text-white/40">
          <Truck className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">{vehicles.length === 0 ? 'No vehicles yet' : 'No results found'}</p>
          <p className="text-sm mt-1">{vehicles.length === 0 ? 'Add your first vehicle to get started.' : 'Try a different search.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((vehicle) => (
            <div key={vehicle.id} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-500/10 rounded-xl">
                    <Truck className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-white font-semibold">{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}</div>
                    <div className="text-white/50 text-sm">{vehicle.plate_number || 'No plate'}{vehicle.year ? ` • ${vehicle.year}` : ''}</div>
                  </div>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full ${statusColor(vehicle.status)}`}>{vehicle.status || 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between text-sm pt-3 border-t border-white/5">
                <span className="text-white/60 flex items-center gap-2">
                  <Gauge className="w-4 h-4" />
                  {vehicle.odometer_current != null ? `${vehicle.odometer_current.toLocaleString()} km` : 'No odometer data'}
                </span>
                {vehicle.vehicle_code && <span className="text-white/40">#{vehicle.vehicle_code}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
