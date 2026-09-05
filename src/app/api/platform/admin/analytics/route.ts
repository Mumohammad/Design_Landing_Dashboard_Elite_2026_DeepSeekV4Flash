import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data: tenants, error } = await guard.service
    .from('tenants')
    .select('id, name_en, status, plan, billing_status, created_at, trial_ends_at')
    .is('deleted_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: users } = await guard.service.from('users').select('id, tenant_id, created_at');

  const list = tenants ?? [];
  const now = Date.now();

  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: 0 });
  }
  const dayMap = new Map(days.map(d => [d.date, d]));
  for (const t of list) {
    const key = t.created_at.slice(0, 10);
    const bucket = dayMap.get(key);
    if (bucket) bucket.count++;
  }

  const count = (pred: (t: (typeof list)[number]) => boolean) => list.filter(pred).length;

  return NextResponse.json({
    registrations_by_day: days,
    by_status: {
      active: count(t => t.status === 'active'),
      suspended: count(t => t.status === 'suspended'),
      terminated: count(t => t.status === 'terminated'),
    },
    by_billing: {
      trialing: count(t => t.billing_status === 'trialing'),
      active_paid: count(t => t.billing_status === 'active_paid'),
      past_due: count(t => t.billing_status === 'past_due'),
      unpaid: count(t => t.billing_status === 'unpaid'),
      cancelled: count(t => t.billing_status === 'cancelled'),
    },
    by_plan: {
      single_tenant: count(t => t.plan === 'single_tenant'),
      multi_tenant: count(t => t.plan === 'multi_tenant'),
    },
    total_users: (users ?? []).length,
    top_companies_by_users: Object.entries(
      (users ?? []).reduce<Record<string, number>>((acc, u) => {
        acc[u.tenant_id] = (acc[u.tenant_id] ?? 0) + 1;
        return acc;
      }, {})
    ).map(([tenant_id, n]) => ({ tenant_id, users: n, name: list.find(t => t.id === tenant_id)?.name_en ?? '—' }))
      .sort((a, b) => b.users - a.users).slice(0, 5),
  });
}
