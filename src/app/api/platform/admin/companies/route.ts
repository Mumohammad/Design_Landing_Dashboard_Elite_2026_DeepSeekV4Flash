import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin, serviceClient } from '@/lib/platform/admin';

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req);
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { service } = ctx;

  const { data: tenants, error } = await service
    .from('tenants')
    .select('id, name_en, name_ar, slug, email, logo_url, status, plan, settings, brand_colors, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: userRows } = await service.from('users').select('tenant_id');
  const counts = new Map<string, number>();
  for (const row of userRows || []) {
    counts.set(row.tenant_id, (counts.get(row.tenant_id) || 0) + 1);
  }

  const companies = (tenants || []).map((t) => ({
    ...t,
    domain: (t.settings as Record<string, unknown> | null)?.domain ?? null,
    subscription: (t.settings as Record<string, unknown> | null)?.subscription ?? null,
    users_count: counts.get(t.id) || 0,
  }));

  return NextResponse.json({ companies });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req);
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { service } = ctx;

  try {
    const { company_name, owner_email, domain } = await req.json();
    if (!company_name || !owner_email) {
      return NextResponse.json({ error: 'اسم الشركة وبريد المالك مطلوبان' }, { status: 400 });
    }

    const slug =
      String(company_name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 48) || 'company';

    const { data: slugTaken } = await service.from('tenants').select('id').eq('slug', slug).maybeSingle();
    if (slugTaken) return NextResponse.json({ error: 'اسم الشركة مسجل مسبقاً' }, { status: 409 });

    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || '';

    // Invite the owner through the invite-provisioned path (passes the auth hardening trigger)
    const { data: invite, error: inviteErr } = await service.auth.admin.inviteUserByEmail(owner_email, {
      data: { _invite_provisioned: true, company_name, domain: domain || null },
      redirectTo: `${origin}/platform/login`,
    });
    if (inviteErr || !invite.user) {
      return NextResponse.json({ error: inviteErr?.message || 'فشل إرسال الدعوة' }, { status: 500 });
    }

    const authUserId = invite.user.id;

    try {
      const { data: tenant, error: tenantErr } = await service
        .from('tenants')
        .insert({
          name_en: company_name,
          name_ar: company_name,
          slug,
          email: owner_email,
          settings: { domain: domain || null, subscription: 'trial', trial_started_at: new Date().toISOString() },
          plan: 'multi_tenant',
          created_by: ctx.user.id,
        })
        .select('id')
        .single();
      if (tenantErr) throw tenantErr;

      const { data: owner, error: ownerErr } = await service
        .from('users')
        .insert({
          auth_user_id: authUserId,
          tenant_id: tenant.id,
          email: owner_email,
          full_name_en: company_name,
          role: 'general_manager',
          status: 'pending_invite',
          must_change_password: true,
        })
        .select('id')
        .single();
      if (ownerErr) throw ownerErr;

      await service.from('tenant_memberships').insert({ tenant_id: tenant.id, user_id: owner.id, is_primary: true });

      return NextResponse.json({ success: true, tenant_slug: slug, invited: owner_email });
    } catch (inner) {
      await service.auth.admin.deleteUser(authUserId).catch(() => undefined);
      throw inner;
    }
  } catch (error) {
    console.error('admin create company error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'فشل إنشاء الشركة' }, { status: 500 });
  }
}
