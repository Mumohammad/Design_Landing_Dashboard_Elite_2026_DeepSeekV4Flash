import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await req.json();
    const { company_name, domain, email, password, logo_url, brand_colors } = body;

    if (!company_name || !domain || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const { data: existing } = await supabase.from('tenants').select('id').eq('domain', domain).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Domain already registered' }, { status: 409 });
    }

    // Invite-provisioned user creation — direct signup is blocked by the auth trigger
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { _invite_provisioned: true, company_name, domain },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create user');

    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tenant, error: tenantError } = await supabase.from('tenants').insert({
      name_en: company_name,
      name_ar: company_name,
      slug,
      domain,
      logo_url: logo_url || null,
      brand_colors: { primary: brand_colors || '#1E5A99', secondary: '#E87D3E' },
      trial_ends_at: trialEnds,
      created_by: authData.user.id,
    }).select('id').single();

    if (tenantError) throw tenantError;

    const { error: userError } = await supabase.from('users').upsert({
      auth_user_id: authData.user.id,
      tenant_id: tenant.id,
      email,
      role: 'general_manager',
      status: 'active',
      must_change_password: false,
    }, { onConflict: 'auth_user_id' });
    if (userError) throw userError;

    const { data: pubUser } = await supabase.from('users').select('id').eq('auth_user_id', authData.user.id).single();
    if (pubUser) {
      await supabase.from('tenant_memberships').upsert({ tenant_id: tenant.id, user_id: pubUser.id, is_primary: true });
    }

    return NextResponse.json({ success: true, tenant_slug: slug });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Registration failed' }, { status: 500 });
  }
}
