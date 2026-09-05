import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Verifies the caller is a signed-in user on the platform_admins allowlist.
 * The Bearer access token comes from the browser Supabase session; the admin
 * check itself runs with the service role so RLS never weakens this boundary.
 */
export async function requirePlatformAdmin(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: 'unauthorized' as const, status: 401 as const };

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return { error: 'unauthorized' as const, status: 401 as const };

  const service = serviceClient();
  const { data: adminRow } = await service
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!adminRow) return { error: 'forbidden' as const, status: 403 as const };
  return { user, service };
}
