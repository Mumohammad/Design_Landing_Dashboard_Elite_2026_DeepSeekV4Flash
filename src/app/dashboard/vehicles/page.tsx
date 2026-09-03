'use client';

import { useState } from 'react';
import { Truck, Plus, Search, Fuel, Wrench, MapPin } from 'lucide-react';

interface Vehicle {
  id: number;
  plate: string;
  model: string;
  type: 'Truck' | 'Van' | 'Trailer';
  status: 'Active' | 'Maintenance' | 'Idle';
  fuel: number;
  mileage: string;
  location: string;
}

export default function VehiclesPage() {
  const [search, setSearch] = useState('');
  const [vehicles] = useState<Vehicle[]>([
    { id: 1, plate: 'ABC-1234', model: 'Volvo FH16', type: 'Truck', status: 'Active', fuel: 78, mileage: '124,500 km', location: 'Riyadh' },
    { id: 2, plate: 'DEF-5678', model: 'Mercedes Sprinter', type: 'Van', status: 'Active', fuel: 45, mileage: '89,200 km', location: 'Jeddah' },
    { id: 3, plate: 'GHI-9012', model: 'Scania R500', type: 'Truck', status: 'Maintenance', fuel: 12, mileage: '210,800 km', location: 'Dammam' },
    { id: 4, plate: 'JKL-3456', model: 'Ford Transit', type: 'Van', status: 'Idle', fuel: 92, mileage: '45,300 km', location: 'Riyadh' },
  ]);

  const filtered = vehicles.filter(v => v.plate.toLowerCase().includes(search.toLowerCase()) || v.model.toLowerCase().includes(search.toLowerCase()));

  const statusColor = (s: Vehicle['status']) => ({
    'Active': 'bg-green-500/20 text-green-400',
    'Maintenance': 'bg-red-500/20 text-red-400',
    'Idle': 'bg-slate-500/20 text-slate-400',
  }[s]);

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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vehicles', value: vehicles.length, icon: Truck },
          { label: 'Active', value: vehicles.filter(v => v.status === 'Active').length, icon: MapPin },
          { label: 'In Maintenance', value: vehicles.filter(v => v.status === 'Maintenance').length, icon: Wrench },
          { label: 'Avg Fuel Level', value: '57%', icon: Fuel },
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
        <input type="text" placeholder="Search by plate or model..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((vehicle) => (
          <div key={vehicle.id} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-500/10 rounded-xl">
                  <Truck className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <div className="text-white font-semibold">{vehicle.model}</div>
                  <div className="text-white/50 text-sm">{vehicle.plate} • {vehicle.type}</div>
                </div>
              </div>
              <span className={`text-xs px-3 py-1 rounded-full ${statusColor(vehicle.status)}`}>{vehicle.status}</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60 flex items-center gap-2"><Fuel className="w-4 h-4" /> Fuel</span>
                <span className="text-white">{vehicle.fuel}%</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${vehicle.fuel > 50 ? 'bg-green-500' : vehicle.fuel > 20 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${vehicle.fuel}%` }} />
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-white/5">
                <span className="text-white/60 flex items-center gap-2"><MapPin className="w-4 h-4" /> {vehicle.location}</span>
                <span className="text-white/60">{vehicle.mileage}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
