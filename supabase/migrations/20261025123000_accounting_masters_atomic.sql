-- Caller-bound accounting masters. No existing business row is updated here.
-- Lock order for new RPCs: tenant catalog advisory lock -> reviewed entity row
-- -> journal/period rows. Trigger coverage also serializes legacy trusted writes;
-- a legacy transaction which locked an entity first may need a deadlock retry.
BEGIN;
CREATE SCHEMA accounting_master_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA accounting_master_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA accounting_master_private TO service_role;

CREATE TABLE accounting_master_private.receipts (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), actor_id uuid NOT NULL,
 request_id uuid NOT NULL, payload_hash text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,actor_id,request_id), CHECK(jsonb_typeof(response)='object')
);
ALTER TABLE accounting_master_private.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON accounting_master_private.receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION accounting_master_private.immutable_receipt() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'MASTER_RECEIPT_IMMUTABLE';END$$;
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON accounting_master_private.receipts
 FOR EACH ROW EXECUTE FUNCTION accounting_master_private.immutable_receipt();
CREATE FUNCTION accounting_master_private.lock_catalog(p_tenant uuid) RETURNS void
 LANGUAGE sql VOLATILE SET search_path='' AS $$SELECT pg_advisory_xact_lock(hashtextextended('accounting-master:'||p_tenant::text,0))$$;
CREATE FUNCTION accounting_master_private.require_caller(p_action text) RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();
BEGIN IF auth.uid() IS NULL OR t IS NULL OR public.user_has_permission('accounting',p_action) IS NOT TRUE THEN
 RAISE EXCEPTION 'AUTH007: accounting permission required' USING ERRCODE='42501';END IF;IF p_action IN('create','update') AND coalesce(auth.jwt()->>'aal','')<>'aal2' THEN RAISE EXCEPTION 'MASTER_ASSURANCE_REQUIRED: two-factor authentication is required for master changes' USING ERRCODE='42501';END IF;RETURN t;END$$;
