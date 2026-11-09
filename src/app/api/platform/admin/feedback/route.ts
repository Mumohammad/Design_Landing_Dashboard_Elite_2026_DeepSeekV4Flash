import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

// Platform support inbox for in-app feedback (app_feedback).
export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data, error } = await guard.service
    .from('app_feedback')
    .select('id, tenant_id, kind, message, page_path, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: 'Unable to load feedback' }, { status: 500 });

  const { data: tenants } = await guard.service.from('tenants').select('id, name_en');
  const names = new Map((tenants ?? []).map(t => [t.id, t.name_en]));
  return NextResponse.json({ feedback: (data ?? []).map(f => ({ ...f, company_name: names.get(f.tenant_id) ?? '—' })) });
}

const patchSchema = z.object({ id: z.string().uuid(), status: z.enum(['new', 'triaged', 'closed']) });

export async function PATCH(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { data, error } = await guard.service
    .from('app_feedback')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)
    .select('id, tenant_id')
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
  await guard.service.from('audit_log').insert({
    tenant_id: data.tenant_id, actor_id: guard.userId, module: 'platform_admin',
    entity_type: 'app_feedback', entity_id: data.id, action: 'feedback_status_changed', new_values: { status: parsed.data.status },
  });
  return NextResponse.json({ success: true });
}
