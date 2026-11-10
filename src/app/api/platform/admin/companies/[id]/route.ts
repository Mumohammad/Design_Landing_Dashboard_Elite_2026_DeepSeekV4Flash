import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform/admin';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requirePlatformAdmin(req);
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { id } = await params;
  const { status } = await req.json();

  if (!['active', 'suspended'].includes(status)) {
    return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 });
  }

  const { error } = await ctx.service
    .from('tenants')
    .update({ status, updated_by: ctx.user.id, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
