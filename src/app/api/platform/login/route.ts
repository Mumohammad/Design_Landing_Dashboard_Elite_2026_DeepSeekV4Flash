import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Authenticate user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 401 });
    }

    // Get tenant info
    const { data: membership } = await supabase
      .from('tenant_memberships')
      .select('tenant_id, tenants(name, logo_url, brand_colors, slug)')
      .eq('user_id', authData.user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'User not associated with any company' }, { status: 403 });
    }

    const tenant = membership.tenants;

    return NextResponse.json({
      user: authData.user,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        logo_url: tenant.logo_url,
        brand_colors: tenant.brand_colors,
        slug: tenant.slug,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
