-- New manual receivables and their audit evidence commit together. Existing
-- financial rows remain untouched; only new requests receive an identity.
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS request_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS receivables_tenant_request
  ON public.receivables(tenant_id, request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_manual_receivable_atomic(
  p_receivable jsonb, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_actor uuid := auth.uid();
  v_reference text;
  v_date date;
  v_due date;
  v_amount numeric(12,2);
  v_rate numeric;
  v_vat numeric(12,2);
  v_total numeric(12,2);
  v_request jsonb;
  v_row public.receivables%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'AR_AUTH: active tenant account required' USING ERRCODE = '42501';
  END IF;
  -- This is the same authoritative permission/MFA boundary used by RLS.
  IF public.user_has_permission('accounting', 'create') IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_PERMISSION: accounting:create required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_receivable IS NULL OR jsonb_typeof(p_receivable) <> 'object' THEN
    RAISE EXCEPTION 'AR_INPUT: invalid manual receivable details' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_receivable) AS k(key)
    WHERE key NOT IN ('invoice_ref','invoice_date','due_date','amount','vat_rate'))
    OR jsonb_typeof(p_receivable->'invoice_ref') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receivable->'invoice_date') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receivable->'due_date') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receivable->'amount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_receivable->'vat_rate') IS DISTINCT FROM 'number'
    OR (p_receivable->>'invoice_date') !~ '^\d{4}-\d{2}-\d{2}$'
    OR (p_receivable->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'AR_INPUT: invalid manual receivable details' USING ERRCODE = '22023';
  END IF;
  v_reference := btrim(p_receivable->>'invoice_ref');
  v_date := (p_receivable->>'invoice_date')::date;
  v_due := (p_receivable->>'due_date')::date;
  v_amount := round((p_receivable->>'amount')::numeric, 2);
  v_rate := (p_receivable->>'vat_rate')::numeric;
  IF char_length(v_reference) NOT BETWEEN 1 AND 200 OR v_amount <= 0
    OR v_rate < 0 OR v_rate > 100 OR v_due < v_date THEN
    RAISE EXCEPTION 'AR_INPUT: invalid manual receivable details' USING ERRCODE = '22023';
  END IF;
  -- Exact base-10 calculation before NUMERIC(12,2) persistence, including .615.
  v_vat := round(v_amount * v_rate / 100, 2);
  v_total := v_amount + v_vat;
  v_request := jsonb_build_object('invoice_ref',v_reference,'invoice_date',v_date,
    'due_date',v_due,'amount',v_amount,'vat_rate',v_rate);

  PERFORM pg_advisory_xact_lock(hashtextextended('manual-ar:' || v_tenant::text || ':' || p_request_id::text, 0));
  SELECT * INTO v_row FROM public.receivables WHERE tenant_id = v_tenant AND request_id = p_request_id;
  IF FOUND THEN
    IF v_row.request_payload IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'AR_RETRY: request identifier already used for different details';
    END IF;
    IF v_row.deleted_at IS NOT NULL OR v_row.source_entity_type IS DISTINCT FROM 'manual'
      OR v_row.invoice_ref IS DISTINCT FROM v_reference OR v_row.invoice_date IS DISTINCT FROM v_date
      OR v_row.due_date IS DISTINCT FROM v_due OR v_row.amount IS DISTINCT FROM v_amount
      OR v_row.vat_amount IS DISTINCT FROM v_vat OR v_row.total_amount IS DISTINCT FROM v_total
      OR NOT EXISTS (SELECT 1 FROM public.audit_log WHERE tenant_id = v_tenant
        AND entity_id = v_row.id AND entity_type = 'receivables' AND action = 'receivable_created') THEN
      RAISE EXCEPTION 'AR_RETRY_UNAVAILABLE: original receivable needs review';
    END IF;
    RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'replayed',true);
  END IF;

  INSERT INTO public.receivables (tenant_id,invoice_ref,invoice_date,due_date,amount,
    vat_amount,total_amount,paid_amount,status,source_entity_type,created_by,request_id,request_payload)
  VALUES (v_tenant,v_reference,v_date,v_due,v_amount,v_vat,v_total,0,'open','manual',v_actor,p_request_id,v_request)
  RETURNING * INTO v_row;
  INSERT INTO public.audit_log (tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES (v_tenant,v_actor,'accounting','receivables',v_row.id,'receivable_created',
    jsonb_build_object('invoice_ref',v_reference,'total_amount',v_total,'vat_amount',v_vat,'request_id',p_request_id));
  RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'replayed',false);
END $$;

-- Callers cannot forge/retarget the creation identity through the Data API.
-- Service-side payment/soft-delete workflows can still update their existing
-- fields; this does not invent posting, approval, editing or reversal semantics.
CREATE OR REPLACE FUNCTION public.protect_manual_receivable_request()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('authenticated','anon') AND (NEW.request_id IS NOT NULL OR NEW.request_payload IS NOT NULL) THEN
      RAISE EXCEPTION 'AR_MANAGED: use the guarded receivable transaction' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF current_user IN ('authenticated','anon') AND (OLD.request_id IS NOT NULL OR NEW.request_id IS NOT NULL
      OR NEW.request_payload IS NOT NULL) THEN
      RAISE EXCEPTION 'AR_MANAGED: use the guarded receivable transaction' USING ERRCODE = '42501';
    END IF;
    IF OLD.request_id IS NOT NULL AND (NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.request_payload IS DISTINCT FROM OLD.request_payload OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'AR_IDENTITY: receivable request identity is immutable';
    END IF;
    RETURN NEW;
  ELSE
    IF current_user IN ('authenticated','anon') AND OLD.request_id IS NOT NULL THEN
      RAISE EXCEPTION 'AR_MANAGED: use the guarded receivable transaction' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
END $$;
CREATE OR REPLACE TRIGGER protect_manual_receivable_request
  BEFORE INSERT OR UPDATE OR DELETE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.protect_manual_receivable_request();
REVOKE ALL ON FUNCTION public.create_manual_receivable_atomic(jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_receivable_atomic(jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.protect_manual_receivable_request() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protect_manual_receivable_request() TO service_role;
NOTIFY pgrst, 'reload schema';
