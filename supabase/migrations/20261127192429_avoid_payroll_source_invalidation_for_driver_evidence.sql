BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION payroll_guard_private.bump_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  evidence_fields constant text[] := ARRAY[
    'photo_url',
    'compliance_risk_score',
    'documents_complete',
    'last_compliance_review_at',
    'dispatch_eligible',
    'profile_version',
    'updated_at',
    'updated_by'
  ];
BEGIN
  -- Evidence changes update the photo or derived compliance fields and touch profile
  -- bookkeeping. Preserve invalidation when any other driver field changes.
  IF TG_OP = 'UPDATE' AND TG_RELID = 'public.drivers'::regclass THEN
    IF (to_jsonb(OLD) - evidence_fields) IS NOT DISTINCT FROM (to_jsonb(NEW) - evidence_fields) THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-source:' || tenant::text, 0));
  INSERT INTO payroll_guard_private.source_versions(tenant_id, version)
  VALUES (tenant, 1)
  ON CONFLICT (tenant_id) DO UPDATE
  SET version = payroll_guard_private.source_versions.version + 1;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION payroll_guard_private.bump_source() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
