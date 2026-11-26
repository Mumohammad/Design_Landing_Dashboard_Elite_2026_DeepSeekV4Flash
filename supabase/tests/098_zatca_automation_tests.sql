BEGIN;
SELECT no_plan();
SELECT has_table('public','zatca_automation','Scheduled ZATCA operator table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.zatca_automation'::regclass),'RLS is enabled');
SELECT ok(NOT has_table_privilege('authenticated','public.zatca_automation','SELECT'),'Clients cannot read the automation operator');
SELECT ok(NOT has_table_privilege('anon','public.zatca_automation','INSERT'),'Anonymous users cannot write it');
SELECT ok(has_table_privilege('service_role','public.zatca_automation','UPDATE'),'Service role maintains it');
SELECT ok(NOT has_function_privilege('authenticated','public.zatca_operator_authorized(uuid,uuid)','EXECUTE'),'Operator check is not callable by clients');
SELECT is(public.zatca_operator_authorized(gen_random_uuid(), gen_random_uuid()), false,'Unknown users are never authorized');

SELECT ok(NOT has_function_privilege(role_name,'public.claim_zatca_scheduled_tenant()','EXECUTE'),
  role_name||' cannot claim a retry turn') FROM unnest(ARRAY['anon','authenticated']) role_name;
SELECT ok(NOT has_function_privilege(role_name,'public.finish_zatca_scheduled_tenant(uuid,uuid,jsonb)','EXECUTE'),
  role_name||' cannot checkpoint a retry turn') FROM unnest(ARRAY['anon','authenticated']) role_name;
SELECT ok(NOT has_function_privilege(role_name,'public.list_zatca_scheduled_events(uuid,text,timestamptz,timestamptz,uuid,integer)','EXECUTE'),
  role_name||' cannot read the scheduled retry worklist') FROM unnest(ARRAY['anon','authenticated']) role_name;

UPDATE public.zatca_automation SET enabled=false WHERE enabled;
INSERT INTO auth.users(id,email,raw_app_meta_data)
  VALUES('09800000-0000-4000-8000-000000000010','zatca-schedule-fixture@example.test','{"_invite_provisioned":true}');
INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
  ('09800000-0000-4000-8000-000000000001','Synthetic schedule tenant A','Synthetic schedule tenant A','zatca-schedule-a'),
  ('09800000-0000-4000-8000-000000000002','Synthetic schedule tenant B','Synthetic schedule tenant B','zatca-schedule-b'),
  ('09800000-0000-4000-8000-000000000003','Synthetic schedule tenant C','Synthetic schedule tenant C','zatca-schedule-c'),
  ('09800000-0000-4000-8000-000000000004','Synthetic disabled schedule tenant','Synthetic disabled schedule tenant','zatca-schedule-disabled');
INSERT INTO public.zatca_automation(tenant_id,operator_id,enabled,last_run_at,last_scheduled_at)
  SELECT id,'09800000-0000-4000-8000-000000000010',slug <> 'zatca-schedule-disabled',
    clock_timestamp(), CASE WHEN slug='zatca-schedule-c' THEN clock_timestamp()-interval '1 hour' END
  FROM public.tenants WHERE slug IN ('zatca-schedule-a','zatca-schedule-b','zatca-schedule-c','zatca-schedule-disabled');
CREATE TEMP TABLE z098_turns(label text PRIMARY KEY, result jsonb);
GRANT SELECT, INSERT ON z098_turns TO service_role;
CREATE FUNCTION pg_temp.z098_finish(p_label text, p_progress jsonb) RETURNS boolean LANGUAGE sql AS $$
  SELECT public.finish_zatca_scheduled_tenant((result->>'tenant_id')::uuid,(result->>'token')::uuid,p_progress)
  FROM z098_turns WHERE label=p_label;
$$;

SET LOCAL ROLE service_role;
INSERT INTO z098_turns VALUES ('first',public.claim_zatca_scheduled_tenant());
SELECT is((SELECT result->>'tenant_id' FROM z098_turns WHERE label='first'),'09800000-0000-4000-8000-000000000001',
  'manual activity does not affect the scheduled ordering');
SELECT is(pg_temp.z098_finish('first',
  '{"scan":{"environment":"sandbox","through":"2026-10-30T12:00:00.000Z","cursor":{"id":"09800000-0000-4000-8000-000000000020","created_at":"2026-10-30T11:00:00.123456Z"}}}'),
  true,'a matching worker checkpoints the scan');
