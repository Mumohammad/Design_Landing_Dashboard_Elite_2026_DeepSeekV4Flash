import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';

const ROLE_ENUM = ['general_manager','admin','accountant','supervisor','hr_officer','operations_officer','payroll_officer','platform_coordinator','readonly_auditor'];

export async function GET(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  const { data: users, error } = await guard.service
    .from('users')
    .select('id, auth_user_id, tenant_id, email, full_name_en, full_name_ar, role, status, created_at, last_login_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: tenants } = await guard.service.from('tenants').select('id, name_en');
  const names = new Map((tenants ?? []).map(t => [t.id, t.name_en]));

  return NextResponse.json({
    users: (users ?? []).map(u => ({ ...u, company_name: names.get(u.tenant_id) ?? '—' })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { tenant_id, email, full_name, role, password } = await req.json();
    if (!tenant_id || !email) return NextResponse.json({ error: 'tenant_id and email are required' }, { status: 400 });
    if (role && !ROLE_ENUM.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

    const service = guard.service;

    let authUserId: string;
    if (password) {
      const { data, error } = await service.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { _invite_provisioned: true, full_name_en: full_name ?? null },
      });
      if (error) throw error;
      authUserId = data.user!.id;
    } else {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
        data: { _invite_provisioned: true, full_name_en: full_name ?? null },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/accept-invite`,
      });
      if (error) throw error;
      authUserId = data.user!.id;
    }

    const { error: userError } = await service.from('users').upsert({
      auth_user_id: authUserId,
      tenant_id,
      email,
      full_name_en: full_name ?? null,
      role: role ?? 'readonly_auditor',
      status: password ? 'active' : 'pending_invite',
      invited_by: guard.userId,
      invited_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    if (userError) throw userError;

    const { data: pubUser } = await service.from('users').select('id').eq('auth_user_id', authUserId).single();
    if (pubUser) {
      await service.from('tenant_memberships').upsert({ tenant_id, user_id: pubUser.id, is_primary: true });
    }

    await service.from('audit_log').insert({
      tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'users', entity_id: pubUser?.id ?? null, action: 'user_created', new_values: { email, role: role ?? 'readonly_auditor' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create user' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { user_id, role, status, reset_password } = await req.json();
    if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
    if (role && !ROLE_ENUM.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

    const updates: Record<string, unknown> = { updated_by: guard.userId, updated_at: new Date().toISOString() };
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;

    const { error } = await guard.service.from('users').update(updates).eq('id', user_id);
    if (error) throw error;

    if (reset_password) {
      const { data: target } = await guard.service.from('users').select('email').eq('id', user_id).single();
      if (target?.email) {
        await guard.service.auth.resetPasswordForEmail(target.email, {
          redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/reset-password`,
        });
      }
    }

    const { data: targetRow } = await guard.service.from('users').select('tenant_id').eq('id', user_id).single();
    await guard.service.from('audit_log').insert({
      tenant_id: targetRow?.tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'users', entity_id: user_id, action: reset_password ? 'user_password_reset_sent' : 'user_updated', new_values: updates,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await verifyPlatformAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: 'Forbidden' }, { status: guard.status });

  try {
    const { user_id } = await req.json();
    if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

    const { error } = await guard.service.from('users').update({
      status: 'terminated',
      deleted_at: new Date().toISOString(),
      updated_by: guard.userId,
    }).eq('id', user_id);
    if (error) throw error;

    const { data: targetRow } = await guard.service.from('users').select('tenant_id').eq('id', user_id).single();
    await guard.service.from('audit_log').insert({
      tenant_id: targetRow?.tenant_id, actor_id: guard.userId, module: 'platform_admin',
      entity_type: 'users', entity_id: user_id, action: 'user_deactivated', new_values: { deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Delete failed' }, { status: 500 });
  }
}
