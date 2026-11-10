-- New pending expenses and their creation audit commit together. Historical
-- records keep NULL identities; no financial data is backfilled or rewritten.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS request_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_tenant_request
  ON public.expenses(tenant_id,request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_expense_atomic(p_expense jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_tenant uuid:=public.get_my_tenant_id();
  v_actor uuid:=auth.uid();
  v_type text;
  v_category text;
  v_vendor text;
  v_description text;
  v_date date;
  v_amount numeric(10,2);
  v_rate numeric(5,2);
  v_request jsonb;
  v_row public.expenses%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'EXP_AUTH: active tenant account required' USING ERRCODE='42501';
  END IF;
  IF public.user_has_permission('expenses','create') IS NOT TRUE THEN
    RAISE EXCEPTION 'EXP_PERMISSION: expenses:create required' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_expense IS NULL OR jsonb_typeof(p_expense)<>'object' THEN
    RAISE EXCEPTION 'EXP_INPUT: invalid pending expense details' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_expense) AS k(key) WHERE key NOT IN
      ('expense_type','category','amount','expense_date','vendor','description','vat_rate'))
    OR jsonb_typeof(p_expense->'expense_type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_expense->'expense_date') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_expense->'amount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_expense->'vat_rate') IS DISTINCT FROM 'number'
    OR (p_expense->>'expense_date') !~ '^\d{4}-\d{2}-\d{2}$'
    OR EXISTS(SELECT 1 FROM jsonb_each(p_expense) AS e(key,value)
      WHERE key IN('category','vendor','description') AND jsonb_typeof(value) NOT IN('string','null'))
    OR (p_expense->>'vat_rate')::numeric NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'EXP_INPUT: invalid pending expense details' USING ERRCODE='22023';
  END IF;
  v_type:=p_expense->>'expense_type';
  v_date:=(p_expense->>'expense_date')::date;
  v_amount:=round((p_expense->>'amount')::numeric,2);
  v_rate:=round((p_expense->>'vat_rate')::numeric,2);
  v_category:=nullif(btrim(p_expense->>'category'),'');
  v_vendor:=nullif(btrim(p_expense->>'vendor'),'');
  v_description:=nullif(btrim(p_expense->>'description'),'');
  IF v_type NOT IN('fuel','advance','operational','platform_commission','maintenance','other')
    OR v_amount<=0 OR char_length(v_category)>200 OR char_length(v_vendor)>200
    OR char_length(v_description)>2000 THEN
    RAISE EXCEPTION 'EXP_INPUT: invalid pending expense details' USING ERRCODE='22023';
  END IF;
  v_request:=jsonb_build_object('expense_type',v_type,'expense_date',v_date,'amount',v_amount,
    'vat_rate',v_rate,'category',v_category,'vendor',v_vendor,'description',v_description);
  PERFORM pg_advisory_xact_lock(hashtextextended('expense-create:'||v_tenant::text||':'||p_request_id::text,0));
  SELECT * INTO v_row FROM public.expenses WHERE tenant_id=v_tenant AND request_id=p_request_id;
  IF FOUND THEN
    IF v_row.request_payload IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'EXP_RETRY: request identifier already used for different details';
    END IF;
    IF v_row.deleted_at IS NOT NULL OR v_row.expense_type IS DISTINCT FROM v_type
      OR v_row.expense_date IS DISTINCT FROM v_date OR v_row.amount IS DISTINCT FROM v_amount
      OR v_row.currency IS DISTINCT FROM 'SAR' OR v_row.category IS DISTINCT FROM v_category
      OR v_row.vendor IS DISTINCT FROM v_vendor OR v_row.description IS DISTINCT FROM v_description
      OR (NOT v_row.is_approved AND v_row.vat_rate IS DISTINCT FROM v_rate)
      OR NOT EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id=v_tenant
        AND entity_type='expenses' AND entity_id=v_row.id AND action='expense_created') THEN
      RAISE EXCEPTION 'EXP_RETRY_UNAVAILABLE: original expense needs review';
    END IF;
    RETURN jsonb_build_object('id',v_row.id,'expense_code',v_row.expense_code,'replayed',true);
  END IF;
  INSERT INTO public.expenses(tenant_id,expense_type,category,amount,currency,expense_date,
    vendor,description,vat_rate,is_approved,created_by,request_id,request_payload)
  VALUES(v_tenant,v_type,v_category,v_amount,'SAR',v_date,v_vendor,v_description,v_rate,false,
    v_actor,p_request_id,v_request) RETURNING * INTO v_row;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(v_tenant,v_actor,'expenses','expenses',v_row.id,'expense_created',
    v_request||jsonb_build_object('expense_code',v_row.expense_code,'request_id',p_request_id));
  RETURN jsonb_build_object('id',v_row.id,'expense_code',v_row.expense_code,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.protect_expense_request()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    -- All new caller-created expenses must pass the atomic audit boundary.
    -- Existing trusted service imports and disposable fixtures are unchanged.
    IF current_user IN('authenticated','anon') THEN
      RAISE EXCEPTION 'EXP_MANAGED: use the guarded expense transaction' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='UPDATE' THEN
    IF current_user IN('authenticated','anon') AND(OLD.request_id IS NOT NULL
      OR NEW.request_id IS NOT NULL OR NEW.request_payload IS NOT NULL) THEN
      RAISE EXCEPTION 'EXP_MANAGED: use the guarded expense transaction' USING ERRCODE='42501';
    END IF;
    IF OLD.request_id IS NOT NULL AND(NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.request_payload IS DISTINCT FROM OLD.request_payload OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
      RAISE EXCEPTION 'EXP_IDENTITY: expense request identity is immutable';
    END IF;
    RETURN NEW;
  ELSE
    IF current_user IN('authenticated','anon') AND OLD.request_id IS NOT NULL THEN
      RAISE EXCEPTION 'EXP_MANAGED: use the guarded expense transaction' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
END $$;
CREATE OR REPLACE TRIGGER protect_expense_request BEFORE INSERT OR UPDATE OR DELETE
  ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.protect_expense_request();
REVOKE ALL ON FUNCTION public.create_expense_atomic(jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_expense_atomic(jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.protect_expense_request() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protect_expense_request() TO service_role;
NOTIFY pgrst,'reload schema';
