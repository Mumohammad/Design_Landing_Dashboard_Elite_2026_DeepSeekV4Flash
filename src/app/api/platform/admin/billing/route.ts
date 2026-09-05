import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data: invoices, error } = await guard.service
    .from('platform_invoices')
    .select('id, tenant_id, invoice_number, period_label, amount, currency, status, due_date, paid_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: tenants } = await guard.service.from('tenants').select('id, name_en, billing_status');
  const names = new Map((tenants ?? []).map(t => [t.id, t.name_en]));

  const list = invoices ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  return NextResponse.json({
    invoices: list.map(i => ({ ...i, company_name: names.get(i.tenant_id) ?? '—' })),
    summary: {
      pending_amount: list.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount), 0),
      overdue_amount: list.filter(i => i.status === 'overdue').reduce((s, i) => s + Number(i.amount), 0),
      paid_this_month: list.filter(i => i.status === 'paid' && i.paid_at && i.paid_at >= monthStart).reduce((s, i) => s + Number(i.amount), 0),
      unpaid_companies: (tenants ?? []).filter(t => t.billing_status === 'unpaid' || t.billing_status === 'past_due').length,
    },
  });
}

export async function POST(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { tenant_id, amount, period_label, due_date, notes } = await req.json();
    if (!tenant_id || !amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'tenant_id and amount > 0 are required' }, { status: 400 });
    }

    const invoiceNumber = `PLT-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await guard.service.from('platform_invoices').insert({
      tenant_id,
      invoice_number: invoiceNumber,
      period_label: period_label ?? null,
      amount,
      due_date: due_date ?? null,
      notes: notes ?? null,
      created_by: guard.userId,
    }).select('id').single();
    if (error) throw error;

    await guard.service.from('audit_log').insert({
      tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'platform_invoices', entity_id: data.id, action: 'invoice_created', new_values: { amount, period_label },
    });

    return NextResponse.json({ success: true, invoice_id: data.id, invoice_number: invoiceNumber });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create invoice' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { invoice_id, action } = await req.json();
    if (!invoice_id || action !== 'mark_paid') {
      return NextResponse.json({ error: 'invoice_id and action=mark_paid required' }, { status: 400 });
    }

    const { data: invoice, error: fetchError } = await guard.service
      .from('platform_invoices').select('tenant_id, status').eq('id', invoice_id).single();
    if (fetchError) throw fetchError;
    if (invoice.status === 'paid') return NextResponse.json({ error: 'Already paid' }, { status: 409 });

    const { error } = await guard.service.from('platform_invoices').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', invoice_id);
    if (error) throw error;

    await guard.service.from('tenants').update({ billing_status: 'active_paid', updated_by: guard.userId }).eq('id', invoice.tenant_id);

    await guard.service.from('audit_log').insert({
      tenant_id: invoice.tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'platform_invoices', entity_id: invoice_id, action: 'invoice_marked_paid', new_values: { status: 'paid' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 500 });
  }
}