INSERT INTO z098_turns VALUES ('second',public.claim_zatca_scheduled_tenant());
SELECT is((SELECT result->>'tenant_id' FROM z098_turns WHERE label='second'),'09800000-0000-4000-8000-000000000002',
  'the first tenant remains in cooldown after completing a turn');
INSERT INTO z098_turns VALUES ('third',public.claim_zatca_scheduled_tenant());
SELECT is((SELECT result->>'tenant_id' FROM z098_turns WHERE label='third'),'09800000-0000-4000-8000-000000000003',
  'never-run tenants rotate ahead of a previously scheduled tenant');
SELECT is(public.claim_zatca_scheduled_tenant(),NULL::jsonb,'disabled and recently claimed tenants cannot be claimed again');

UPDATE public.zatca_automation SET last_scheduled_at=clock_timestamp()-interval '6 minutes'
  WHERE tenant_id='09800000-0000-4000-8000-000000000001';
INSERT INTO z098_turns VALUES ('resume',public.claim_zatca_scheduled_tenant());
SELECT is((SELECT (result#>>'{scan,cursor,created_at}')::timestamptz FROM z098_turns WHERE label='resume'),
  '2026-10-30T11:00:00.123456Z'::timestamptz,'cursor checkpoints retain database timestamp precision');
SELECT is((SELECT (result#>>'{scan,through}')::timestamptz FROM z098_turns WHERE label='resume'),
  '2026-10-30T12:00:00Z'::timestamptz,'later turns retain the original sweep horizon');
SELECT is(pg_temp.z098_finish('first','{"scan":null}'),false,'an old claim cannot reset newer progress');
SELECT throws_ok($$SELECT pg_temp.z098_finish('resume','{"scan":{"environment":"production","through":"2026-10-30T12:00:00Z","cursor":null}}')$$,
  '22023','ZTC_SCHEDULE: invalid retry scan','the retry cursor is bound to an enabled submission environment');
SELECT throws_ok($$SELECT pg_temp.z098_finish('resume','{"scan":{"environment":"sandbox","through":"2026-10-30T12:00:00Z","cursor":{"id":"09800000-0000-4000-8000-000000000020","created_at":"2026-10-31T12:00:00Z"}}}')$$,
  '22023','ZTC_SCHEDULE: invalid retry cursor','the cursor cannot move beyond its sweep window');
SELECT is(pg_temp.z098_finish('resume',NULL),true,'a failed or unstarted turn releases its token');
SELECT ok((SELECT scheduled_scan IS NOT NULL FROM public.zatca_automation WHERE tenant_id='09800000-0000-4000-8000-000000000001'),
  'a failed or unstarted turn retains the old scan');

UPDATE public.zatca_automation SET last_scheduled_at=clock_timestamp()-interval '6 minutes'
  WHERE tenant_id='09800000-0000-4000-8000-000000000002';
INSERT INTO z098_turns VALUES ('recovered',public.claim_zatca_scheduled_tenant());
SELECT is((SELECT result->>'tenant_id' FROM z098_turns WHERE label='recovered'),'09800000-0000-4000-8000-000000000002',
  'a tenant can recover after a worker loses its claim response');
SELECT is(pg_temp.z098_finish('second','{"scan":null}'),false,'the released worker cannot checkpoint an expired claim that was replaced');
SELECT is(pg_temp.z098_finish('recovered','{"scan":null}'),true,'the replacement worker can complete the sweep');

UPDATE public.zatca_automation SET last_scheduled_at=clock_timestamp()-interval '6 minutes'
  WHERE tenant_id='09800000-0000-4000-8000-000000000001';
INSERT INTO z098_turns VALUES ('complete',public.claim_zatca_scheduled_tenant());
SELECT is(pg_temp.z098_finish('complete','{"scan":null}'),true,'a completed sweep explicitly resets its cursor');
SELECT ok((SELECT scheduled_scan IS NULL FROM public.zatca_automation WHERE tenant_id='09800000-0000-4000-8000-000000000001'),
  'the next sweep will start from the first eligible event');
RESET ROLE;

INSERT INTO public.customers(id,tenant_id,name_ar)
  VALUES('09800000-0000-4000-8000-000000000030','09800000-0000-4000-8000-000000000001','Synthetic retry customer');
INSERT INTO public.invoices(id,tenant_id,invoice_type,customer_id,issue_date,due_date,subtotal,vat_amount,total,vat_rate,status,created_by)
  VALUES('09800000-0000-4000-8000-000000000031','09800000-0000-4000-8000-000000000001','sales','09800000-0000-4000-8000-000000000030',
    current_date,current_date,100,15,115,15,'finalized','09800000-0000-4000-8000-000000000010');
INSERT INTO public.zatca_issuance_streams(tenant_id,environment,egs_serial,created_at)
  VALUES('09800000-0000-4000-8000-000000000001','sandbox','SYNTHETIC-SCHEDULE','2026-10-30T00:00:00Z');
INSERT INTO public.financial_events(id,tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload,created_at)
  SELECT ('09800000-0000-4000-8000-0000000000'||event_no)::uuid,
    CASE WHEN event_no='47' THEN '09800000-0000-4000-8000-000000000002'::uuid ELSE '09800000-0000-4000-8000-000000000001'::uuid END,
    gen_random_uuid(),'zatca-schedule-event-'||event_no,'invoice',('09800000-0000-4000-8000-0000000000'||event_no)::uuid,
    event_type,occurred_at::date,'{}',occurred_at
  FROM (VALUES
    ('40','InvoiceFinalizedEvent','2026-10-29T00:00:00Z'::timestamptz),
    ('41','InvoiceFinalizedEvent','2026-10-30T10:00:00Z'::timestamptz),
    ('42','InvoiceFinalizedEvent','2026-10-30T10:30:00.123456Z'::timestamptz),
    ('43','InvoiceFinalizedEvent','2026-10-30T10:30:00.123456Z'::timestamptz),
    ('44','InvoiceFinalizedEvent','2026-10-30T11:00:00Z'::timestamptz),
    ('45','InvoiceFinalizedEvent','2026-10-30T13:00:00Z'::timestamptz),
    ('46','PaymentReceivedEvent','2026-10-30T11:00:00Z'::timestamptz),
    ('47','InvoiceFinalizedEvent','2026-10-30T11:00:00Z'::timestamptz)
  ) AS fixture(event_no,event_type,occurred_at);
INSERT INTO public.zatca_transmissions(tenant_id,invoice_id,source_id,doc_type,doc_ref,payload_xml,status,response)
  SELECT '09800000-0000-4000-8000-000000000001','09800000-0000-4000-8000-000000000031',
    ('09800000-0000-4000-8000-0000000000'||event_no)::uuid,'invoice','SYNTHETIC','<Invoice/>',status::public.zatca_status,response::jsonb
  FROM (VALUES
    ('41','cleared','{"environment":"sandbox"}'),
    ('42','cleared','{"environment":"simulation"}'),
    ('43','cleared','{"environment":"sandbox","mock":true}'),
    ('44','rejected','{"environment":"sandbox"}')
  ) AS fixture(event_no,status,response);
SET LOCAL ROLE service_role;
SELECT is((SELECT string_agg(right(event->>'id',2),',' ORDER BY event->>'created_at',event->>'id')
  FROM jsonb_array_elements(public.list_zatca_scheduled_events('09800000-0000-4000-8000-000000000001','sandbox',
    '2026-10-30T12:00:00Z',NULL,NULL,17)->'events') AS event),
  '42,43,44','retry worklist skips the current environment acceptance and old history, retaining failures, mock and other-environment rows');
SELECT is(public.list_zatca_scheduled_events('09800000-0000-4000-8000-000000000001','sandbox','2026-10-30T12:00:00Z',
    '2026-10-30T10:30:00.123456Z','09800000-0000-4000-8000-000000000042',1)#>>'{events,0,id}',
  '09800000-0000-4000-8000-000000000043','retry worklist resumes after the exact timestamp and UUID and honors its raw limit');
SELECT is(public.list_zatca_scheduled_events('09800000-0000-4000-8000-000000000001','sandbox','2026-10-30T12:00:00Z',
    NULL,NULL,1)->'events','[]'::jsonb,'a raw window containing only a settled event has no submission work');
SELECT is(public.list_zatca_scheduled_events('09800000-0000-4000-8000-000000000001','sandbox','2026-10-30T12:00:00Z',
    NULL,NULL,1)#>>'{after,id}','09800000-0000-4000-8000-000000000041','settled history still advances the scan cursor');
SELECT is(public.list_zatca_scheduled_events('09800000-0000-4000-8000-000000000001','sandbox','2026-10-30T12:00:00Z',
    NULL,NULL,1)->>'has_more','true','a settled prefix reports pending raw history beyond the window');
SELECT is(public.list_zatca_scheduled_events('09800000-0000-4000-8000-000000000001','simulation','2026-10-30T12:00:00Z',
    NULL,NULL,1),NULL::jsonb,'a tenant with no stream in this environment cannot retry historical events');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
