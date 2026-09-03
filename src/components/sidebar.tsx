'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, Settings, BarChart3, Key, Truck, Wallet, FileText } from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { icon: Home, label: 'Dashboard', href: '/dashboard' },
    { icon: BarChart3, label: 'Analytics', href: '/dashboard/analytics' },
    { icon: Users, label: 'Drivers', href: '/dashboard/drivers' },
    { icon: Truck, label: 'Vehicles', href: '/dashboard/vehicles' },
    { icon: Wallet, label: 'Accounting', href: '/dashboard/accounting' },
    { icon: FileText, label: 'Reports', href: '/dashboard/reports' },
    { icon: Users, label: 'Team', href: '/dashboard/team' },
    { icon: Key, label: 'API Keys', href: '/dashboard/api-keys' },
    { icon: Settings, label: 'Settings', href: '/dashboard/settings' },
  ];

  return (
    <div className="w-64 bg-slate-800/50 backdrop-blur-sm border-r border-white/10 flex flex-col">
      <div className="p-6">
        <h2 className="text-white font-bold text-xl">Elite Dashboard</h2>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
