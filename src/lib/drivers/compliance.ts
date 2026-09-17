import { createClient } from '@/lib/supabase/server';

export type ComplianceLevel =
  | 'fully_compliant'
  | 'compliant_warnings'
  | 'pending_review'
  | 'non_compliant'
  | 'critical_block'
  | 'suspended';

export type ComplianceRequirementStatus =
  | 'valid'
  | 'missing'
  | 'expired'
  | 'expiring'
  | 'pending_review'
  | 'not_required'
  | 'override_active'
  | 'suspended'
  | 'blocked';

export type ComplianceRequirement = {
  key: string;
  status: ComplianceRequirementStatus;
  blocker: boolean;
  detail?: string | null;
  override: boolean;
};

export type ComplianceResult = {
  id: string;
  driver_id: string;
  run_at: string;
  level: ComplianceLevel;
  score: number;
  details: {
    level?: string;
    score?: number;
    blockers?: number;
    missing?: number;
    pending?: number;
    warnings?: number;
    requirements?: ComplianceRequirement[];
    computed_at?: string;
  };
  triggered_by: string | null;
  created_at: string;
};

/**
 * Fetches the most recent compliance results for a driver, scoped to the
 * caller's tenant by RLS (tenant policy via public.get_my_tenant_id()).
 */
export async function listRecentResults(
  driverId: string,
  limit = 5
): Promise<{ data: ComplianceResult[] | null; error: Error | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('driver_compliance_results')
    .select('*')
    .eq('driver_id', driverId)
    .order('run_at', { ascending: false })
    .limit(limit);

  return { data: (data as ComplianceResult[] | null) ?? null, error };
}

/**
 * Returns the latest compliance result for a driver, or null if none exists.
 */
export async function getLatestResult(
  driverId: string
): Promise<{ data: ComplianceResult | null; error: Error | null }> {
  const { data, error } = await listRecentResults(driverId, 1);
  return { data: data?.[0] ?? null, error };
}
