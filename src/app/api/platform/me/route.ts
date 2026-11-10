import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/platform/me → the signed-in user's tenant (for client-side
// branding hydration). Returns null tenant when unauthenticated.
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ tenant: null }, { status: 401 });
    }

    const { data: membership, error } = await supabase
      .from('tenant_memberships')
      .select('tenant_id, tenants(name_en, name_ar, logo_url, brand_colors, slug)')
      .eq('user_id', user.id)
      .single();

    if (error || !membership) {
      return NextResponse.json({ tenant: null }, { status: 401 });
    }

    const tenantData = (membership.tenants ?? null) as unknown as {
      name_en: string | null;
      name_ar: string | null;
      logo_url: string | null;
      brand_colors: { primary?: string; secondary?: string } | null;
      slug: string;
    } | null;

    return NextResponse.json({
      tenant: {
        id: membership.tenant_id,
        name: tenantData?.name_en || tenantData?.name_ar || '',
        name_ar: tenantData?.name_ar ?? null,
        logo_url: tenantData?.logo_url ?? null,
        brand_colors: tenantData?.brand_colors ?? null,
        slug: tenantData?.slug ?? '',
      },
    });
  } catch (error) {
    console.error('me error:', error);
    return NextResponse.json({ tenant: null }, { status: 500 });
  }
}
