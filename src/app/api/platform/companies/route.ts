import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

const createCompanySchema = z.object({
  name: z.string().min(2).max(100),
  legal_name: z.string().min(2).max(200),
  domain: z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50),
  email: z.string().email(),
  password: z.string().min(10).regex(/[A-Za-z]/).regex(/[0-9]/),
  plan_tier: z.enum(['starter', 'pro', 'enterprise']).optional().default('starter'),
});

export async function POST(req: NextRequest) {
  try {
    // FX-01: /api is excluded from the proxy matcher — this route self-guards.
    // Platform-admin only, via Bearer token. Never reachable anonymously again.
    const guard = await verifyPlatformAdmin(req);
    if (!guard.ok) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: guard.status });
    }
    const supabase = guard.service;

    const body = await req.json();
    const validated = createCompanySchema.parse(body);

    const { data: existing } = await supabase
      .from('platform_companies')
      .select('id')
      .or(`slug.eq.${validated.slug},domain.eq.${validated.domain}`)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ message: 'Company slug or domain already exists' }, { status: 409 });
    }

    const { data: company, error: companyError } = await supabase
      .from('platform_companies')
      .insert({
        name: validated.name,
        legal_name: validated.legal_name,
        domain: validated.domain,
        slug: validated.slug,
        plan_tier: validated.plan_tier,
      })
      .select('id, slug')
      .single();
    if (companyError) {
      console.error('company insert failed:', companyError.message);
      return NextResponse.json({ message: 'Failed to create company' }, { status: 500 });
    }

    const { data: authData, error: authError } = await supabase.rpc('create_platform_user', {
      p_email: validated.email,
      p_password: validated.password,
      p_company_id: company.id,
      p_role: 'admin',
    });
    if (authError) {
      await supabase.from('platform_companies').delete().eq('id', company.id);
      console.error('create_platform_user failed:', authError.message);
      return NextResponse.json({ message: 'Failed to create user account' }, { status: 500 });
    }

    const { error: userError } = await supabase
      .from('platform_users')
      .insert({ id: authData.user_id, company_id: company.id, role: 'admin', email: validated.email });
    if (userError) {
      // Compensate BOTH prior writes — the original code orphaned the auth user.
      await supabase.auth.admin.deleteUser(authData.user_id);
      await supabase.from('platform_companies').delete().eq('id', company.id);
      console.error('platform_users insert failed:', userError.message);
      return NextResponse.json({ message: 'Failed to link user to company' }, { status: 500 });
    }

    await supabase.from('platform_subscriptions').insert({
      company_id: company.id,
      plan_tier: validated.plan_tier,
      status: 'trial',
      end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });

    return NextResponse.json({ company_id: company.id, slug: company.slug }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Validation failed', errors: error.issues }, { status: 400 });
    }
    console.error('API error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
