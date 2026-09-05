import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform/admin';

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req);
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { service } = ctx;
  const { data: tenants, error } = await service
    .from('tenants')
    .select('id, status, plan, settings, created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const rows = tenants || [];

  const stats = {
    total: rows.length,
    active: rows.filter((t) => t.status === 'active').length,
    suspended: rows.filter((t) => t.status === 'suspended').length,
    terminated: rows.filter((t) => t.status === 'terminated').length,
    trial: rows.filter((t) => (t.settings as Record<string, unknown> | null)?.subscription === 'trial').length,
    new_this_month: rows.filter((t) => t.created_at >= monthStart).length,
  };

  return NextResponse.json({ stats });
}
