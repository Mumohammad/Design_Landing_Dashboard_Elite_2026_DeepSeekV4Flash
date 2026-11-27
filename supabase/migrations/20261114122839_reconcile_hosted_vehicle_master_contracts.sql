-- Reconcile inspected hosted vehicle/address contracts with the repository.
-- Known legacy/current bodies only; no historical replay, row updates or ACL changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $reviewed_contracts$
DECLARE r record; f pg_catalog.pg_proc%ROWTYPE; c pg_catalog.pg_constraint%ROWTYPE; a record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('accounting_master_private.normalize_input(text,text,jsonb)',ARRAY['1f15bad225665dcfae30fa0c8ace1fb5','95c08b7a07fcf1ae63cda810df460b93','c74054232af5fe9865b762810ce890f8','c494e374585c6c916058ae1f6beb2780']::text[],'i'::"char",false),
  ('public.mutate_my_accounting_master(text,text,jsonb,uuid,timestamptz,uuid)',ARRAY['8f3e91f3aa8c7dc8af78614d46d404dd','3de8fb3844ec68323b35b3c379a857b6','e1486b6197235ab9a96320ce821ba24c','f4aee7c203a8e1722f90b0a354b94f81']::text[],'v'::"char",true),
  ('private.save_fleet_vehicle(jsonb,uuid,bigint,text)',ARRAY['ee66b96492fb7f0dd8de802612621b7f','acd30e166c5c572fb0f1d063d3654a89','d5b9f4ba35c3d1b8f749ba494aeff19c','0309101ba53349ccca13b91dd916ea5a']::text[],'v'::"char",true)
 ) inspected(signature,body_hashes,volatility,definer) LOOP
  SELECT * INTO f FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF NOT FOUND OR pg_catalog.md5(f.prosrc)<>ALL(r.body_hashes)
   OR f.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')
   OR f.prokind<>'f' OR f.prorettype<>'jsonb'::pg_catalog.regtype
   OR f.provolatile<>r.volatility OR f.prosecdef IS DISTINCT FROM r.definer
   OR f.proisstrict OR f.proparallel<>'u'
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='HOSTED_CONTRACT_REVIEW_REQUIRED: unrecognized function definition or attributes';
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES ('ownership_type','text'),('sequence_number','text'),('rental_company','text'),('rental_contract_end','date'),('rental_monthly_cost','numeric(12,2)')) expected(name,type_name) LOOP
  SELECT pg_catalog.format_type(atttypid,atttypmod) AS type_name,attnotnull,atthasdef,attgenerated INTO a
   FROM pg_catalog.pg_attribute WHERE attrelid='public.vehicles'::pg_catalog.regclass AND attname=r.name AND attnum>0 AND NOT attisdropped;
  IF FOUND AND (a.type_name<>r.type_name OR a.attnotnull OR a.atthasdef OR a.attgenerated<>'') THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='HOSTED_CONTRACT_REVIEW_REQUIRED: incompatible existing vehicle column';
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('vehicles_ownership_type_check','CHECK (((ownership_type IS NULL) OR (ownership_type = ANY (ARRAY[''company_owned''::text, ''rented''::text, ''driver_owned''::text]))))'),
  ('vehicles_sequence_number_check','CHECK (((sequence_number IS NULL) OR (sequence_number ~ ''^[0-9]{6,10}$''::text)))'),
  ('vehicles_rental_monthly_cost_check','CHECK (((rental_monthly_cost IS NULL) OR (rental_monthly_cost >= (0)::numeric)))')
 ) expected(name,definition) LOOP
  SELECT * INTO c FROM pg_catalog.pg_constraint WHERE conrelid='public.vehicles'::pg_catalog.regclass AND conname=r.name;
  IF FOUND AND (c.contype<>'c' OR NOT c.convalidated OR pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'[[:space:]]','','g')<>pg_catalog.regexp_replace(r.definition,'[[:space:]]','','g')) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='HOSTED_CONTRACT_REVIEW_REQUIRED: incompatible existing vehicle constraint';
  END IF;
 END LOOP;
END
$reviewed_contracts$;

ALTER TABLE public.vehicles
 ADD COLUMN IF NOT EXISTS ownership_type text,
 ADD COLUMN IF NOT EXISTS sequence_number text,
 ADD COLUMN IF NOT EXISTS rental_company text,
 ADD COLUMN IF NOT EXISTS rental_contract_end date,
 ADD COLUMN IF NOT EXISTS rental_monthly_cost numeric(12,2);

