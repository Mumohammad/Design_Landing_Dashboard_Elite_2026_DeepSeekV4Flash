-- Forward-only repair. Existing attempts, invoice decisions and delivery history
-- are retained. Unknown provider creation stays reserved until reconciled.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE FUNCTION public.claim_my_platform_checkout(p_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();inv public.platform_invoices%ROWTYPE;a public.platform_payment_attempts%ROWTYPE;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('settings','update') THEN RAISE EXCEPTION 'PAY004: payment permission required'; END IF;
 SELECT * INTO inv FROM public.platform_invoices WHERE id=p_invoice_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR inv.status NOT IN ('pending','overdue') OR inv.currency<>'SAR' OR inv.amount<=0 THEN RAISE EXCEPTION 'PAY003: invoice is not payable'; END IF;
 IF public.get_my_tenant_id() IS DISTINCT FROM t OR NOT public.user_has_permission('settings','update') THEN RAISE EXCEPTION 'PAY004: payment permission required'; END IF;
 SELECT * INTO a FROM public.platform_payment_attempts WHERE platform_invoice_id=inv.id AND tenant_id=t AND status IN ('creating','initiated') ORDER BY created_at,id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF a.amount_halalas IS DISTINCT FROM round(inv.amount*100)::integer THEN RAISE EXCEPTION 'PAY002: existing checkout needs reconciliation'; END IF;
  RETURN jsonb_build_object('attempt',to_jsonb(a),'invoice',jsonb_build_object('invoice_number',inv.invoice_number,'period_label',inv.period_label),'is_new',false);
 END IF;
 INSERT INTO public.platform_payment_attempts(platform_invoice_id,tenant_id,amount_halalas,created_by)
 VALUES(inv.id,t,round(inv.amount*100)::integer,actor) RETURNING * INTO a;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(t,actor,'platform_billing','platform_payment_attempts',a.id,'checkout_claimed',jsonb_build_object('invoice_id',inv.id,'amount_halalas',a.amount_halalas));
 RETURN jsonb_build_object('attempt',to_jsonb(a),'invoice',jsonb_build_object('invoice_number',inv.invoice_number,'period_label',inv.period_label),'is_new',true);
END $$;
REVOKE ALL ON FUNCTION public.claim_my_platform_checkout(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_my_platform_checkout(uuid) TO authenticated;

CREATE FUNCTION public.confirm_platform_checkout(p_attempt_id uuid,p_provider_id text,p_url text,p_amount_halalas integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.platform_payment_attempts%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'PAY004: provider server required'; END IF;
 IF p_provider_id IS NULL OR length(p_provider_id) NOT BETWEEN 1 AND 100 OR p_url IS NULL OR p_url !~ '^https://' OR length(p_url)>1000 THEN RAISE EXCEPTION 'PAY002: invalid provider mapping'; END IF;
 SELECT * INTO a FROM public.platform_payment_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF NOT FOUND OR a.amount_halalas IS DISTINCT FROM p_amount_halalas OR a.status NOT IN ('creating','initiated') THEN RAISE EXCEPTION 'PAY002: checkout changed'; END IF;
 IF a.provider_invoice_id IS NOT NULL AND (a.provider_invoice_id IS DISTINCT FROM p_provider_id OR a.checkout_url IS DISTINCT FROM p_url) THEN RAISE EXCEPTION 'PAY002: checkout already mapped'; END IF;
 UPDATE public.platform_payment_attempts SET provider_invoice_id=p_provider_id,checkout_url=p_url,status='initiated',updated_at=now() WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(a.tenant_id,a.created_by,'platform_billing','platform_payment_attempts',a.id,'checkout_mapped',jsonb_build_object('provider_invoice_id',p_provider_id));
 RETURN jsonb_build_object('id',a.id,'provider_invoice_id',a.provider_invoice_id,'checkout_url',a.checkout_url,'amount_halalas',a.amount_halalas,'status',a.status);
END $$;
REVOKE ALL ON FUNCTION public.confirm_platform_checkout(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_platform_checkout(uuid,text,text,integer) TO service_role;

-- Every operation that needs both rows locks invoice before attempt. The first
-- lookup takes no lock; the attempt's binding is checked again under both locks.
CREATE OR REPLACE FUNCTION public.settle_platform_card_payment(p_attempt_id uuid,p_provider_payment_id text,p_amount_halalas integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.platform_payment_attempts%ROWTYPE;inv public.platform_invoices%ROWTYPE;invoice_id uuid;
BEGIN
 SELECT platform_invoice_id INTO invoice_id FROM public.platform_payment_attempts WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAY001: unknown payment attempt'; END IF;
 SELECT * INTO inv FROM public.platform_invoices WHERE id=invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAY001: unknown payment invoice'; END IF;
 SELECT * INTO a FROM public.platform_payment_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF NOT FOUND OR a.platform_invoice_id IS DISTINCT FROM inv.id OR a.tenant_id IS DISTINCT FROM inv.tenant_id THEN RAISE EXCEPTION 'PAY002: payment does not match the invoice'; END IF;
 IF p_provider_payment_id IS NULL OR length(p_provider_payment_id) NOT BETWEEN 1 AND 100 OR p_amount_halalas IS DISTINCT FROM a.amount_halalas OR round(inv.amount*100)::integer<>a.amount_halalas OR inv.currency<>'SAR' THEN RAISE EXCEPTION 'PAY002: payment does not match the invoice'; END IF;
 IF a.failure_reason LIKE 'Captured after%' THEN RETURN 'duplicate_payment'; END IF;
 IF a.status='paid' AND inv.payment_reference IS NOT DISTINCT FROM a.provider_payment_id THEN
  IF a.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN RAISE EXCEPTION 'PAY002: payment does not match the invoice'; END IF;
  RETURN 'already_settled';
 END IF;
 IF inv.status='paid' THEN
  UPDATE public.platform_payment_attempts SET
   status=CASE WHEN EXISTS(SELECT 1 FROM public.platform_payment_attempts x WHERE x.platform_invoice_id=a.platform_invoice_id AND x.status='paid') THEN 'failed' ELSE 'paid' END,
   provider_payment_id=p_provider_payment_id,paid_at=now(),updated_at=now(),failure_reason='Captured after the invoice was already paid; refund required' WHERE id=a.id;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(a.tenant_id,NULL,'platform_billing','platform_invoices',inv.id,'card_payment_duplicate',jsonb_build_object('attempt_id',a.id,'provider_payment_id',p_provider_payment_id,'amount_halalas',p_amount_halalas));
  RETURN 'duplicate_payment';
 END IF;
 IF inv.status NOT IN ('pending','overdue') THEN RAISE EXCEPTION 'PAY003: invoice is not payable'; END IF;
 UPDATE public.platform_payment_attempts SET status='paid',provider_payment_id=p_provider_payment_id,paid_at=now(),updated_at=now() WHERE id=a.id;
 UPDATE public.platform_invoices SET status='paid',paid_at=now(),updated_at=now(),payment_method='card',payment_reference=p_provider_payment_id WHERE id=inv.id;
 UPDATE public.tenants SET billing_status='active_paid' WHERE id=a.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAY001: company not found'; END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(a.tenant_id,a.created_by,'platform_billing','platform_invoices',inv.id,'card_payment_settled',jsonb_build_object('attempt_id',a.id,'provider',a.provider,'provider_payment_id',p_provider_payment_id,'amount_halalas',p_amount_halalas));
 RETURN 'settled';
END $$;
REVOKE ALL ON FUNCTION public.settle_platform_card_payment(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_platform_card_payment(uuid,text,integer) TO service_role;

CREATE FUNCTION public.mark_platform_invoice_paid(p_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();inv public.platform_invoices%ROWTYPE;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=actor) THEN RAISE EXCEPTION 'PAY004: verified platform administrator required'; END IF;
 SELECT * INTO inv FROM public.platform_invoices WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND OR inv.status NOT IN ('pending','overdue') THEN RAISE EXCEPTION 'PAY003: invoice is not payable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=actor) THEN RAISE EXCEPTION 'PAY004: verified platform administrator required'; END IF;
 UPDATE public.platform_invoices SET status='paid',paid_at=now(),updated_at=now(),payment_method='manual' WHERE id=inv.id;
 UPDATE public.tenants SET billing_status='active_paid',updated_by=actor WHERE id=inv.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAY001: company not found'; END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(inv.tenant_id,actor,'platform_admin','platform_invoices',inv.id,'invoice_marked_paid',jsonb_build_object('status','paid','payment_method','manual'));
 RETURN jsonb_build_object('invoice_id',inv.id,'status','paid');
END $$;
REVOKE ALL ON FUNCTION public.mark_platform_invoice_paid(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_invoice_paid(uuid) TO authenticated;

ALTER TABLE public.notification_digest_log ADD COLUMN claim_token uuid,ADD COLUMN lease_until timestamptz,ADD COLUMN delivery_payload jsonb;
CREATE FUNCTION public.claim_notification_digest(p_tenant uuid,p_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry public.notification_digest_log%ROWTYPE;token uuid:=gen_random_uuid();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DIGEST_FORBIDDEN'; END IF;
 -- Provider idempotency is day-scoped: never start an old delivery again.
 IF p_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Riyadh')::date THEN RAISE EXCEPTION 'DIGEST_DATE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'DIGEST_TENANT_UNAVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('digest:'||p_tenant::text||':'||p_date::text,0));
 SELECT * INTO entry FROM public.notification_digest_log WHERE tenant_id=p_tenant AND run_date=p_date AND kind='scheduled' FOR UPDATE;
 IF FOUND THEN
  IF entry.status IN ('sent','skipped') OR (entry.status='pending' AND coalesce(entry.lease_until,entry.created_at+interval '10 minutes')>now()) THEN RETURN NULL; END IF;
  UPDATE public.notification_digest_log SET status='pending',claim_token=token,lease_until=now()+interval '10 minutes',finished_at=NULL,detail=NULL WHERE id=entry.id RETURNING * INTO entry;
 ELSE
  INSERT INTO public.notification_digest_log(tenant_id,run_date,kind,status,claim_token,lease_until) VALUES(p_tenant,p_date,'scheduled','pending',token,now()+interval '10 minutes') RETURNING * INTO entry;
 END IF;
 RETURN jsonb_build_object('id',entry.id,'claim_token',token,'payload',entry.delivery_payload);
END $$;
REVOKE ALL ON FUNCTION public.claim_notification_digest(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_digest(uuid,date) TO service_role;

CREATE FUNCTION public.prepare_notification_digest(p_id uuid,p_claim_token uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry public.notification_digest_log%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DIGEST_FORBIDDEN'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>2000000 THEN RAISE EXCEPTION 'DIGEST_PAYLOAD_INVALID'; END IF;
 SELECT * INTO entry FROM public.notification_digest_log WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR entry.claim_token IS DISTINCT FROM p_claim_token OR entry.status<>'pending' OR entry.lease_until<=now() THEN RAISE EXCEPTION 'DIGEST_CLAIM_STALE'; END IF;
 IF entry.delivery_payload IS NOT NULL AND entry.delivery_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'DIGEST_PAYLOAD_CHANGED'; END IF;
 UPDATE public.notification_digest_log SET delivery_payload=p_payload WHERE id=p_id;
 RETURN p_payload;
END $$;
REVOKE ALL ON FUNCTION public.prepare_notification_digest(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_notification_digest(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.finish_notification_digest(p_id uuid,p_claim_token uuid,p_patch jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry public.notification_digest_log%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DIGEST_FORBIDDEN'; END IF;
 IF p_patch->>'status' IS NULL OR p_patch->>'status' NOT IN ('sent','skipped','failed') THEN RAISE EXCEPTION 'DIGEST_STATUS_INVALID'; END IF;
 SELECT * INTO entry FROM public.notification_digest_log WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR entry.claim_token IS DISTINCT FROM p_claim_token OR entry.status<>'pending' THEN RAISE EXCEPTION 'DIGEST_CLAIM_STALE'; END IF;
 UPDATE public.notification_digest_log SET status=p_patch->>'status',recipients=coalesce((p_patch->>'recipients')::integer,0),items=coalesce((p_patch->>'items')::integer,0),critical=coalesce((p_patch->>'critical')::integer,0),detail=left(p_patch->>'detail',500),finished_at=now(),lease_until=NULL WHERE id=p_id;
 IF p_patch->>'status'='sent' THEN UPDATE public.notification_settings SET last_sent_at=now() WHERE tenant_id=entry.tenant_id; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_notification_digest(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_notification_digest(uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
