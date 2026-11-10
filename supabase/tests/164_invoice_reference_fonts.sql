-- Licensed invoice fonts are readable only by the service role. Rolls back.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(7);
SELECT ok(NOT has_function_privilege('anon','public.invoice_reference_fonts()','execute'),'anon cannot read fonts');
SELECT ok(NOT has_function_privilege('authenticated','public.invoice_reference_fonts()','execute'),'authenticated cannot read fonts');
SELECT ok(has_function_privilege('service_role','public.invoice_reference_fonts()','execute'),'service role can read fonts');
SELECT ok(NOT has_table_privilege('authenticated','invoice_assets_private.reference_fonts','select'),'no direct table access');
SELECT throws_ok($$INSERT INTO invoice_assets_private.reference_fonts(name,data) VALUES ('regular.ttf','\x504b0304000000000000000000'::bytea)$$,'23514',NULL,'non-TrueType bytes rejected');
SELECT throws_ok($$INSERT INTO invoice_assets_private.reference_fonts(name,data) VALUES ('evil.ttf','\x00010000000000000000000000'::bytea)$$,'23514',NULL,'only fixed names');
INSERT INTO invoice_assets_private.reference_fonts(name,data) VALUES ('bold.ttf','\x00010000000000000000000000'::bytea) ON CONFLICT (name) DO NOTHING;
SELECT ok((SELECT count(*) FROM public.invoice_reference_fonts() WHERE name='bold.ttf' AND data_base64 IS NOT NULL AND length(sha256)=64)=1,'function returns base64 + sha');
SELECT * FROM finish();
ROLLBACK;
