import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data: entries, error } = await guard.service
    .from('audit_log')
    .select('id, tenant_id, actor_id, module, entity_type, entity_id, action, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: tenants } = await guard.service.from('tenants').select('id, name_en');
  const names = new Map((tenants ?? []).map(t => [t.id, t.name_en]));

  return NextResponse.json({
    entries: (entries ?? []).map(e => ({ ...e, company_name: e.tenant_id ? names.get(e.tenant_id) ?? '—' : '—' })),
  });
}
