'use client';

import { Bell, Search, User, LogOut } from 'lucide-react';

interface Tenant {
  id: string;
  name: string;
  logo_url?: string;
  brand_colors?: { primary?: string; secondary?: string };
  slug: string;
}

interface HeaderProps {
  tenant: Tenant | null;
}

export default function Header({ tenant }: HeaderProps) {
  const handleLogout = () => {
    localStorage.removeItem('tenant');
    window.location.href = '/platform/login';
  };

  return (
    <header className="bg-slate-800/50 backdrop-blur-sm border-b border-white/10 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt={tenant.name} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {tenant?.name?.charAt(0) || 'C'}
            </div>
          )}
          <div>
            <h1 className="text-white font-semibold">{tenant?.name || 'Company'}</h1>
            <p className="text-white/50 text-sm">Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search..."
              className="bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition w-64"
            />
          </div>
          <button className="relative p-2 text-white/70 hover:text-white transition">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
          <button onClick={handleLogout} className="flex items-center gap-2 p-2 text-white/70 hover:text-white transition">
            <LogOut className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold">
            <User className="w-5 h-5" />
          </div>
        </div>
      </div>
    </header>
  );
}
