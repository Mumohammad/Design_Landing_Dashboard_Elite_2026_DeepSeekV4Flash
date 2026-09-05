import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function POST(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { tenant_id, status } = await req.json();
    if (!tenant_id || !['active', 'suspended'].includes(status)) {
      return NextResponse.json({ error: 'tenant_id and status (active|suspended) are required' }, { status: 400 });
    }

    const { error } = await guard.service
      .from('tenants')
      .update({ status, updated_by: guard.userId, updated_at: new Date().toISOString() })
      .eq('id', tenant_id);
    if (error) throw error;

    await guard.service.from('audit_log').insert({
      tenant_id,
      actor_id: guard.userId,
      module: 'platform_admin',
      entity_type: 'tenants',
      entity_id: tenant_id,
      action: status === 'suspended' ? 'company_suspended' : 'company_reactivated',
      new_values: { status },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update status' }, { status: 500 });
  }
}
