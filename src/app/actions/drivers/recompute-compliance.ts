'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const inputSchema = z.object({
  driverId: z.uuid('driverId must be a valid UUID'),
});

export type RecomputeResult =
  | {
      ok: true;
      level: string;
      score: number;
      blockers: number;
      missing: number;
      pending: number;
      warnings: number;
    }
  | { ok: false; error: string };

/**
 * Recompute compliance for one driver.
 *
 * Server boundary only. Authenticates the caller, verifies the driver row is
 * visible through RLS (tenant isolation via public.get_my_tenant_id()), then
 * invokes the service_role-only compute_driver_compliance() engine through
 * the admin client. Returns a sanitized summary — internal requirement
 * details never reach the browser.
 */
export async function recomputeDriverCompliance(input: unknown): Promise<RecomputeResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid driver ID format' };
  }
  const { driverId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: 'Unauthenticated' };
  }

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id')
    .eq('id', driverId)
    .single();

  if (driverError || !driver) {
    // Deliberately vague: do not leak existence across tenants.
    return { ok: false, error: 'Driver not found' };
  }

  const admin = createAdminClient();
  const { data, error: rpcError } = await admin.rpc('compute_driver_compliance', {
    p_driver_id: driverId,
  });

  if (rpcError) {
    console.error('compute_driver_compliance failed', { driverId, message: rpcError.message });
    return { ok: false, error: 'Compliance engine unavailable' };
  }

  if (data?.error) {
    return { ok: false, error: data.error };
  }

  revalidatePath(`/drivers/${driverId}`);
  revalidatePath('/drivers');

  return {
    ok: true,
    level: data.level,
    score: data.score,
    blockers: data.blockers,
    missing: data.missing,
    pending: data.pending,
    warnings: data.warnings,
  };
}
