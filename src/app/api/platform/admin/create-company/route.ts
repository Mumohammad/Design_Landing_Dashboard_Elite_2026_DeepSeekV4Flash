import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

const companyInput = z.object({
  company_name: z.string().trim().min(2),
  domain: z.string().trim().min(3).toLowerCase(),
  owner_email: z.string().trim().pipe(z.email()),
  owner_name: z.string().trim().nullish(),
});

const companyResult = z.object({ id: z.uuid(), slug: z.string().nullable() });

export async function POST(req: NextRequest) {
  try {
    const guard = await verifyPlatformAdmin(req);
    if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

    const input = companyInput.safeParse(await req.json().catch(() => null));
    if (!input.success) {
      return NextResponse.json({ error: 'company_name, domain and owner_email are required' }, { status: 400 });
    }
    const { company_name, domain, owner_email, owner_name } = input.data;
    const service = guard.service;
    const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const { data: existing, error: lookupError } = await service.from('tenants').select('id').eq('domain', domain).maybeSingle();
    if (lookupError) {
      console.error('Company domain lookup failed');
      return NextResponse.json({ error: 'Company availability could not be verified' }, { status: 503 });
    }
    if (existing) return NextResponse.json({ error: 'Domain already registered' }, { status: 409 });

    const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(owner_email, {
      data: { _invite_provisioned: true, company_name, full_name_en: owner_name ?? null },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/accept-invite`,
    });
    if (inviteError || !invite?.user) throw new Error('Company owner invitation failed');

    const authUserId = invite.user.id;
    let provisioned: unknown;
    try {
      const { data, error } = await service.rpc('provision_company_atomic', {
        p_auth_user_id: authUserId,
        p_company: { name: company_name, domain, slug },
      });
      if (!error) provisioned = data;
    } catch {
      // A lost response leaves the transaction outcome unknown.
    }
    const tenant = companyResult.safeParse(provisioned);
    if (!tenant.success) {
      // Supabase can reuse an unconfirmed Auth account on resend. An RPC
      // rejection does not establish ownership of that account for deletion.
      console.error('Company provisioning outcome requires reconciliation', { authUserId });
      return NextResponse.json({ error: 'Company provisioning failed; verify its outcome before retrying' }, { status: 503 });
    }

    const { id: tenantId, slug: tenantSlug } = tenant.data;
    // The provisioning RPC commits its own audit entry. Failure to attach the
    // supplemental platform-actor entry must not cause a retry of a committed creation.
    try {
      const { error: auditError } = await service.from('audit_log').insert({
        tenant_id: tenantId,
        actor_id: guard.userId,
        module: 'platform_admin',
        entity_type: 'tenants',
        entity_id: tenantId,
        action: 'company_created',
        new_values: { company_name, domain, owner_email },
      });
      if (auditError) throw auditError;
    } catch {
      console.error('Company creation audit requires reconciliation', { tenantId });
    }

    return NextResponse.json({ success: true, tenant_id: tenantId, slug: tenantSlug });
  } catch {
    console.error('Company creation failed unexpectedly');
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 });
  }
}
