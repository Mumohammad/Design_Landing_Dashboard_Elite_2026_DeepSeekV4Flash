import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const createCompanySchema = z.object({
  name: z.string().min(2).max(100),
  legal_name: z.string().min(2).max(200),
  domain: z.string().email().or(z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8),
  plan_tier: z.enum(['starter', 'pro', 'enterprise']).optional().default('starter'),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const body = await req.json();
    const validated = createCompanySchema.parse(body);

    const { data: existing } = await supabase.from('platform_companies').select('id').or(`slug.eq.${validated.slug},domain.eq.${validated.domain}`).single();
    if (existing) return NextResponse.json({ message: 'Company slug or domain already exists' }, { status: 409 });

    const { data: company, error: companyError } = await supabase.from('platform_companies').insert({ name: validated.name, legal_name: validated.legal_name, domain: validated.domain, slug: validated.slug, plan_tier: validated.plan_tier }).select().single();
    if (companyError) return NextResponse.json({ message: 'Failed to create company', error: companyError.message }, { status: 500 });

    const { data: authData, error: authError } = await supabase.rpc('create_platform_user', { p_email: validated.email, p_password: validated.password, p_company_id: company.id, p_role: 'admin' });
    if (authError) {
      await supabase.from('platform_companies').delete().eq('id', company.id);
      return NextResponse.json({ message: 'Failed to create user account', error: authError.message }, { status: 500 });
    }

    const { data: user, error: userError } = await supabase.from('platform_users').insert({ id: authData.user_id, company_id: company.id, role: 'admin', email: validated.email }).select().single();
    if (userError) return NextResponse.json({ message: 'Failed to link user to company', error: userError.message }, { status: 500 });

    await supabase.from('platform_subscriptions').insert({ company_id: company.id, plan_tier: validated.plan_tier, status: 'trial', end_date: new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0] });

    return NextResponse.json({ company, user });
  } catch (error) {
    console.error('API error:', error);
    if (error instanceof z.ZodError) return NextResponse.json({ message: 'Validation failed', errors: error.issues }, { status: 400 });
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
