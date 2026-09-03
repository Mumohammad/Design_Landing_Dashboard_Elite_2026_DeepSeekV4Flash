'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Sidebar from '@/components/sidebar';
import TopNav from '@/components/top-nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTenant() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: membership } = await supabase
          .from('tenant_memberships')
          .select('tenant_id, tenants(name, logo_url, brand_colors)')
          .eq('user_id', user.id)
          .single();

        if (membership?.tenants) {
          setTenant(membership.tenants);
        }
      } catch (error) {
        console.error('Error fetching tenant:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTenant();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  const primaryColor = tenant?.brand_colors?.primary || '#3b82f6';
  const secondaryColor = tenant?.brand_colors?.secondary || '#64748b';
  const backgroundColor = tenant?.brand_colors?.background || '#0f172a';

  return (
    <div className="min-h-screen bg-slate-900" style={{ '--tenant-primary': primaryColor, '--tenant-secondary': secondaryColor, '--tenant-bg': backgroundColor } as React.CSSProperties}>
      <Sidebar tenant={tenant} />
      <div className="lg:pl-64">
        <TopNav tenant={tenant} />
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
