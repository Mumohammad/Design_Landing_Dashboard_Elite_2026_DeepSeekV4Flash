import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';
import { fetchAllRows } from '@/lib/supabase/all-rows';

type CompanyRow={id:string;name_en:string;name_ar:string|null;slug:string|null;domain:string|null;logo_url:string|null;status:string;plan:string;brand_colors:unknown;trial_ends_at:string|null;billing_status:string;created_at:string};
export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });
  try {
    const [tenants, users] = await Promise.all([
      fetchAllRows<CompanyRow>(()=>guard.service.from('tenants').select('id, name_en, name_ar, slug, domain, logo_url, status, plan, brand_colors, trial_ends_at, billing_status, created_at').is('deleted_at',null).order('created_at',{ascending:false}).order('id')),
      fetchAllRows<{tenant_id:string}>(()=>guard.service.from('users').select('tenant_id').is('deleted_at',null).order('id')),
    ]);
    if(tenants.error||users.error)return NextResponse.json({error:'The complete company list could not be loaded. Retry.'},{status:503});
    const counts=new Map<string,number>();
    for(const user of users.data??[])counts.set(user.tenant_id,(counts.get(user.tenant_id)??0)+1);
    return NextResponse.json({companies:(tenants.data??[]).map(company=>({...company,users_count:counts.get(company.id)??0}))});
  }catch{return NextResponse.json({error:'The complete company list could not be loaded. Retry.'},{status:503});}
}

export async function PATCH(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const body = await req.json();
    const { tenant_id, name_en, name_ar, domain, logo_url, plan, billing_status, brand_colors } = body;
    if (!tenant_id) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });

    const updates: Record<string, unknown> = { updated_by: guard.userId, updated_at: new Date().toISOString() };
    if (name_en !== undefined) updates.name_en = name_en;
    if (name_ar !== undefined) updates.name_ar = name_ar;
    if (domain !== undefined) updates.domain = domain;
    if (logo_url !== undefined) updates.logo_url = logo_url;
    if (plan !== undefined) updates.plan = plan;
    if (billing_status !== undefined) updates.billing_status = billing_status;
    if (brand_colors !== undefined) updates.brand_colors = brand_colors;

    const { error } = await guard.service.from('tenants').update(updates).eq('id', tenant_id);
    if (error) throw error;

    await guard.service.from('audit_log').insert({
      tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'tenants', entity_id: tenant_id, action: 'company_updated', new_values: updates,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });

    const { error } = await guard.service.from('tenants').update({
      deleted_at: new Date().toISOString(),
      status: 'terminated',
      updated_by: guard.userId,
    }).eq('id', tenant_id);
    if (error) throw error;

    await guard.service.from('audit_log').insert({
      tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'tenants', entity_id: tenant_id, action: 'company_deleted', new_values: { deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Delete failed' }, { status: 500 });
  }
}
