-- Adopt the reviewed invoice bank and paid-intent contract on legacy installations.
-- Current installations take the read-only branch. No finance records or ACLs are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;

DO $reconcile$
DECLARE
  draft_routine pg_proc%ROWTYPE;
  known_legacy CONSTANT text := 'fc1c9825893fbee24616622406eebe9c';
  known_current CONSTANT text := 'c64edb41e1604414ad8f7cf7f84c3955';
  invoice_table CONSTANT regclass := 'public.invoices'::regclass;
  draft_hash text;
  columns_present integer;
  matching_columns integer;
  bank_index regclass := to_regclass('public.idx_invoices_bank_account');
  bank_key pg_constraint%ROWTYPE;
  paid_check pg_constraint%ROWTYPE;
BEGIN
  SELECT * INTO draft_routine FROM pg_proc
  WHERE oid = to_regprocedure('public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid)');
  IF NOT FOUND
    OR draft_routine.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    OR draft_routine.prokind <> 'f'
    OR draft_routine.prorettype <> 'jsonb'::regtype
    OR NOT draft_routine.prosecdef
    OR draft_routine.proisstrict
    OR draft_routine.proparallel <> 'u'
    OR draft_routine.provolatile <> 'v'
    OR draft_routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR NOT has_function_privilege('authenticated', draft_routine.oid, 'EXECUTE')
    OR has_function_privilege('anon', draft_routine.oid, 'EXECUTE')
    OR has_function_privilege('service_role', draft_routine.oid, 'EXECUTE')
    OR EXISTS (
      SELECT FROM aclexplode(coalesce(draft_routine.proacl, acldefault('f', draft_routine.proowner)))
      WHERE grantee = 0 AND privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'INVOICE_CONTRACT_REVIEW_REQUIRED: unexpected draft routine properties';
  END IF;

  draft_hash := md5(replace(draft_routine.prosrc, E'\r\n', E'\n'));

  SELECT count(*), count(*) FILTER (
    WHERE format_type(a.atttypid, a.atttypmod) = expected.type_name
      AND a.attnotnull = expected.required
      AND pg_get_expr(def.adbin, def.adrelid) IS NOT DISTINCT FROM expected.default_expr
      AND a.attgenerated = '' AND a.attidentity = ''
  ) INTO columns_present, matching_columns
  FROM (VALUES
    ('bank_account_id', 'uuid', false, NULL::text),
    ('already_paid', 'boolean', true, 'false'),
    ('already_paid_method', 'text', false, NULL::text)
  ) expected(name, type_name, required, default_expr)
  JOIN pg_attribute a ON a.attrelid = invoice_table AND a.attname = expected.name
    AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum;

  SELECT * INTO bank_key FROM pg_constraint
    WHERE conrelid = invoice_table AND conname = 'invoices_bank_account_id_fkey';
  SELECT * INTO paid_check FROM pg_constraint
    WHERE conrelid = invoice_table AND conname = 'invoices_already_paid_method_check';

  IF draft_hash = known_current AND matching_columns = 3
    AND pg_get_constraintdef(bank_key.oid, true) = 'FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)'
    AND bank_key.convalidated
    AND paid_check.convalidated
    AND pg_get_expr(paid_check.conbin, invoice_table, true) =
      'NOT already_paid AND already_paid_method IS NULL OR already_paid AND (already_paid_method = ANY (ARRAY[''cash''::text, ''transfer''::text, ''card''::text, ''cheque''::text]))'
    AND pg_get_indexdef(bank_index) =
      'CREATE INDEX idx_invoices_bank_account ON public.invoices USING btree (bank_account_id) WHERE (bank_account_id IS NOT NULL)'
    AND EXISTS (SELECT FROM pg_index WHERE indexrelid = bank_index AND indisvalid AND indisready) THEN
    RETURN;
  END IF;

  IF draft_hash IS DISTINCT FROM known_legacy OR columns_present <> 0
    OR bank_index IS NOT NULL OR bank_key.oid IS NOT NULL OR paid_check.oid IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'INVOICE_CONTRACT_REVIEW_REQUIRED: unexpected or partial invoice catalog';
  END IF;

  ALTER TABLE public.invoices
    ADD COLUMN bank_account_id uuid REFERENCES public.bank_accounts(id),
    ADD COLUMN already_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN already_paid_method text,
    ADD CONSTRAINT invoices_already_paid_method_check
      CHECK ((NOT already_paid AND already_paid_method IS NULL)
        OR (already_paid AND already_paid_method IN ('cash', 'transfer', 'card', 'cheque')));
  CREATE INDEX idx_invoices_bank_account ON public.invoices (bank_account_id)
    WHERE bank_account_id IS NOT NULL;

  EXECUTE $draft$
CREATE OR REPLACE FUNCTION public.save_my_invoice_draft(p_input jsonb,p_invoice_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();h text;r invoice_workflow_private.draft_receipts%ROWTYPE;response jsonb;
 v_bank uuid;v_paid boolean:=false;v_method text;v_stamp timestamptz;
BEGIN
 IF t IS NULL OR a IS NULL OR NOT public.user_has_permission('invoices',CASE WHEN p_invoice_id IS NULL THEN 'create' ELSE 'update' END) THEN RAISE EXCEPTION 'AUTH007: invoice permission required';END IF;
 IF p_request_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'INV002: draft request identity and input required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-draft:'||t::text||':'||a::text||':'||p_request_id::text,0));
 h:=encode(extensions.digest(jsonb_build_object('input',p_input,'invoice_id',p_invoice_id,'expected_updated_at',to_char(p_expected_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256'),'hex');
 SELECT * INTO r FROM invoice_workflow_private.draft_receipts WHERE tenant_id=t AND actor_id=a AND request_id=p_request_id;
 IF FOUND THEN
  IF r.payload_hash<>h THEN RAISE EXCEPTION 'INV015: draft request identifies different details; reload before a new request';END IF;
  RETURN r.response||jsonb_build_object('replayed',true);
 END IF;
 IF coalesce(jsonb_typeof(p_input->'bank_account_id'),'null') NOT IN ('null','string')
  OR (jsonb_typeof(p_input->'bank_account_id')='string' AND p_input->>'bank_account_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  OR coalesce(jsonb_typeof(p_input->'already_paid'),'null') NOT IN ('null','boolean')
  OR coalesce(jsonb_typeof(p_input->'already_paid_method'),'null') NOT IN ('null','string')
  THEN RAISE EXCEPTION 'INV002: invalid invoice bank account or payment details';END IF;
 v_bank:=(p_input->>'bank_account_id')::uuid;
 v_paid:=coalesce((p_input->>'already_paid')::boolean,false);
 v_method:=CASE WHEN v_paid THEN p_input->>'already_paid_method' END;
 IF v_paid AND (v_method IS NULL OR v_method NOT IN ('cash','transfer','card','cheque') OR (v_method<>'cash' AND v_bank IS NULL)) THEN
  RAISE EXCEPTION 'INV002: an already-paid invoice needs a payment method and, unless cash, a bank account';END IF;
 IF v_bank IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bank_accounts b WHERE b.id=v_bank AND b.tenant_id=t AND b.is_active AND b.deleted_at IS NULL AND b.currency=coalesce(p_input->>'currency','SAR')) THEN
  RAISE EXCEPTION 'INV002: select an active bank account in the invoice currency';END IF;
 response:=public.save_invoice_draft(p_input-'bank_account_id'-'already_paid'-'already_paid_method',p_invoice_id,p_expected_updated_at);
 UPDATE public.invoices SET bank_account_id=v_bank,already_paid=v_paid,already_paid_method=v_method
  WHERE id=(response->>'id')::uuid AND tenant_id=t RETURNING updated_at INTO v_stamp;
 IF v_stamp IS NOT NULL THEN response:=response||jsonb_build_object('updated_at',v_stamp);END IF;
 INSERT INTO invoice_workflow_private.draft_receipts(tenant_id,actor_id,request_id,payload_hash,response) VALUES(t,a,p_request_id,h,response);
 RETURN response||jsonb_build_object('replayed',false);
END $$;
$draft$;
  PERFORM pg_notify('pgrst', 'reload schema');
END
$reconcile$;
COMMIT;
