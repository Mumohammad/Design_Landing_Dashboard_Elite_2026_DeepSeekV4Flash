'use client';

import { Home, Users, Settings, BarChart3, FileText, HelpCircle } from 'lucide-react';

export default function Sidebar() {
  const navItems = [
    { icon: Home, label: 'Dashboard', href: '/dashboard' },
    { icon: BarChart3, label: 'Analytics', href: '/dashboard/analytics' },
    { icon: Users, label: 'Team', href: '/dashboard/team' },
    { icon: FileText, label: 'Projects', href: '/dashboard/projects' },
    { icon: Settings, label: 'Settings', href: '/dashboard/settings' },
    { icon: HelpCircle, label: 'Help', href: '/dashboard/help' },
  ];

  return (
    <div className="w-64 bg-slate-800/50 backdrop-blur-sm border-r border-white/10 flex flex-col">
      <div className="p-6">
        <h2 className="text-white font-bold text-xl">Dashboard</h2>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition"
          >
            <item.icon className="w-5 h-5" />
            <span className="text-sm font-medium">{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
