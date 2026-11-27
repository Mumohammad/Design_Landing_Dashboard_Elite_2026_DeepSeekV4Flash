BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Definition IDs bind new sheet mappings to the tenant's current configuration.
-- Historical snapshots and older payloads have no ID and retain their existing
-- behavior. A committed retry returns from the import receipt before any write.
CREATE FUNCTION payroll_guard_private.check_income_field_mapping() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  mapped jsonb;
  field_id text;
BEGIN
  IF NEW.run_id IS NOT NULL OR jsonb_typeof(NEW.custom_fields) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  FOR mapped IN
    SELECT value FROM jsonb_array_elements(NEW.custom_fields) WHERE value ? 'field_id'
  LOOP
    field_id := mapped->>'field_id';
    IF field_id IS NULL OR field_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'PAYENG024: A mapped income field changed. Reopen the import and map the columns again.';
    END IF;

    PERFORM 1 FROM public.payroll_custom_income_fields AS definition
    WHERE definition.id = field_id::uuid AND definition.tenant_id = NEW.tenant_id
      AND definition.is_active AND definition.name = mapped->>'name' AND definition.field_type = mapped->>'type'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAYENG024: A mapped income field changed. Reopen the import and map the columns again.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION payroll_guard_private.check_income_field_mapping() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER payroll_income_check_field_mapping
  BEFORE INSERT OR UPDATE OF custom_fields ON public.payroll_income_records
  FOR EACH ROW EXECUTE FUNCTION payroll_guard_private.check_income_field_mapping();
COMMIT;
