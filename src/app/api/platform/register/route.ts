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

    const { data: existing } = await supabase.from('tenants').select('id').eq('domain', domain).single();
    if (existing) {
      return NextResponse.json({ error: 'Domain already registered' }, { status: 409 });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { company_name, domain },
        email_redirect_to: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create user');

    const { error: tenantError } = await supabase.from('tenants').insert({
      name_en: company_name,
      name_ar: company_name,
      slug,
      domain,
      logo_url: logo_url || null,
      brand_colors: brand_colors || '#2563eb',
      owner_id: authData.user.id,
    });

    if (tenantError) throw tenantError;

    return NextResponse.json({ success: true, tenant_slug: slug });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Registration failed' }, { status: 500 });
  }
}