CREATE FUNCTION accounting_master_private.is_canonical(p_code text) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT p_code=ANY(ARRAY['1000','1100','1200','1300','1400','1500','1600','1610','2000','2100','2200','2300','2500','2600','3000','3100','4000','4100','4200','5000','5100','5200','5300','5400','5500','5600','5700','5800'])$$;
CREATE FUNCTION accounting_master_private.can_archive(p_tenant uuid,p_id uuid,p_code text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT accounting_master_private.is_canonical(p_code)
 AND NOT EXISTS(SELECT 1 FROM public.journal_entry_lines l WHERE l.account_id=p_id)
 AND NOT EXISTS(SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id=p_tenant AND c.parent_id=p_id AND c.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.expense_category_mappings m WHERE m.tenant_id=p_tenant AND m.coa_account_code=p_code)
 AND NOT EXISTS(SELECT 1 FROM public.bank_accounts b WHERE b.tenant_id=p_tenant AND b.coa_account_code=p_code)
 $$;
CREATE INDEX IF NOT EXISTS idx_coa_master_parent_active ON public.chart_of_accounts(tenant_id,parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_master_coa ON public.expense_category_mappings(tenant_id,coa_account_code);
CREATE INDEX IF NOT EXISTS idx_bank_master_coa ON public.bank_accounts(tenant_id,coa_account_code);

CREATE FUNCTION accounting_master_private.receipt_get(p_tenant uuid,p_request uuid,p_operation text,p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r accounting_master_private.receipts%ROWTYPE;h text;
BEGIN
 IF p_request IS NULL THEN RAISE EXCEPTION 'MASTER_REQUEST_REQUIRED: request identifier is required' USING ERRCODE='22023';END IF;
 PERFORM accounting_master_private.lock_catalog(p_tenant);
 h:=encode(extensions.digest(jsonb_build_object('operation',p_operation,'payload',p_payload)::text,'sha256'),'hex');
 SELECT * INTO r FROM accounting_master_private.receipts WHERE tenant_id=p_tenant AND actor_id=auth.uid() AND request_id=p_request;
 IF FOUND THEN IF r.payload_hash<>h THEN RAISE EXCEPTION 'MASTER_REQUEST_CONFLICT: request identifier was used for different details';END IF;RETURN r.response;END IF;
 RETURN NULL;
END$$;
CREATE FUNCTION accounting_master_private.receipt_put(p_tenant uuid,p_request uuid,p_operation text,p_payload jsonb,p_response jsonb)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO accounting_master_private.receipts(tenant_id,actor_id,request_id,payload_hash,response)
 VALUES(p_tenant,auth.uid(),p_request,encode(extensions.digest(jsonb_build_object('operation',p_operation,'payload',p_payload)::text,'sha256'),'hex'),p_response)
 $$;

CREATE FUNCTION accounting_master_private.normalize_input(p_kind text,p_action text,p_input jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb:='{}';k text;v jsonb;s text;n numeric;prefix text:=CASE WHEN p_kind='customers' THEN 'CUS' ELSE 'SUP' END;
BEGIN
 IF p_kind NOT IN('customers','suppliers','accounts') OR p_action NOT IN('create','update','set_active','archive') OR p_input IS NULL
 OR jsonb_typeof(p_input)<>'object' OR octet_length(convert_to(p_input::text,'UTF8'))>16384 THEN RAISE EXCEPTION 'MASTER_INVALID: invalid master details' USING ERRCODE='22023';END IF;
 IF p_action='archive' THEN IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'MASTER_INVALID: archive has no editable fields' USING ERRCODE='22023';END IF;RETURN p_input;END IF;
 IF p_action='set_active' THEN IF p_input- 'is_active'<>'{}'::jsonb OR jsonb_typeof(p_input->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'MASTER_INVALID: active state required' USING ERRCODE='22023';END IF;RETURN p_input;END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_input) LOOP
  IF (p_kind='accounts' AND k NOT IN('account_code','name_ar','name_en','account_type','normal_balance','parent_id','is_contra','is_active','description'))
  OR(p_kind<>'accounts' AND k NOT IN('code','name_ar','name_en','phone','email','tax_number','address','credit_limit','is_active')) THEN RAISE EXCEPTION 'MASTER_INVALID: unsupported master field' USING ERRCODE='22023';END IF;
  IF k IN('is_contra','is_active') THEN
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid boolean field' USING ERRCODE='22023';END IF;r:=r||jsonb_build_object(k,v);
  ELSIF k='credit_limit' THEN
   IF v='null'::jsonb THEN r:=r||jsonb_build_object(k,NULL);CONTINUE;END IF;
   IF jsonb_typeof(v) NOT IN('number','string') OR (v#>>'{}') !~ '^\d{1,10}(\.\d+)?$' THEN RAISE EXCEPTION '%',prefix||'004: credit limit must be finite nonnegative exact cents';END IF;
   n:=(v#>>'{}')::numeric;IF n<>round(n,2) THEN RAISE EXCEPTION '%',prefix||'004: credit limit must be finite nonnegative exact cents';END IF;IF n>=10000000000 THEN RAISE EXCEPTION '%',prefix||'004: credit limit exceeds supported amount';END IF;
   r:=r||jsonb_build_object(k,round(n,2));
  ELSIF k='parent_id' THEN
   IF v='null'::jsonb OR v#>>'{}'='' THEN r:=r||jsonb_build_object(k,NULL);ELSE
    IF jsonb_typeof(v)<>'string' OR(v#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'COA002: invalid parent account';END IF;
    r:=r||jsonb_build_object(k,(v#>>'{}')::uuid);END IF;
  ELSE
   IF jsonb_typeof(v) NOT IN('string','null') THEN RAISE EXCEPTION 'MASTER_INVALID: text field required' USING ERRCODE='22023';END IF;
   s:=NULLIF(btrim(v#>>'{}',E' \t\r\n'),'');
   IF k IN('name_ar','name_en') AND(length(s)>200 OR((k='name_ar' OR p_kind='accounts') AND s IS NULL)) THEN
    IF p_kind='accounts' THEN RAISE EXCEPTION 'COA001: Arabic and English names are required and limited to 200 characters';ELSE RAISE EXCEPTION '%',prefix||'005: Arabic name is required and names are limited to 200 characters';END IF;
   END IF;
   IF(k='description' AND length(s)>1000) OR(k='phone' AND length(s)>50) OR(k='email' AND length(s)>254) OR(k='address' AND length(s)>2000) THEN RAISE EXCEPTION 'MASTER_INVALID: text field exceeds its limit' USING ERRCODE='22023';END IF;
   IF k='account_code' AND(s IS NULL OR s!~'^\d{3,6}$') THEN RAISE EXCEPTION 'COA001: account code must be 3-6 digits';END IF;
   IF k='code' THEN IF s IS NULL THEN CONTINUE;END IF;s:=upper(s);IF s!~'^[A-Z0-9][A-Z0-9-]{2,11}$' THEN RAISE EXCEPTION '%',prefix||'003: code must be 3-12 characters';END IF;END IF;
   IF k='tax_number' AND s IS NOT NULL AND s!~'^\d{15}$' THEN RAISE EXCEPTION '%',prefix||'002: tax number must be exactly 15 digits';END IF;
   IF k='account_type' AND(s IS NULL OR s NOT IN('asset','liability','equity','income','expense')) THEN RAISE EXCEPTION 'COA003: invalid account type';END IF;
   IF k='normal_balance' AND(s IS NULL OR s NOT IN('debit','credit')) THEN RAISE EXCEPTION 'COA003: invalid normal balance';END IF;
   r:=r||jsonb_build_object(k,s);
  END IF;
 END LOOP;
 IF p_action='create' AND((p_kind='accounts' AND NOT(r?'account_code' AND r?'name_ar' AND r?'name_en' AND r?'account_type' AND r?'normal_balance')) OR(p_kind<>'accounts' AND NOT r?'name_ar')) THEN RAISE EXCEPTION 'MASTER_INVALID: required master fields missing' USING ERRCODE='22023';END IF;
 IF p_action='create' THEN
  IF p_kind='accounts' THEN r:=jsonb_build_object('parent_id',NULL,'is_contra',false,'is_active',true,'description',NULL)||r;
  ELSE r:=jsonb_build_object('name_en',NULL,'phone',NULL,'email',NULL,'tax_number',NULL,'address',NULL,'credit_limit',NULL,'is_active',true)||r;END IF;
 END IF;
 RETURN r;
END$$;

CREATE FUNCTION accounting_master_private.stamp_master() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'MASTER_INVALID: tenant identity is immutable';END IF;
 PERFORM accounting_master_private.lock_catalog(NEW.tenant_id);
 NEW.updated_at:=CASE WHEN TG_OP='UPDATE' THEN greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond') ELSE clock_timestamp() END;
 RETURN NEW;
END$$;
CREATE TRIGGER zzzz_accounting_master_stamp BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION accounting_master_private.stamp_master();
CREATE TRIGGER zzzz_accounting_master_stamp BEFORE INSERT OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION accounting_master_private.stamp_master();
CREATE TRIGGER zzzz_accounting_master_stamp BEFORE INSERT OR UPDATE ON public.chart_of_accounts FOR EACH ROW EXECUTE FUNCTION accounting_master_private.stamp_master();

CREATE OR REPLACE FUNCTION public.validate_chart_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.chart_of_accounts%ROWTYPE;bad boolean;has_posted boolean;has_binding boolean;expected_type text;expected_balance text;
BEGIN
 PERFORM accounting_master_private.lock_catalog(NEW.tenant_id);
 IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'COA002: tenant identity is immutable';END IF;
 IF NEW.account_code IS NULL OR NEW.account_code!~'^\d{3,6}$' OR btrim(NEW.name_ar)='' OR btrim(NEW.name_en)='' OR length(NEW.name_ar)>200 OR length(NEW.name_en)>200 THEN RAISE EXCEPTION 'COA001: invalid account code or names';END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT * INTO p FROM public.chart_of_accounts WHERE id=NEW.parent_id;
  IF p.id IS NULL OR p.tenant_id<>NEW.tenant_id OR p.id=NEW.id OR p.deleted_at IS NOT NULL OR NOT p.is_active OR p.account_type<>NEW.account_type THEN RAISE EXCEPTION 'COA002: parent must be active, same-tenant and same-type';END IF;
  WITH RECURSIVE chain(id,parent_id,path,cycle,depth) AS(
   SELECT c.id,c.parent_id,ARRAY[c.id],false,1 FROM public.chart_of_accounts c WHERE c.id=NEW.parent_id AND c.tenant_id=NEW.tenant_id
   UNION ALL SELECT c.id,c.parent_id,a.path||c.id,c.id=ANY(a.path),a.depth+1 FROM chain a JOIN public.chart_of_accounts c ON c.id=a.parent_id AND c.tenant_id=NEW.tenant_id WHERE NOT a.cycle AND a.depth<10000)
  SELECT coalesce(bool_or(id=NEW.id OR cycle OR depth>=10000),false) INTO bad FROM chain;
  IF bad THEN RAISE EXCEPTION 'COA002: parent chain is cyclic or needs review';END IF;
 END IF;
 IF NOT NEW.is_contra AND((NEW.account_type IN('asset','expense') AND NEW.normal_balance<>'debit') OR(NEW.account_type IN('liability','equity','income') AND NEW.normal_balance<>'credit')) THEN RAISE EXCEPTION 'COA003: account type and normal balance disagree';END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.account_type IS DISTINCT FROM OLD.account_type AND EXISTS(SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id=OLD.tenant_id AND c.parent_id=OLD.id AND c.deleted_at IS NULL AND c.account_type<>NEW.account_type) THEN RAISE EXCEPTION 'COA002: existing children must retain the same account type';END IF;
  IF accounting_master_private.is_canonical(OLD.account_code) AND(NEW.account_code IS DISTINCT FROM OLD.account_code OR NEW.account_type IS DISTINCT FROM OLD.account_type OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance OR NEW.is_contra IS DISTINCT FROM OLD.is_contra OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN RAISE EXCEPTION 'COA004: canonical account identity is protected';END IF;
  SELECT EXISTS(SELECT 1 FROM public.bank_accounts b WHERE b.tenant_id=OLD.tenant_id AND b.coa_account_code=OLD.account_code) OR EXISTS(SELECT 1 FROM public.expense_category_mappings m WHERE m.tenant_id=OLD.tenant_id AND m.coa_account_code=OLD.account_code) INTO has_binding;
  IF has_binding AND(NEW.account_code IS DISTINCT FROM OLD.account_code OR NEW.account_type IS DISTINCT FROM OLD.account_type OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance OR NEW.is_contra IS DISTINCT FROM OLD.is_contra) THEN RAISE EXCEPTION 'COA004: bound account identity is protected';END IF;
  IF has_binding AND((OLD.is_active AND NOT NEW.is_active) OR(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'COA005: bound account must remain active';END IF;
  SELECT EXISTS(SELECT 1 FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE l.account_id=OLD.id AND j.status IN('posted','reversed')) INTO has_posted;
  IF has_posted AND(NEW.account_code IS DISTINCT FROM OLD.account_code OR NEW.account_type IS DISTINCT FROM OLD.account_type OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance OR NEW.is_contra IS DISTINCT FROM OLD.is_contra OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN RAISE EXCEPTION 'COA004: posted account structure is immutable';END IF;
  IF(OLD.is_active AND NOT NEW.is_active) OR(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
   IF accounting_master_private.is_canonical(OLD.account_code) OR has_posted OR EXISTS(SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id=OLD.tenant_id AND c.parent_id=OLD.id AND c.is_active AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'COA005: canonical, posted or parent account cannot be deactivated or archived';END IF;
  END IF;
 END IF;
 IF accounting_master_private.is_canonical(NEW.account_code) AND(TG_OP='INSERT' OR NOT accounting_master_private.is_canonical(OLD.account_code)) THEN
  expected_type:=CASE WHEN NEW.account_code IN('1000','1100','1200','1300','1400','1500','1600','1610','2600') THEN 'asset' WHEN NEW.account_code IN('2000','2100','2200','2300','2500') THEN 'liability' WHEN NEW.account_code IN('3000','3100') THEN 'equity' WHEN NEW.account_code IN('4000','4100','4200') THEN 'income' ELSE 'expense' END;
  expected_balance:=CASE WHEN NEW.account_code='1610' OR NEW.account_type IN('liability','equity','income') THEN 'credit' ELSE 'debit' END;
  IF NEW.parent_id IS NOT NULL OR NOT NEW.is_active OR NEW.is_contra<>(NEW.account_code='1610') OR NEW.account_type::text<>expected_type OR NEW.normal_balance::text<>expected_balance THEN RAISE EXCEPTION 'COA004: canonical account definition must match the standard identity';END IF;
 END IF;
 RETURN NEW;
END$$;
CREATE FUNCTION accounting_master_private.guard_account_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM accounting_master_private.lock_catalog(OLD.tenant_id);IF NOT accounting_master_private.can_archive(OLD.tenant_id,OLD.id,OLD.account_code) THEN RAISE EXCEPTION 'COA005: referenced or canonical account must be retained';END IF;RETURN OLD;END$$;
CREATE TRIGGER aaa_master_account_delete BEFORE DELETE ON public.chart_of_accounts FOR EACH ROW EXECUTE FUNCTION accounting_master_private.guard_account_delete();

-- Text code bindings must observe the same catalog version as master changes.
CREATE FUNCTION accounting_master_private.guard_code_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'COA002: binding tenant identity is immutable';END IF;
 PERFORM accounting_master_private.lock_catalog(NEW.tenant_id);
 IF NEW.coa_account_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id=NEW.tenant_id AND c.account_code=NEW.coa_account_code AND c.deleted_at IS NULL AND c.is_active AND(TG_TABLE_NAME<>'bank_accounts' OR c.account_type='asset')) THEN
  IF TG_TABLE_NAME='bank_accounts' THEN RAISE EXCEPTION 'BNK005: active tenant asset account required';ELSE RAISE EXCEPTION 'COA002: mapping requires an active account in this tenant';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER aaa_accounting_bank_binding BEFORE INSERT OR UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION accounting_master_private.guard_code_binding();
CREATE TRIGGER aaa_accounting_expense_binding BEFORE INSERT OR UPDATE ON public.expense_category_mappings FOR EACH ROW EXECUTE FUNCTION accounting_master_private.guard_code_binding();

CREATE FUNCTION accounting_master_private.check_posting_account(p_tenant uuid,p_account uuid,p_type public.journal_entry_type,p_reversal uuid,p_source text,p_source_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.chart_of_accounts%ROWTYPE;historical boolean:=false;
BEGIN
 SELECT * INTO a FROM public.chart_of_accounts WHERE id=p_account AND tenant_id=p_tenant;
 IF p_type='reversal' THEN
  historical:=EXISTS(SELECT 1 FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id AND j.tenant_id=p_tenant WHERE l.tenant_id=p_tenant AND l.account_id=p_account AND j.status IN('posted','reversed') AND(j.id=p_reversal OR(p_source IN('invoice','purchase_invoice') AND j.source_entity_type=p_source AND j.source_entity_id=p_source_id) OR(p_source='payment' AND j.entry_type='bank' AND j.source_entity_type='payment' AND j.source_entity_id=p_source_id) OR(p_source='credit_note' AND j.source_entity_type='invoice' AND j.source_entity_id=(SELECT n.reference_invoice_id FROM public.credit_notes n WHERE n.id=p_source_id AND n.tenant_id=p_tenant))));
 END IF;
 IF a.id IS NULL OR((a.deleted_at IS NOT NULL OR NOT a.is_active) AND NOT historical) THEN RAISE EXCEPTION 'JRN008: posting requires an active account in this tenant';END IF;
END$$;
CREATE FUNCTION accounting_master_private.guard_journal_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l record;
BEGIN
 IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'JRN008: journal tenant is immutable';END IF;
 IF NEW.status IN('posted','reversed') THEN
  PERFORM accounting_master_private.lock_catalog(NEW.tenant_id);
  IF TG_OP='INSERT' OR(NEW.status='posted' AND OLD.status<>'posted') THEN
   FOR l IN SELECT account_id FROM public.journal_entry_lines WHERE journal_entry_id=NEW.id LOOP
    PERFORM accounting_master_private.check_posting_account(NEW.tenant_id,l.account_id,NEW.entry_type,NEW.reversal_of_entry_id,NEW.source_entity_type,NEW.source_entity_id);
   END LOOP;
  END IF;
 END IF;RETURN NEW;
END$$;
CREATE FUNCTION accounting_master_private.guard_line_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.journal_entries%ROWTYPE;t uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;e uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
BEGIN
 IF TG_OP='UPDATE' AND(NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN RAISE EXCEPTION 'JRN008: journal line identity is immutable';END IF;
 PERFORM accounting_master_private.lock_catalog(t);
 SELECT * INTO j FROM public.journal_entries WHERE id=e AND tenant_id=t;
 IF TG_OP<>'DELETE' AND j.id IS NULL THEN RAISE EXCEPTION 'JRN008: journal parent must belong to this tenant';END IF;
 IF TG_OP<>'DELETE' AND j.status='posted' THEN PERFORM accounting_master_private.check_posting_account(t,NEW.account_id,j.entry_type,j.reversal_of_entry_id,j.source_entity_type,j.source_entity_id);END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END$$;
CREATE TRIGGER aaa_accounting_catalog_post BEFORE INSERT OR UPDATE OF status,tenant_id ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION accounting_master_private.guard_journal_catalog();
CREATE TRIGGER aaa_accounting_catalog_line BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION accounting_master_private.guard_line_catalog();

CREATE FUNCTION accounting_master_private.account_rows(p_tenant uuid)
RETURNS TABLE(id uuid,account_code text,name_ar text,name_en text,account_type public.account_type,normal_balance public.account_normal_balance,parent_id uuid,is_contra boolean,is_active boolean,description text,updated_at timestamptz,parent_code text,parent_name_ar text,parent_name_en text,is_canonical boolean,can_archive boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.id,c.account_code,c.name_ar,c.name_en,c.account_type,c.normal_balance,c.parent_id,c.is_contra,c.is_active,c.description,c.updated_at,p.account_code,p.name_ar,p.name_en,accounting_master_private.is_canonical(c.account_code),accounting_master_private.can_archive(c.tenant_id,c.id,c.account_code)
 FROM public.chart_of_accounts c LEFT JOIN public.chart_of_accounts p ON p.id=c.parent_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=p_tenant AND c.deleted_at IS NULL
$$;
CREATE FUNCTION public.read_my_accounting_master_page(p_kind text,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('read');q text;rows jsonb;n bigint;summary jsonb;term text;action text;
BEGIN
 IF p_kind NOT IN('customers','suppliers','accounts') OR p_kind IS NULL OR p_search IS NULL OR length(p_search)>200 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_export IS NULL THEN RAISE EXCEPTION 'MASTER_INVALID: invalid page request' USING ERRCODE='22023';END IF;
 IF p_export THEN PERFORM accounting_master_private.require_caller('export');END IF;
 PERFORM accounting_master_private.lock_catalog(t);term:=btrim(p_search);
 IF p_kind='accounts' THEN
  q:='SELECT * FROM accounting_master_private.account_rows($1) WHERE strpos(lower(concat_ws('' '',account_code,name_ar,name_en,description)),lower($2))>0';
  SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE is_active),'assets',count(*) FILTER(WHERE account_type='asset'),'income_expense',count(*) FILTER(WHERE account_type IN('income','expense'))) INTO summary FROM public.chart_of_accounts WHERE tenant_id=t AND deleted_at IS NULL;
 ELSE
  q:=format('SELECT id,%I AS code,name_ar,name_en,phone,email,tax_number,address,credit_limit::text,is_active,updated_at FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(lower(concat_ws('' '',%I,name_ar,name_en,phone,email,tax_number,address)),lower($2))>0',CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END,p_kind,CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END);
  EXECUTE format('SELECT jsonb_build_object(''total'',count(*),''active'',count(*) FILTER(WHERE is_active),''tax_registered'',count(*) FILTER(WHERE tax_number IS NOT NULL AND tax_number<>''''),''avg_credit_limit'',round(coalesce(avg(credit_limit),0),2)::text) FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL',p_kind) INTO summary USING t;
 END IF;
 EXECUTE 'SELECT count(*) FROM ('||q||') r' INTO n USING t,term;
 IF p_export AND n>10000 THEN RAISE EXCEPTION 'MASTER_EXPORT_LIMIT: narrow the export search' USING ERRCODE='54000';END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id),''[]''::jsonb) FROM (SELECT * FROM ('||q||') data ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id LIMIT $3 OFFSET $4)r' INTO rows USING t,term,CASE WHEN p_export THEN n ELSE p_page_size END,CASE WHEN p_export THEN 0 ELSE(p_page::bigint-1)*p_page_size END;
 IF p_export THEN action:=CASE p_kind WHEN 'accounts' THEN 'chart_of_accounts_exported' WHEN 'customers' THEN 'customer_list_exported' ELSE 'supplier_list_exported' END;INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,auth.uid(),'accounting',CASE WHEN p_kind='accounts' THEN 'chart_of_accounts' ELSE p_kind END,action,jsonb_build_object('rows',n,'filtered',term<>''));END IF;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',p_page,'page_size',p_page_size,'summary',summary);
END$$;
CREATE FUNCTION public.read_my_chart_parent_page(p_account_type text,p_exclude_id uuid DEFAULT NULL,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('read');rows jsonb;n bigint;q text;
BEGIN
 IF p_account_type IS NULL OR p_account_type NOT IN('asset','liability','equity','income','expense') OR p_search IS NULL OR length(p_search)>200 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'MASTER_INVALID: invalid parent page request' USING ERRCODE='22023';END IF;
 PERFORM accounting_master_private.lock_catalog(t);
 IF p_exclude_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t AND id=p_exclude_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'MASTER_NOT_FOUND: account not found';END IF;
 q:='WITH RECURSIVE descendants(id) AS(SELECT id FROM public.chart_of_accounts WHERE tenant_id=$1 AND id=$2 UNION SELECT c.id FROM public.chart_of_accounts c JOIN descendants d ON c.parent_id=d.id WHERE c.tenant_id=$1) SELECT r.* FROM accounting_master_private.account_rows($1)r WHERE r.is_active AND r.account_type::text=$3 AND NOT EXISTS(SELECT 1 FROM descendants d WHERE d.id=r.id) AND strpos(lower(concat_ws('' '',r.account_code,r.name_ar,r.name_en)),lower($4))>0';
 EXECUTE 'SELECT count(*) FROM ('||q||')r' INTO n USING t,p_exclude_id,p_account_type,btrim(p_search);
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY account_code,id),''[]''::jsonb) FROM(SELECT * FROM ('||q||')data ORDER BY account_code,id LIMIT $5 OFFSET $6)r' INTO rows USING t,p_exclude_id,p_account_type,btrim(p_search),p_page_size,(p_page::bigint-1)*p_page_size;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',p_page,'page_size',p_page_size,'summary',NULL);
END$$;
CREATE FUNCTION accounting_master_private.party_referenced(p_kind text,p_tenant uuid,p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_kind='customers' THEN RETURN EXISTS(SELECT 1 FROM public.invoices WHERE customer_id=p_id) OR EXISTS(SELECT 1 FROM public.receivables WHERE customer_id=p_id) OR EXISTS(SELECT 1 FROM public.finance_payments WHERE customer_id=p_id) OR EXISTS(SELECT 1 FROM public.credit_notes WHERE customer_id=p_id) OR EXISTS(SELECT 1 FROM public.debit_notes WHERE customer_id=p_id) OR EXISTS(SELECT 1 FROM public.vat_output_ledger WHERE customer_id=p_id);
 ELSE RETURN EXISTS(SELECT 1 FROM public.invoices WHERE supplier_id=p_id) OR EXISTS(SELECT 1 FROM public.payables WHERE supplier_id=p_id) OR EXISTS(SELECT 1 FROM public.finance_payments WHERE supplier_id=p_id) OR EXISTS(SELECT 1 FROM public.vat_input_ledger WHERE supplier_id=p_id);END IF;
END$$;
CREATE FUNCTION public.mutate_my_accounting_master(p_kind text,p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid;norm jsonb;payload jsonb;response jsonb;oldrow jsonb;newrow jsonb;acct public.chart_of_accounts%ROWTYPE;code_col text;code text;seq bigint;op text;action text;stamp timestamptz;duplicate boolean;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('customers','suppliers','accounts') OR p_action IS NULL OR p_action NOT IN('create','update','set_active','archive') THEN RAISE EXCEPTION 'MASTER_INVALID: unsupported master operation' USING ERRCODE='22023';END IF;
 t:=accounting_master_private.require_caller(CASE WHEN p_action='create' THEN 'create' ELSE 'update' END);
 norm:=accounting_master_private.normalize_input(p_kind,p_action,p_input);
 IF(p_action='create' AND(p_id IS NOT NULL OR p_expected_updated_at IS NOT NULL)) OR(p_action<>'create' AND(p_id IS NULL OR p_expected_updated_at IS NULL)) THEN RAISE EXCEPTION 'MASTER_INVALID: reviewed identity and timestamp required' USING ERRCODE='22023';END IF;
 op:=p_kind||':'||p_action;payload:=jsonb_build_object('input',norm,'id',p_id,'expected_updated_at',CASE WHEN p_expected_updated_at IS NULL THEN NULL ELSE to_char(p_expected_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
 response:=accounting_master_private.receipt_get(t,p_request_id,op,payload);IF response IS NOT NULL THEN RETURN response;END IF;
 IF p_kind='accounts' THEN
  IF p_action<>'create' THEN
   SELECT * INTO acct FROM public.chart_of_accounts WHERE tenant_id=t AND id=p_id AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'MASTER_NOT_FOUND: account not found';END IF;
   IF acct.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'MASTER_STALE: record changed; reload before saving';END IF;oldrow:=to_jsonb(acct);
  END IF;
  IF p_action='create' THEN
   IF EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=norm->>'account_code' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'MASTER_DUPLICATE: account code already exists';END IF;
   INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance,parent_id,is_contra,is_active,description,created_by,updated_by)
   VALUES(t,norm->>'account_code',norm->>'name_ar',norm->>'name_en',(norm->>'account_type')::public.account_type,(norm->>'normal_balance')::public.account_normal_balance,(norm->>'parent_id')::uuid,coalesce((norm->>'is_contra')::boolean,false),coalesce((norm->>'is_active')::boolean,true),norm->>'description',auth.uid(),auth.uid()) RETURNING * INTO acct;
  ELSIF p_action='update' THEN
   IF EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=coalesce(norm->>'account_code',acct.account_code) AND deleted_at IS NULL AND id<>p_id) THEN RAISE EXCEPTION 'MASTER_DUPLICATE: account code already exists';END IF;
   UPDATE public.chart_of_accounts SET account_code=coalesce(norm->>'account_code',acct.account_code),name_ar=coalesce(norm->>'name_ar',acct.name_ar),name_en=coalesce(norm->>'name_en',acct.name_en),account_type=coalesce((norm->>'account_type')::public.account_type,acct.account_type),normal_balance=coalesce((norm->>'normal_balance')::public.account_normal_balance,acct.normal_balance),parent_id=CASE WHEN norm?'parent_id' THEN(norm->>'parent_id')::uuid ELSE acct.parent_id END,is_contra=coalesce((norm->>'is_contra')::boolean,acct.is_contra),is_active=coalesce((norm->>'is_active')::boolean,acct.is_active),description=CASE WHEN norm?'description' THEN norm->>'description' ELSE acct.description END,updated_by=auth.uid() WHERE id=p_id AND tenant_id=t RETURNING * INTO acct;
  ELSIF p_action='set_active' THEN UPDATE public.chart_of_accounts SET is_active=(norm->>'is_active')::boolean,updated_by=auth.uid() WHERE id=p_id AND tenant_id=t RETURNING * INTO acct;
  ELSE
   IF NOT accounting_master_private.can_archive(t,acct.id,acct.account_code) THEN RAISE EXCEPTION 'COA005: canonical or referenced account must be retained';END IF;
   UPDATE public.chart_of_accounts SET deleted_at=clock_timestamp(),is_active=false,updated_by=auth.uid() WHERE id=p_id AND tenant_id=t RETURNING * INTO acct;
  END IF;
  newrow:=to_jsonb(acct);code:=acct.account_code;
 ELSE
  code_col:=CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END;
  IF p_action<>'create' THEN
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',p_kind) INTO oldrow USING t,p_id;
   IF oldrow IS NULL THEN RAISE EXCEPTION 'MASTER_NOT_FOUND: party not found';END IF;
   IF(oldrow->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'MASTER_STALE: record changed; reload before saving';END IF;
  END IF;
  IF p_action='create' THEN
   code:=norm->>'code';IF code IS NULL THEN seq:=nextval('public.finance_doc_ref_seq');code:=lpad(seq::text,greatest(6,length(seq::text)),'0');END IF;
   IF length(code)>12 THEN RAISE EXCEPTION 'MASTER_INVALID: party code sequence exhausted';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE tenant_id=$1 AND upper(%I)=$2 AND deleted_at IS NULL)',p_kind,code_col) INTO duplicate USING t,code;
   IF duplicate THEN RAISE EXCEPTION 'MASTER_DUPLICATE: party code already exists';END IF;
   EXECUTE format('INSERT INTO public.%I(tenant_id,%I,name_ar,name_en,phone,email,tax_number,address,credit_limit,is_active,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING to_jsonb(%I.*)',p_kind,code_col,p_kind)
   INTO newrow USING t,code,norm->>'name_ar',norm->>'name_en',norm->>'phone',norm->>'email',norm->>'tax_number',norm->>'address',(norm->>'credit_limit')::numeric,coalesce((norm->>'is_active')::boolean,true),auth.uid();
  ELSIF p_action='update' THEN
   code:=coalesce(norm->>'code',oldrow->>code_col);
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE tenant_id=$1 AND upper(%I)=upper($2) AND deleted_at IS NULL AND id<>$3)',p_kind,code_col) INTO duplicate USING t,code,p_id;
   IF duplicate THEN RAISE EXCEPTION 'MASTER_DUPLICATE: party code already exists';END IF;
   EXECUTE format('UPDATE public.%I SET %I=$3,name_ar=$4,name_en=$5,phone=$6,email=$7,tax_number=$8,address=$9,credit_limit=$10,is_active=$11,updated_by=$12 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,code_col,p_kind)
   INTO newrow USING t,p_id,code,coalesce(norm->>'name_ar',oldrow->>'name_ar'),CASE WHEN norm?'name_en' THEN norm->>'name_en' ELSE oldrow->>'name_en' END,CASE WHEN norm?'phone' THEN norm->>'phone' ELSE oldrow->>'phone' END,CASE WHEN norm?'email' THEN norm->>'email' ELSE oldrow->>'email' END,CASE WHEN norm?'tax_number' THEN norm->>'tax_number' ELSE oldrow->>'tax_number' END,CASE WHEN norm?'address' THEN norm->>'address' ELSE oldrow->>'address' END,CASE WHEN norm?'credit_limit' THEN(norm->>'credit_limit')::numeric ELSE(oldrow->>'credit_limit')::numeric END,coalesce((norm->>'is_active')::boolean,(oldrow->>'is_active')::boolean),auth.uid();
  ELSIF p_action='set_active' THEN
   EXECUTE format('UPDATE public.%I SET is_active=$3,updated_by=$4 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,p_kind) INTO newrow USING t,p_id,(norm->>'is_active')::boolean,auth.uid();
  ELSE
   IF accounting_master_private.party_referenced(p_kind,t,p_id) THEN RAISE EXCEPTION 'MASTER_REFERENCED: party has financial history; deactivate it instead';END IF;
   EXECUTE format('UPDATE public.%I SET deleted_at=clock_timestamp(),is_active=false,updated_by=$3 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,p_kind) INTO newrow USING t,p_id,auth.uid();
  END IF;code:=newrow->>code_col;
 END IF;
 action:=CASE WHEN p_kind='accounts' THEN 'account' ELSE left(p_kind,length(p_kind)-1) END||'_'||CASE p_action WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' WHEN 'archive' THEN 'deleted' ELSE CASE WHEN(newrow->>'is_active')::boolean THEN 'activated' ELSE 'deactivated' END END;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,auth.uid(),'accounting',CASE WHEN p_kind='accounts' THEN 'chart_of_accounts' ELSE p_kind END,(newrow->>'id')::uuid,action,
 CASE WHEN oldrow IS NULL THEN NULL ELSE jsonb_build_object('code',CASE WHEN p_kind='accounts' THEN oldrow->>'account_code' ELSE oldrow->>code_col END,'is_active',oldrow->'is_active','updated_at',oldrow->'updated_at') END,
 jsonb_build_object('code',code,'is_active',newrow->'is_active','archived',newrow->>'deleted_at' IS NOT NULL,'updated_at',newrow->'updated_at','request_id',p_request_id));
 response:=jsonb_build_object('id',newrow->'id','updated_at',newrow->'updated_at','code',code,'is_active',newrow->'is_active','archived',newrow->>'deleted_at' IS NOT NULL);
 PERFORM accounting_master_private.receipt_put(t,p_request_id,op,payload,response);RETURN response;
END$$;

CREATE FUNCTION public.import_my_chart_accounts(p_rows jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('create');payload jsonb;response jsonb;row jsonb;norm jsonb;row_index integer:=1;imported integer:=0;skipped integer:=0;errors jsonb:='[]';code text;parent_code text;parent_id uuid;row_chars bigint;key text;value jsonb;msg text;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 OR octet_length(convert_to(p_rows::text,'UTF8'))>524288 THEN RAISE EXCEPTION 'MASTER_INVALID: import requires 1-1000 bounded rows within 512 KiB' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(CASE WHEN jsonb_typeof(r.value)='object' THEN
  '{"is_contra":false,"is_active":true,"description":null,"parent_code":null}'::jsonb||coalesce((SELECT jsonb_object_agg(e.key,CASE
   WHEN e.key IN('is_contra','is_active') AND jsonb_typeof(e.value)='string' AND lower(btrim(e.value#>>'{}')) IN('true','false') THEN to_jsonb(lower(btrim(e.value#>>'{}'))::boolean)
   WHEN e.key IN('description','parent_code') AND jsonb_typeof(e.value)='string' AND btrim(e.value#>>'{}')='' THEN 'null'::jsonb
   WHEN jsonb_typeof(e.value)='string' THEN to_jsonb(btrim(e.value#>>'{}')) ELSE e.value END) FROM jsonb_each(r.value)e),'{}'::jsonb)
  ELSE r.value END ORDER BY r.ordinality) INTO payload FROM jsonb_array_elements(p_rows) WITH ORDINALITY r(value,ordinality);
 response:=accounting_master_private.receipt_get(t,p_request_id,'accounts:import',payload);IF response IS NOT NULL THEN RETURN response;END IF;
 FOR row IN SELECT * FROM jsonb_array_elements(payload) LOOP
  row_index:=row_index+1;
  BEGIN
   IF jsonb_typeof(row)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(row)k WHERE k NOT IN('account_code','name_ar','name_en','account_type','normal_balance','parent_code','is_contra','is_active','description')) THEN RAISE EXCEPTION 'MASTER_INVALID: invalid import row';END IF;
   SELECT coalesce(sum(length(e.value#>>'{}')),0) INTO row_chars FROM jsonb_each(row)e;IF row_chars>4096 THEN RAISE EXCEPTION 'MASTER_INVALID: import row is longer than 4096 characters';END IF;
   code:=btrim(row->>'account_code');IF code IS NULL OR code!~'^\d{3,6}$' THEN RAISE EXCEPTION 'COA001: invalid account code';END IF;
   IF EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=code AND deleted_at IS NULL) THEN skipped:=skipped+1;CONTINUE;END IF;
   norm:=row-'parent_code';
   FOR key IN SELECT unnest(ARRAY['is_contra','is_active']) LOOP
    IF NOT norm?key THEN norm:=norm||jsonb_build_object(key,key='is_active');
    ELSIF jsonb_typeof(norm->key)='string' AND lower(norm->>key) IN('true','false') THEN norm:=norm||jsonb_build_object(key,(lower(norm->>key))::boolean);END IF;
   END LOOP;
   parent_code:=NULLIF(btrim(row->>'parent_code'),'');parent_id:=NULL;
   IF parent_code IS NOT NULL THEN SELECT id INTO parent_id FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=parent_code AND is_active AND deleted_at IS NULL;IF parent_id IS NULL THEN RAISE EXCEPTION 'COA002: parent code not found among active accounts';END IF;END IF;
   norm:=accounting_master_private.normalize_input('accounts','create',norm||jsonb_build_object('parent_id',parent_id));
   INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance,parent_id,is_contra,is_active,description,created_by,updated_by)
   VALUES(t,norm->>'account_code',norm->>'name_ar',norm->>'name_en',(norm->>'account_type')::public.account_type,(norm->>'normal_balance')::public.account_normal_balance,(norm->>'parent_id')::uuid,(norm->>'is_contra')::boolean,(norm->>'is_active')::boolean,norm->>'description',auth.uid(),auth.uid());imported:=imported+1;
  EXCEPTION WHEN OTHERS THEN
   msg:=SQLERRM;errors:=errors||jsonb_build_array('Row '||row_index||': '||CASE WHEN msg~'^COA00[1-5]:' THEN msg ELSE 'Invalid account details' END);
  END;
 END LOOP;
 response:=jsonb_build_object('imported',imported,'skipped',skipped,'errors',errors);
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,auth.uid(),'accounting','chart_of_accounts','chart_of_accounts_imported',jsonb_build_object('imported',imported,'skipped',skipped,'errors',jsonb_array_length(errors),'request_id',p_request_id));
 PERFORM accounting_master_private.receipt_put(t,p_request_id,'accounts:import',payload,response);RETURN response;
END$$;

CREATE FUNCTION public.initialize_my_chart_accounts(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('create');response jsonb;inserted integer;
BEGIN response:=accounting_master_private.receipt_get(t,p_request_id,'accounts:initialize','{}');IF response IS NOT NULL THEN RETURN response;END IF;
 inserted:=public.ensure_default_chart_of_accounts(t);response:=jsonb_build_object('inserted',inserted);
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,auth.uid(),'accounting','chart_of_accounts','default_chart_of_accounts_loaded',jsonb_build_object('inserted',inserted,'request_id',p_request_id));
 PERFORM accounting_master_private.receipt_put(t,p_request_id,'accounts:initialize','{}',response);RETURN response;END$$;
CREATE FUNCTION public.post_my_opening_balances(p_entry_date date,p_lines jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('create');norm jsonb:='[]';l jsonb;payload jsonb;response jsonb;account uuid;debit numeric;credit numeric;dr numeric:=0;cr numeric:=0;description text;
BEGIN
 IF p_entry_date IS NULL OR p_entry_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' OR p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 2 AND 1000 OR octet_length(convert_to(p_lines::text,'UTF8'))>524288 THEN RAISE EXCEPTION 'MASTER_INVALID: invalid bounded opening balance input' USING ERRCODE='22023';END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(l)k WHERE k NOT IN('account_id','description','debit','credit')) OR coalesce(l->>'account_id','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR coalesce(l->>'debit','0')!~'^\d{1,10}(\.\d{1,2})?$' OR coalesce(l->>'credit','0')!~'^\d{1,10}(\.\d{1,2})?$' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid opening balance line' USING ERRCODE='22023';END IF;
  account:=(l->>'account_id')::uuid;debit:=coalesce((l->>'debit')::numeric,0);credit:=coalesce((l->>'credit')::numeric,0);description:=NULLIF(btrim(l->>'description'),'');
  IF(debit>0)=(credit>0) OR debit>=10000000000 OR credit>=10000000000 OR length(description)>1000 OR(l?'description' AND jsonb_typeof(l->'description') NOT IN('string','null')) THEN RAISE EXCEPTION 'JRN007: opening balance lines must be finite, exact cents and single-sided';END IF;
  dr:=dr+debit;cr:=cr+credit;norm:=norm||jsonb_build_array(jsonb_build_object('account_id',account,'description',description,'debit',round(debit,2),'credit',round(credit,2)));
 END LOOP;
 IF dr<>cr OR dr<=0 OR dr>=10000000000 THEN RAISE EXCEPTION 'JRN004: opening balances must balance exactly within supported totals';END IF;
 payload:=jsonb_build_object('entry_date',p_entry_date,'lines',norm);response:=accounting_master_private.receipt_get(t,p_request_id,'accounts:opening',payload);IF response IS NOT NULL THEN RETURN response;END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(norm) LOOP IF NOT EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE id=(l->>'account_id')::uuid AND tenant_id=t AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'JRN008: opening balance account must be active and belong to this tenant';END IF;END LOOP;
 SELECT to_jsonb(r) INTO response FROM public.post_journal_entry(t,p_entry_date,'رصيد افتتاحي',norm,'Opening balances',auth.uid(),'opening')r;
 IF response IS NULL OR response->>'out_entry_id' IS NULL THEN RAISE EXCEPTION 'JRN005: opening posting returned no journal';END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,auth.uid(),'accounting','journal_entries',(response->>'out_entry_id')::uuid,'opening_balances_posted',jsonb_build_object('entry_ref',response->>'out_entry_ref','lines',jsonb_array_length(norm),'request_id',p_request_id));
 PERFORM accounting_master_private.receipt_put(t,p_request_id,'accounts:opening',payload,response);RETURN response;
END$$;

-- Preserve the service-only provisioning initializer; acquire catalog lock first.
-- Define complete standard accounting initialization for future workspaces and
-- explicit authorized initialization. This migration does not backfill any tenant.
CREATE OR REPLACE FUNCTION public.ensure_default_chart_of_accounts(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  PERFORM accounting_master_private.lock_catalog(p_tenant_id);
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant id is required';
  END IF;

  INSERT INTO public.chart_of_accounts
    (tenant_id, account_code, name_ar, name_en, account_type, normal_balance, is_contra)
  VALUES
    (p_tenant_id, '1000', 'النقد بالصندوق', 'Cash on Hand', 'asset', 'debit', false),
    (p_tenant_id, '1100', 'الحساب البنكي', 'Bank Account', 'asset', 'debit', false),
    (p_tenant_id, '1200', 'ذمم مدينة — عملاء', 'Accounts Receivable — Customers', 'asset', 'debit', false),
    (p_tenant_id, '1300', 'ذمم مدينة — منصات التوصيل', 'Accounts Receivable — Platforms', 'asset', 'debit', false),
    (p_tenant_id, '1400', 'ذمم مدينة — السائقون (COD)', 'Receivable — Drivers (COD)', 'asset', 'debit', false),
    (p_tenant_id, '1500', 'مصروفات مدفوعة مقدماً', 'Prepaid Expenses', 'asset', 'debit', false),
    (p_tenant_id, '1600', 'الأصول الثابتة', 'Fixed Assets', 'asset', 'debit', false),
    (p_tenant_id, '1610', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', 'credit', true),
    (p_tenant_id, '2000', 'ذمم دائنة — موردون', 'Accounts Payable — Suppliers', 'liability', 'credit', false),
    (p_tenant_id, '2100', 'رواتب مستحقة', 'Wages Payable', 'liability', 'credit', false),
    (p_tenant_id, '2200', 'مستحقات التأمينات (GOSI)', 'GOSI Payable', 'liability', 'credit', false),
    (p_tenant_id, '2300', 'سلف مستلمة', 'Advances Received', 'liability', 'credit', false),
    (p_tenant_id, '2500', 'ضريبة القيمة المضافة المستحقة (مخرجات)', 'VAT Output Payable', 'liability', 'credit', false),
    (p_tenant_id, '2600', 'ضريبة القيمة المضافة المدينة (مدخلات)', 'VAT Input Receivable', 'asset', 'debit', false),
    (p_tenant_id, '3000', 'رأس المال', 'Capital', 'equity', 'credit', false),
    (p_tenant_id, '3100', 'الأرباح المحتجزة', 'Retained Earnings', 'equity', 'credit', false),
    (p_tenant_id, '4000', 'إيرادات رسوم التوصيل', 'Revenue — Delivery Fees', 'income', 'credit', false),
    (p_tenant_id, '4100', 'إيرادات عمولات المنصات', 'Revenue — Platform Commissions', 'income', 'credit', false),
    (p_tenant_id, '4200', 'إيرادات رسوم التحصيل عند الاستلام', 'Revenue — COD Handling Fees', 'income', 'credit', false),
    (p_tenant_id, '5000', 'مصروفات الوقود', 'Fuel Expenses', 'expense', 'debit', false),
    (p_tenant_id, '5100', 'الصيانة والإصلاحات', 'Maintenance & Repairs', 'expense', 'debit', false),
    (p_tenant_id, '5200', 'الرواتب والأجور', 'Salaries & Wages', 'expense', 'debit', false),
    (p_tenant_id, '5300', 'اشتراكات التأمينات (GOSI)', 'GOSI Contributions', 'expense', 'debit', false),
    (p_tenant_id, '5400', 'الإيجار', 'Rent', 'expense', 'debit', false),
    (p_tenant_id, '5500', 'التأمين', 'Insurance', 'expense', 'debit', false),
    (p_tenant_id, '5600', 'الرسوم البنكية', 'Bank Charges', 'expense', 'debit', false),
    (p_tenant_id, '5700', 'مصروف الإهلاك', 'Depreciation Expense', 'expense', 'debit', false),
    (p_tenant_id, '5800', 'مصروفات متنوعة', 'Miscellaneous Expenses', 'expense', 'debit', false)
  ON CONFLICT (tenant_id, account_code) WHERE deleted_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Ensure the current open accounting period exists for the tenant.
  INSERT INTO public.accounting_periods (tenant_id, period_year, period_month, status)
  SELECT p_tenant_id,
         EXTRACT(YEAR FROM CURRENT_DATE)::smallint,
         EXTRACT(MONTH FROM CURRENT_DATE)::smallint,
         'open'
  ON CONFLICT (tenant_id,period_year,period_month) DO NOTHING;


  -- Standard templates from 040. Existing tenant choices are never overwritten.
  INSERT INTO public.expense_category_mappings(tenant_id,expense_type,coa_account_code,vat_recoverability)
  VALUES
    (p_tenant_id,'fuel','5000','recoverable'),
    (p_tenant_id,'maintenance','5100','recoverable'),
    (p_tenant_id,'operational','5800','recoverable'),
    (p_tenant_id,'platform_commission','5800','recoverable'),
    (p_tenant_id,'advance','1500','non_recoverable'),
    (p_tenant_id,'other','5800','pending_review')
  ON CONFLICT (tenant_id,expense_type) DO NOTHING;

  RETURN v_inserted;
END;
$$;


-- Close every legacy client write ACL, including column-level grants.
DO $acl$DECLARE t text;columns text;BEGIN
 FOREACH t IN ARRAY ARRAY['customers','suppliers','chart_of_accounts'] LOOP
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO columns FROM pg_attribute WHERE attrelid=('public.'||t)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT(%s),UPDATE(%s),REFERENCES(%s) ON public.%I FROM PUBLIC,anon,authenticated',columns,columns,columns,t);
 END LOOP;
END$acl$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA accounting_master_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION accounting_master_private.lock_catalog(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.validate_chart_account() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_my_accounting_master_page(text,text,integer,integer,boolean) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.read_my_chart_parent_page(text,uuid,text,integer,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.mutate_my_accounting_master(text,text,jsonb,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.import_my_chart_accounts(jsonb,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.initialize_my_chart_accounts(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.post_my_opening_balances(date,jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_accounting_master_page(text,text,integer,integer,boolean),public.read_my_chart_parent_page(text,uuid,text,integer,integer),public.mutate_my_accounting_master(text,text,jsonb,uuid,timestamptz,uuid),public.import_my_chart_accounts(jsonb,uuid),public.initialize_my_chart_accounts(uuid),public.post_my_opening_balances(date,jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ensure_default_chart_of_accounts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_chart_of_accounts(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
