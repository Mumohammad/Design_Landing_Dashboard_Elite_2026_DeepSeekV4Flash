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

    const { data: tenant, error: provisionError } = await service.rpc('provision_company_atomic', {
      p_auth_user_id: invite.user.id,
      p_company: { name: company_name, domain, slug },
    });
    if (provisionError) {
      if (/^(22|23|42|P0)[A-Z0-9]{3}$/.test(provisionError.code ?? '')) {
        const { error: cleanupError } = await service.auth.admin.deleteUser(invite.user.id);
        if (cleanupError) console.error('Invited company owner requires reconciliation', { authUserId: invite.user.id });
      }
      return NextResponse.json({ error: 'Company provisioning failed; verify its outcome before retrying' }, { status: 503 });
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

    return NextResponse.json({ success: true, tenant_id: tenant.id, slug: tenant.slug });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create company' }, { status: 500 });
  }
}
