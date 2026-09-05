import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data: tenants, error } = await guard.service
    .from('tenants')
    .select('id, name_en, name_ar, slug, domain, logo_url, status, plan, brand_colors, trial_ends_at, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: users } = await guard.service.from('users').select('tenant_id');
  const counts = new Map<string, number>();
  for (const u of users ?? []) {
    counts.set(u.tenant_id, (counts.get(u.tenant_id) ?? 0) + 1);
  }

  return NextResponse.json({
    companies: (tenants ?? []).map(t => ({ ...t, users_count: counts.get(t.id) ?? 0 })),
  });
}
