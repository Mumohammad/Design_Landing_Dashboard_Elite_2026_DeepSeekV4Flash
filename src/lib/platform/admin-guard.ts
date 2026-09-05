import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

type GuardOk = { ok: true; userId: string; email: string | null; service: SupabaseClient };
type GuardFail = { ok: false; status: 401 | 403 };

export async function verifyPlatformAdmin(req: NextRequest): Promise<GuardOk | GuardFail> {
  const header = req.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401 };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401 };

  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: admin } = await service
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!admin) return { ok: false, status: 403 };

  return { ok: true, userId: user.id, email: user.email ?? null, service };
}
