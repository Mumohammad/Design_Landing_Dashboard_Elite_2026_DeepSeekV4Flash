-- "Already paid" (مدفوع بالفعل) intent on invoices.
--
-- The draft stores only the intent and its payment method. No money moves
-- here: after the invoice is approved the application asks the user to
-- confirm, and only then records one payment against its receivable/payable
-- through the guarded payments engine.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS already_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS already_paid_method text;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_already_paid_method_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_already_paid_method_check
  CHECK ((NOT already_paid AND already_paid_method IS NULL)
    OR (already_paid AND already_paid_method IN ('cash','transfer','card','cheque')));

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
REVOKE ALL ON FUNCTION public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
