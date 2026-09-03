'use client';

import { useState } from 'react';
import { Users, Plus, Search, Filter, Phone, Mail, Star, MoreVertical } from 'lucide-react';

interface Driver {
  id: number;
  name: string;
  phone: string;
  email: string;
  status: 'Active' | 'On Trip' | 'Off Duty' | 'Pending';
  rating: number;
  trips: number;
  vehicle: string;
}

export default function DriversPage() {
  const [search, setSearch] = useState('');
  const [drivers] = useState<Driver[]>([
    { id: 1, name: 'Ahmed Hassan', phone: '+966 50 123 4567', email: 'ahmed@fleet.com', status: 'On Trip', rating: 4.8, trips: 342, vehicle: 'Truck #A-101' },
    { id: 2, name: 'Mohammed Ali', phone: '+966 55 234 5678', email: 'mohammed@fleet.com', status: 'Active', rating: 4.9, trips: 528, vehicle: 'Van #B-203' },
    { id: 3, name: 'Khalid Omar', phone: '+966 54 345 6789', email: 'khalid@fleet.com', status: 'Off Duty', rating: 4.6, trips: 215, vehicle: 'Truck #A-105' },
    { id: 4, name: 'Sara Ahmed', phone: '+966 56 456 7890', email: 'sara@fleet.com', status: 'Active', rating: 5.0, trips: 189, vehicle: 'Van #B-210' },
    { id: 5, name: 'Omar Youssef', phone: '+966 59 567 8901', email: 'omar@fleet.com', status: 'Pending', rating: 0, trips: 0, vehicle: 'Unassigned' },
  ]);

  const filtered = drivers.filter(d => d.name.toLowerCase().includes(search.toLowerCase()) || d.email.toLowerCase().includes(search.toLowerCase()));

  const statusColor = (s: Driver['status']) => ({
    'Active': 'bg-green-500/20 text-green-400',
    'On Trip': 'bg-blue-500/20 text-blue-400',
    'Off Duty': 'bg-slate-500/20 text-slate-400',
    'Pending': 'bg-yellow-500/20 text-yellow-400',
  }[s]);

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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Drivers', value: drivers.length },
          { label: 'Active Now', value: drivers.filter(d => d.status === 'Active' || d.status === 'On Trip').length },
          { label: 'On Trip', value: drivers.filter(d => d.status === 'On Trip').length },
          { label: 'Avg Rating', value: '4.8' },
        ].map((stat, i) => (
          <div key={i} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
            <div className="text-white/60 text-sm mb-2">{stat.label}</div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input type="text" placeholder="Search drivers..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition" />
        </div>
        <button className="flex items-center gap-2 bg-white/5 border border-white/10 text-white px-4 py-3 rounded-lg hover:bg-white/10 transition">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <div className="divide-y divide-white/5">
          {filtered.map((driver) => (
            <div key={driver.id} className="flex items-center justify-between p-4 hover:bg-white/5 transition">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                  {driver.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{driver.name}</span>
                    {driver.rating > 0 && (
                      <span className="flex items-center gap-1 text-yellow-400 text-xs">
                        <Star className="w-3 h-3 fill-current" />
                        {driver.rating}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-white/50">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{driver.phone}</span>
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{driver.email}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right hidden md:block">
                  <div className="text-white text-sm">{driver.vehicle}</div>
                  <div className="text-white/50 text-xs">{driver.trips} trips</div>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full ${statusColor(driver.status)}`}>{driver.status}</span>
                <button className="p-2 hover:bg-white/10 rounded-lg transition">
                  <MoreVertical className="w-4 h-4 text-white/60" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
