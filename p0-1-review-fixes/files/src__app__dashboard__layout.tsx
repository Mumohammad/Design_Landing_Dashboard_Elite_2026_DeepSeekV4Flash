'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import Header from '@/components/dashboard/Header';

interface Tenant {
  id: string;
  name: string;
  logo_url?: string;
  brand_colors?: { primary?: string; secondary?: string };
  slug: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [tenant, setTenant] = useState<Tenant | null>(() => {
    try {
      const stored = localStorage.getItem('tenant');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const primaryColor = tenant?.brand_colors?.primary || '#3b82f6';
  const secondaryColor = tenant?.brand_colors?.secondary || '#8b5cf6';

  return (
    <div className="flex h-screen bg-slate-900" style={{ '--tenant-primary': primaryColor, '--tenant-secondary': secondaryColor } as React.CSSProperties}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header tenant={tenant} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