DO $vehicle_constraints$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.vehicles'::pg_catalog.regclass AND conname='vehicles_ownership_type_check') THEN
  ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_ownership_type_check CHECK (ownership_type IS NULL OR ownership_type IN ('company_owned','rented','driver_owned'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.vehicles'::pg_catalog.regclass AND conname='vehicles_sequence_number_check') THEN
  ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_sequence_number_check CHECK (sequence_number IS NULL OR sequence_number ~ '^[0-9]{6,10}$');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.vehicles'::pg_catalog.regclass AND conname='vehicles_rental_monthly_cost_check') THEN
  ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_rental_monthly_cost_check CHECK (rental_monthly_cost IS NULL OR rental_monthly_cost >= 0);
 END IF;
END
$vehicle_constraints$;

-- Exact current definition from supabase/migrations/20261029090001_reconcile_atomic_national_address.sql
CREATE OR REPLACE FUNCTION accounting_master_private.normalize_input(p_kind text,p_action text,p_input jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb:='{}';k text;v jsonb;s text;n numeric;prefix text:=CASE WHEN p_kind='customers' THEN 'CUS' ELSE 'SUP' END;
BEGIN
 IF p_kind NOT IN('customers','suppliers','accounts') OR p_action NOT IN('create','update','set_active','archive') OR p_input IS NULL
 OR jsonb_typeof(p_input)<>'object' OR octet_length(convert_to(p_input::text,'UTF8'))>16384 THEN RAISE EXCEPTION 'MASTER_INVALID: invalid master details' USING ERRCODE='22023';END IF;
 IF p_action='archive' THEN IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'MASTER_INVALID: archive has no editable fields' USING ERRCODE='22023';END IF;RETURN p_input;END IF;
 IF p_action='set_active' THEN IF p_input- 'is_active'<>'{}'::jsonb OR jsonb_typeof(p_input->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'MASTER_INVALID: active state required' USING ERRCODE='22023';END IF;RETURN p_input;END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_input) LOOP
  IF (p_kind='accounts' AND k NOT IN('account_code','name_ar','name_en','account_type','normal_balance','parent_id','is_contra','is_active','description'))
  OR(p_kind<>'accounts' AND k NOT IN('code','name_ar','name_en','phone','email','tax_number','address','city','district','building_number','additional_number','postal_code','country_code','credit_limit','is_active')) THEN RAISE EXCEPTION 'MASTER_INVALID: unsupported master field' USING ERRCODE='22023';END IF;
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
   IF k IN('city','district','building_number','additional_number','postal_code','country_code') AND s ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid address text' USING ERRCODE='22023';END IF;
   IF(k='city' AND length(s)>100) OR(k='district' AND length(s)>127)
    OR(k IN('building_number','additional_number') AND s IS NOT NULL AND s !~ '^[0-9]{4}$')
    OR(k='postal_code' AND s IS NOT NULL AND s !~ '^[0-9]{5}$') THEN RAISE EXCEPTION 'MASTER_INVALID: invalid national address' USING ERRCODE='22023';END IF;
   IF k='country_code' THEN s:=coalesce(upper(s),'SA');IF s !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid country code' USING ERRCODE='22023';END IF;END IF;
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

-- Exact current definition from supabase/migrations/20261029090001_reconcile_atomic_national_address.sql
CREATE OR REPLACE FUNCTION public.mutate_my_accounting_master(p_kind text,p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL)
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
   EXECUTE format('INSERT INTO public.%I(tenant_id,%I,name_ar,name_en,phone,email,tax_number,address,credit_limit,is_active,created_by,updated_by,city,district,building_number,additional_number,postal_code,country_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16,$17) RETURNING to_jsonb(%I.*)',p_kind,code_col,p_kind)
   INTO newrow USING t,code,norm->>'name_ar',norm->>'name_en',norm->>'phone',norm->>'email',norm->>'tax_number',norm->>'address',(norm->>'credit_limit')::numeric,coalesce((norm->>'is_active')::boolean,true),auth.uid(),norm->>'city',norm->>'district',norm->>'building_number',norm->>'additional_number',norm->>'postal_code',coalesce(norm->>'country_code','SA');
  ELSIF p_action='update' THEN
   code:=coalesce(norm->>'code',oldrow->>code_col);
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE tenant_id=$1 AND upper(%I)=upper($2) AND deleted_at IS NULL AND id<>$3)',p_kind,code_col) INTO duplicate USING t,code,p_id;
   IF duplicate THEN RAISE EXCEPTION 'MASTER_DUPLICATE: party code already exists';END IF;
   EXECUTE format('UPDATE public.%I SET %I=$3,name_ar=$4,name_en=$5,phone=$6,email=$7,tax_number=$8,address=$9,credit_limit=$10,is_active=$11,updated_by=$12,city=$13,district=$14,building_number=$15,additional_number=$16,postal_code=$17,country_code=$18 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,code_col,p_kind)
   INTO newrow USING t,p_id,code,coalesce(norm->>'name_ar',oldrow->>'name_ar'),CASE WHEN norm?'name_en' THEN norm->>'name_en' ELSE oldrow->>'name_en' END,CASE WHEN norm?'phone' THEN norm->>'phone' ELSE oldrow->>'phone' END,CASE WHEN norm?'email' THEN norm->>'email' ELSE oldrow->>'email' END,CASE WHEN norm?'tax_number' THEN norm->>'tax_number' ELSE oldrow->>'tax_number' END,CASE WHEN norm?'address' THEN norm->>'address' ELSE oldrow->>'address' END,CASE WHEN norm?'credit_limit' THEN(norm->>'credit_limit')::numeric ELSE(oldrow->>'credit_limit')::numeric END,coalesce((norm->>'is_active')::boolean,(oldrow->>'is_active')::boolean),auth.uid(),CASE WHEN norm?'city' THEN norm->>'city' ELSE oldrow->>'city' END,CASE WHEN norm?'district' THEN norm->>'district' ELSE oldrow->>'district' END,CASE WHEN norm?'building_number' THEN norm->>'building_number' ELSE oldrow->>'building_number' END,CASE WHEN norm?'additional_number' THEN norm->>'additional_number' ELSE oldrow->>'additional_number' END,CASE WHEN norm?'postal_code' THEN norm->>'postal_code' ELSE oldrow->>'postal_code' END,CASE WHEN norm?'country_code' THEN norm->>'country_code' ELSE oldrow->>'country_code' END;
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

-- Exact current definition from supabase/migrations/20261101090000_invoice_bank_vehicle_ownership.sql
CREATE OR REPLACE FUNCTION private.save_fleet_vehicle(p_input jsonb, p_id uuid DEFAULT NULL::uuid, p_expected_version bigint DEFAULT NULL::bigint, p_archive_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE; n public.vehicles%ROWTYPE; vid uuid:=coalesce(p_id,gen_random_uuid()); old_row jsonb; new_row jsonb; stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('vehicles',CASE WHEN p_archive_reason IS NOT NULL THEN 'delete' WHEN p_id IS NULL THEN 'create' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: vehicle permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('vehicle_code','plate_number','plate_type','make','model','year','color','chassis_number','engine_number','vin','status','condition_status','fuel_type','odometer_current','odometer_last_service','odometer_unit','purchase_date','warranty_expiry','insurance_expiry','insurance_provider','insurance_policy_number','inspection_expiry','registration_expiry','operating_card_expiry','primary_platform_id','transmission','seats','cargo_capacity','notes','tags','ownership_type','sequence_number','rental_company','rental_contract_end','rental_monthly_cost')) THEN RAISE EXCEPTION 'FLT002: invalid vehicle fields'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO v FROM public.vehicles WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<>v.version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
  old_row:=to_jsonb(v);
 END IF;
 IF p_archive_reason IS NOT NULL THEN
  IF length(btrim(p_archive_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FLT012: a reason is required'; END IF;
  IF v.current_driver_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE vehicle_id=vid AND tenant_id=t AND is_current AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE vehicle_id=vid AND tenant_id=t AND deleted_at IS NULL AND status IN ('open','in_progress')) THEN RAISE EXCEPTION 'FLT013: end active assignments and maintenance before archiving'; END IF;
  UPDATE public.vehicles SET deleted_at=stamp,status='retired',updated_by=a WHERE id=vid AND tenant_id=t;
 ELSE
  n:=jsonb_populate_record(NULL::public.vehicles,coalesce(old_row,jsonb_build_object('id',vid,'tenant_id',t,'status','available','condition_status','good','odometer_current',0,'odometer_unit','km','created_at',stamp,'updated_at',stamp,'created_by',a,'version',1)) || p_input);
  IF length(btrim(coalesce(n.plate_number,''))) NOT BETWEEN 2 AND 16 OR n.plate_number !~ '^([A-Z]{1,3}[ ]?[0-9]{1,4}|[ء-ي]{1,3}[ ]?[0-9]{1,4}|[0-9]{4,7})$' OR length(btrim(coalesce(n.make,''))) NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(n.model,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FLT014: valid plate, make and model required'; END IF;
  IF n.odometer_current NOT BETWEEN 0 AND 5000000 OR (p_id IS NOT NULL AND n.odometer_current<v.odometer_current) OR n.odometer_last_service>n.odometer_current OR n.seats NOT BETWEEN 1 AND 100 OR n.cargo_capacity<0 OR length(coalesce(n.notes,''))>2000 THEN RAISE EXCEPTION 'FLT010: invalid vehicle values'; END IF;
  IF n.primary_platform_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=n.primary_platform_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'FLT009: platform must belong to this tenant'; END IF;
  IF (p_id IS NULL AND n.status NOT IN ('available','off_road','retired')) OR (p_id IS NOT NULL AND n.status IS DISTINCT FROM v.status AND (n.status NOT IN ('available','off_road','retired') OR v.current_driver_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE tenant_id=t AND vehicle_id=vid AND is_current AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE tenant_id=t AND vehicle_id=vid AND deleted_at IS NULL AND status IN ('open','in_progress')))) THEN RAISE EXCEPTION 'FLT015: status is managed by active assignments and maintenance'; END IF;
  IF n.ownership_type IS NOT NULL AND n.ownership_type NOT IN ('company_owned','rented','driver_owned') THEN RAISE EXCEPTION 'FLT010: invalid vehicle ownership type'; END IF;
  IF n.sequence_number IS NOT NULL AND btrim(n.sequence_number) !~ '^[0-9]{6,10}$' THEN RAISE EXCEPTION 'FLT010: registration sequence number must be 6-10 digits'; END IF;
  IF n.ownership_type IS DISTINCT FROM 'rented' THEN n.rental_company:=NULL; n.rental_contract_end:=NULL; n.rental_monthly_cost:=NULL; END IF;
  IF length(coalesce(n.rental_company,''))>200 OR n.rental_monthly_cost<0 OR n.rental_monthly_cost>9999999.99 THEN RAISE EXCEPTION 'FLT010: invalid rental details'; END IF;
  n.sequence_number:=nullif(btrim(n.sequence_number),''); n.rental_company:=nullif(btrim(n.rental_company),'');
  n.vehicle_code:=coalesce(nullif(btrim(n.vehicle_code),''),'VEH-'||upper(substr(replace(vid::text,'-',''),1,10))); n.plate_number:=btrim(n.plate_number); n.make:=btrim(n.make); n.model:=btrim(n.model);
  IF p_id IS NULL THEN INSERT INTO public.vehicles SELECT n.*;
  ELSE UPDATE public.vehicles SET vehicle_code=n.vehicle_code,plate_number=n.plate_number,plate_type=n.plate_type,make=n.make,model=n.model,year=n.year,color=n.color,chassis_number=n.chassis_number,engine_number=n.engine_number,vin=n.vin,status=n.status,condition_status=n.condition_status,fuel_type=n.fuel_type,odometer_current=n.odometer_current,odometer_last_service=n.odometer_last_service,odometer_unit=n.odometer_unit,purchase_date=n.purchase_date,warranty_expiry=n.warranty_expiry,insurance_expiry=n.insurance_expiry,insurance_provider=n.insurance_provider,insurance_policy_number=n.insurance_policy_number,inspection_expiry=n.inspection_expiry,registration_expiry=n.registration_expiry,operating_card_expiry=n.operating_card_expiry,primary_platform_id=n.primary_platform_id,transmission=n.transmission,seats=n.seats,cargo_capacity=n.cargo_capacity,notes=n.notes,tags=n.tags,ownership_type=n.ownership_type,sequence_number=n.sequence_number,rental_company=n.rental_company,rental_contract_end=n.rental_contract_end,rental_monthly_cost=n.rental_monthly_cost,updated_by=a WHERE id=vid AND tenant_id=t; END IF;
  IF p_id IS NULL OR n.odometer_current>v.odometer_current THEN INSERT INTO public.vehicle_odometer_logs(tenant_id,vehicle_id,reading,recorded_by,notes) VALUES(t,vid,n.odometer_current,a,'Vehicle record observation'); END IF;
 END IF;
 SELECT to_jsonb(x) INTO new_row FROM public.vehicles x WHERE id=vid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicles',vid,CASE WHEN p_archive_reason IS NOT NULL THEN 'vehicle_archived' WHEN p_id IS NULL THEN 'vehicle_created' ELSE 'vehicle_updated' END,old_row,new_row||jsonb_build_object('archive_reason',p_archive_reason));
 RETURN jsonb_build_object('id',vid,'version',new_row->'version');
END; $function$;

NOTIFY pgrst,'reload schema';
COMMIT;
