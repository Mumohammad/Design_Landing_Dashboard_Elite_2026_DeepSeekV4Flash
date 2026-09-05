import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function POST(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const body = await req.json();
    const { company_name, domain, owner_email, owner_name } = body;
    if (!company_name || !domain || !owner_email) {
      return NextResponse.json({ error: 'company_name, domain and owner_email are required' }, { status: 400 });
    }

    const service = guard.service;
    const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const { data: existing } = await service.from('tenants').select('id').eq('domain', domain).maybeSingle();
    if (existing) return NextResponse.json({ error: 'Domain already registered' }, { status: 409 });

    const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(owner_email, {
      data: { _invite_provisioned: true, company_name, full_name_en: owner_name ?? null },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/accept-invite`,
    });
    if (inviteError) throw inviteError;
    if (!invite.user) throw new Error('Failed to invite owner');

    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tenant, error: tenantError } = await service.from('tenants').insert({
      name_en: company_name,
      name_ar: company_name,
      slug,
      domain,
      trial_ends_at: trialEnds,
      created_by: guard.userId,
    }).select('id').single();
    if (tenantError) throw tenantError;

    const { error: userError } = await service.from('users').upsert({
      auth_user_id: invite.user.id,
      tenant_id: tenant.id,
      email: owner_email,
      full_name_en: owner_name ?? null,
      role: 'general_manager',
      status: 'pending_invite',
      invited_by: guard.userId,
      invited_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    if (userError) throw userError;

    const { data: pubUser } = await service.from('users').select('id').eq('auth_user_id', invite.user.id).single();
    if (pubUser) {
      await service.from('tenant_memberships').upsert({ tenant_id: tenant.id, user_id: pubUser.id, is_primary: true });
    }

    await service.from('audit_log').insert({
      tenant_id: tenant.id,
      actor_id: guard.userId,
      module: 'platform_admin',
      entity_type: 'tenants',
      entity_id: tenant.id,
      action: 'company_created',
      new_values: { company_name, domain, owner_email },
    });

    return NextResponse.json({ success: true, tenant_id: tenant.id, slug });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create company' }, { status: 500 });
  }
}
