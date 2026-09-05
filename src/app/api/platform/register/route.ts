import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { company_name, domain, email, password, logo_url, brand_colors } = await req.json();

    if (!company_name || !email || !password) {
      return NextResponse.json({ error: 'الرجاء تعبئة اسم الشركة والبريد وكلمة المرور' }, { status: 400 });
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 });
    }

    const slug =
      String(company_name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 48) || 'company';

    const admin = adminClient();

    const { data: slugTaken } = await admin.from('tenants').select('id').eq('slug', slug).maybeSingle();
    if (slugTaken) {
      return NextResponse.json({ error: 'اسم الشركة مسجل مسبقاً — جرّب اسماً مختلفاً' }, { status: 409 });
    }

    // 1) Create the auth user through the invite-provisioned path (required by the auth hardening trigger)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { _invite_provisioned: true, company_name, domain: domain || null },
    });

    if (createErr || !created.user) {
      const msg = createErr?.message?.toLowerCase().includes('already')
        ? 'هذا البريد مسجل مسبقاً — سجّل الدخول'
        : createErr?.message || 'فشل إنشاء الحساب';
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    const authUserId = created.user.id;

    try {
      // 2) Tenant workspace (trial by default)
      const { data: tenant, error: tenantErr } = await admin
        .from('tenants')
        .insert({
          name_en: company_name,
          name_ar: company_name,
          slug,
          email,
          logo_url: logo_url || null,
          brand_colors: { primary: brand_colors || '#1E5A99', secondary: '#E87D3E' },
          settings: {
            domain: domain || null,
            subscription: 'trial',
            trial_started_at: new Date().toISOString(),
          },
          plan: 'multi_tenant',
          created_by: authUserId,
        })
        .select('id')
        .single();
      if (tenantErr) throw tenantErr;

      // 3) Owner profile
      const { data: owner, error: ownerErr } = await admin
        .from('users')
        .insert({
          auth_user_id: authUserId,
          tenant_id: tenant.id,
          email,
          full_name_en: company_name,
          role: 'general_manager',
          status: 'active',
          must_change_password: false,
        })
        .select('id')
        .single();
      if (ownerErr) throw ownerErr;

      // 4) Membership
      const { error: memberErr } = await admin.from('tenant_memberships').insert({
        tenant_id: tenant.id,
        user_id: owner.id,
        is_primary: true,
      });
      if (memberErr) throw memberErr;

      return NextResponse.json({ success: true, tenant_slug: slug });
    } catch (inner) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
      throw inner;
    }
  } catch (error) {
    console.error('platform register error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'فشل التسجيل' },
      { status: 500 }
    );
  }
}
