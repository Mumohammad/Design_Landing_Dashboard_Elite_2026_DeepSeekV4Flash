BEGIN;
SET LOCAL search_path = extensions, public, pg_temp;
SELECT no_plan();

INSERT INTO auth.users(id, email, raw_app_meta_data) VALUES
  ('17700000-0000-4000-8000-000000000001', 'telegram-receipt@example.test', '{"_invite_provisioned":true}');
CREATE TEMP TABLE telegram_fixture AS
SELECT (public.provision_company_atomic('17700000-0000-4000-8000-000000000001',
  '{"name":"Telegram receipt fixture","slug":"telegram177","domain":"telegram177.example.test"}')->>'id')::uuid AS tenant;
UPDATE public.users SET must_change_password = false WHERE auth_user_id = '17700000-0000-4000-8000-000000000001';
INSERT INTO public.expense_claim_settings(tenant_id, telegram_enabled) SELECT tenant, true FROM telegram_fixture
  ON CONFLICT(tenant_id) DO UPDATE SET telegram_enabled = true;
INSERT INTO public.expense_telegram_links(id,tenant_id,user_id,telegram_user_id,telegram_chat_id)
  SELECT '17700000-0000-4000-8000-000000000002',tenant,'17700000-0000-4000-8000-000000000001',1770001,1770001 FROM telegram_fixture;

CREATE FUNCTION pg_temp.reserve_receipt(update_id bigint, message_id bigint, album text DEFAULT NULL,
  fingerprint text DEFAULT repeat('a',64), message_date bigint DEFAULT floor(extract(epoch FROM now()))::bigint,
  link_id uuid DEFAULT '17700000-0000-4000-8000-000000000002')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.expense_telegram_reserve_receipt(1770000,update_id,1770001,1770001,message_id,message_date,link_id,album,fingerprint,
    jsonb_build_object('filename','test.pdf','mime','application/pdf','kind','digital_pdf','size',100,'sha256',repeat('b',64)));
$$;
CREATE FUNCTION pg_temp.finish_receipt(receipt_id uuid, fields jsonb DEFAULT '{"supplier_name":"Fixture supplier"}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.expense_telegram_finish_receipt(receipt_id, fields);
$$;
CREATE TEMP TABLE telegram_receipts(label text PRIMARY KEY, data jsonb);
INSERT INTO telegram_receipts VALUES ('first',pg_temp.reserve_receipt(1770101,17701,'album177')),
  ('second',pg_temp.reserve_receipt(1770102,17702,'album177'));

SELECT ok(NOT has_function_privilege('authenticated','public.expense_telegram_finish_receipt(uuid,jsonb)','EXECUTE'),
  'only the service can finalize Telegram intake');
SELECT ok(NOT has_function_privilege('anon','public.expense_telegram_reserve_receipt(bigint,bigint,bigint,bigint,bigint,bigint,uuid,text,text,jsonb)','EXECUTE'),
  'anonymous callers cannot reserve a Telegram upload');
SELECT is((SELECT count(*) FROM public.expense_claims WHERE tenant_id = (SELECT tenant FROM telegram_fixture)),0::bigint,
  'a reservation does not publish an empty claim');
SELECT is(pg_temp.reserve_receipt(1770101,17701,'album177'), (SELECT data FROM telegram_receipts WHERE label='first'),
  'a Telegram retry reuses its upload path');
SELECT throws_like($$SELECT pg_temp.reserve_receipt(1770101,17701,'album177',repeat('c',64))$$,
  '%TG_RECEIPT_CONFLICT%', 'cannot reuse a message for a different receipt');
SELECT throws_like($$SELECT pg_temp.reserve_receipt(1770101,17703,'album177')$$,
  '%TG_RECEIPT_CONFLICT%', 'cannot reuse an update ID for a different message');
SELECT is((SELECT data->>'claim_id' FROM telegram_receipts WHERE label='first'),
  (SELECT data->>'claim_id' FROM telegram_receipts WHERE label='second'), 'album shares the reserved claim ID');
SELECT throws_like($$SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid) FROM telegram_receipts WHERE label='first'$$,
  '%TG_RECEIPT_OBJECT%', 'the file must be present before a claim can be submitted');

INSERT INTO storage.buckets(id,name,public) VALUES ('expense-receipts','expense-receipts',false) ON CONFLICT DO NOTHING;
INSERT INTO storage.objects(bucket_id,name,metadata)
  SELECT 'expense-receipts',data->>'path','{"size":98,"mimetype":"application/pdf"}' FROM telegram_receipts WHERE label='first';
SELECT throws_like($$SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid) FROM telegram_receipts WHERE label='first'$$,
  '%TG_RECEIPT_OBJECT%', 'incorrect storage metadata prevents submission');
UPDATE storage.objects SET metadata='{"size":100,"mimetype":"application/pdf"}'
  WHERE bucket_id='expense-receipts' AND name=(SELECT data->>'path' FROM telegram_receipts WHERE label='first');
INSERT INTO storage.objects(bucket_id,name,metadata)
  SELECT 'expense-receipts',data->>'path','{"size":100,"mimetype":"application/pdf"}' FROM telegram_receipts WHERE label='second';

