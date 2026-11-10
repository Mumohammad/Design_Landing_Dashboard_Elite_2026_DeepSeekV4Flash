import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data: tenants, error } = await guard.service
    .from('tenants')
    .select('id, status, plan, created_at, trial_ends_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const list = tenants ?? [];

  return NextResponse.json({
    total: list.length,
    active: list.filter(t => t.status === 'active').length,
    suspended: list.filter(t => t.status === 'suspended').length,
    terminated: list.filter(t => t.status === 'terminated').length,
    trial: list.filter(t => t.trial_ends_at && new Date(t.trial_ends_at) > now).length,
    new_this_month: list.filter(t => t.created_at >= monthStart).length,
  });
}
