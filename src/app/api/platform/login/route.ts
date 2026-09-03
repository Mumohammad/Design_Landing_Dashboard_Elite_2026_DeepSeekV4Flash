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

    if (!authData.user) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 401 });
    }

    // Get tenant info
    const { data: membership, error: membershipError } = await supabase
      .from('tenant_memberships')
      .select('tenant_id, tenants(name, logo_url, brand_colors, slug)')
      .eq('user_id', authData.user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'User not associated with any company' }, { status: 403 });
    }

    const tenantData = membership.tenants as any;

    return NextResponse.json({
      user: authData.user,
      tenant: {
        id: membership.tenant_id,
        name: tenantData.name,
        logo_url: tenantData.logo_url,
        brand_colors: tenantData.brand_colors,
        slug: tenantData.slug,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