CREATE FUNCTION pg_temp.fail_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'synthetic receipt registration failure';
END;
$$;
CREATE TRIGGER telegram_test_attachment_failure BEFORE INSERT ON public.expense_claim_attachments
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_attachment();
SELECT throws_like($$SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid) FROM telegram_receipts WHERE label='first'$$,
  '%synthetic receipt registration failure%', 'attachment registration failure aborts the whole transaction');
SELECT is((SELECT count(*) FROM public.expense_claims WHERE tenant_id = (SELECT tenant FROM telegram_fixture)),0::bigint,
  'failed attachment registration rolls back the submitted claim');
SELECT is(pg_temp.reserve_receipt(1770101,17701,'album177')->>'completed','false',
  'the same upload can be retried after a failed attachment registration');
DROP TRIGGER telegram_test_attachment_failure ON public.expense_claim_attachments;

INSERT INTO telegram_receipts SELECT 'first-result', pg_temp.finish_receipt((data->>'receipt_id')::uuid,'{}')
  FROM telegram_receipts WHERE label='first';
SELECT is((SELECT data->>'created' FROM telegram_receipts WHERE label='first-result'),'true','the first valid file submits the claim');
SELECT is((SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid)->>'attachment_id' FROM telegram_receipts WHERE label='first'),
  (SELECT data->>'attachment_id' FROM telegram_receipts WHERE label='first-result'),'response loss replays the original attachment');
SELECT is(pg_temp.reserve_receipt(1770101,17701,'album177')->>'completed','true','a completed update can be acknowledged without reupload');
SELECT is((SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid)->>'created' FROM telegram_receipts WHERE label='second'),
  'false','the second album file attaches to the original claim');
SELECT is((SELECT count(*) FROM public.expense_claims WHERE tenant_id = (SELECT tenant FROM telegram_fixture)),1::bigint,
  'the album and retries create one claim');
SELECT is((SELECT count(*) FROM public.expense_claim_attachments WHERE tenant_id = (SELECT tenant FROM telegram_fixture)),2::bigint,
  'retries register each message attachment exactly once');
SELECT is((SELECT supplier_name FROM public.expense_claims WHERE tenant_id = (SELECT tenant FROM telegram_fixture)),
  'Fixture supplier','a later caption updates a previously uncaptioned album');

INSERT INTO telegram_receipts VALUES ('edited-first',pg_temp.reserve_receipt(1770110,17710,'edited-album')),
  ('edited-second',pg_temp.reserve_receipt(1770111,17711,'edited-album'));
INSERT INTO storage.objects(bucket_id,name,metadata)
  SELECT 'expense-receipts',data->>'path','{"size":100,"mimetype":"application/pdf"}'
  FROM telegram_receipts WHERE label IN ('edited-first','edited-second');
SELECT lives_ok($$SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid,'{}') FROM telegram_receipts WHERE label='edited-first'$$,
  'an uncaptioned page can arrive before manual review');
UPDATE public.expense_claims SET supplier_name = 'Reviewed supplier', version = version + 1
  WHERE telegram_media_group='edited-album' AND tenant_id=(SELECT tenant FROM telegram_fixture);
SELECT lives_ok($$SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid) FROM telegram_receipts WHERE label='edited-second'$$,
  'a captioned page can add its file after manual review');
SELECT is((SELECT supplier_name FROM public.expense_claims WHERE telegram_media_group='edited-album' AND tenant_id=(SELECT tenant FROM telegram_fixture)),
  'Reviewed supplier','later suggestions never overwrite a human revision');

INSERT INTO telegram_receipts VALUES ('legacy',public.expense_telegram_claim('17700000-0000-4000-8000-000000000001','{}','legacy-album'));
SELECT is(pg_temp.reserve_receipt(1770112,17712,'legacy-album')->>'claim_id',
  (SELECT data->>'id' FROM telegram_receipts WHERE label='legacy'),'a later page can join a pre-upgrade claim');
UPDATE expense_claims_private.telegram_receipts SET created_at = now() - interval '8 days' WHERE update_id = 1770101;
SELECT isnt(pg_temp.reserve_receipt(1770101,17704)->>'claim_id',
  (SELECT data->>'claim_id' FROM telegram_receipts WHERE label='first'), 'a new message can use a restarted update sequence');
INSERT INTO telegram_receipts VALUES ('revoked',pg_temp.reserve_receipt(1770103,17703));
UPDATE public.expense_telegram_links SET revoked_at = now() WHERE telegram_chat_id=1770001;
INSERT INTO public.expense_telegram_links(id,tenant_id,user_id,telegram_user_id,telegram_chat_id)
  SELECT '17700000-0000-4000-8000-000000000003',tenant,'17700000-0000-4000-8000-000000000001',1770001,1770001 FROM telegram_fixture;
SELECT throws_like($$SELECT pg_temp.reserve_receipt(1770113,17713)$$,
  '%TG_RECEIPT_DENIED%','the link looked up before download cannot be replaced during reservation');
SELECT throws_like($$SELECT pg_temp.reserve_receipt(1770113,17713,message_date=>1000,link_id=>'17700000-0000-4000-8000-000000000003')$$,
  '%TG_RECEIPT_DENIED%','a Telegram message sent before the current link cannot be reassigned');
SELECT throws_like($$SELECT pg_temp.finish_receipt((data->>'receipt_id')::uuid) FROM telegram_receipts WHERE label='revoked'$$,
  '%TG_RECEIPT_DENIED%', 'a revoked link cannot complete a reservation');

SELECT * FROM finish();
ROLLBACK;
