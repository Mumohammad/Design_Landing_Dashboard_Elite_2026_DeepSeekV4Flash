import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { companyName, name, email, password } = await req.json();

    if (!companyName || !name || !email || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({ name_en: companyName, slug })
      .select()
      .single();

    if (tenantError) {
      return NextResponse.json({ error: tenantError.message }, { status: 400 });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 400 });
    }

    const { error: membershipError } = await supabase
      .from('tenant_memberships')
      .insert({ user_id: authData.user.id, tenant_id: tenant.id, role: 'owner' });

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 400 });
    }

    return NextResponse.json({
      user: authData.user,
      tenant: {
        id: tenant.id,
        name: tenant.name_en,
        logo_url: tenant.logo_url,
        brand_colors: tenant.brand_colors,
        slug: tenant.slug,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
