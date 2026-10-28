BEGIN;
SELECT plan(15);
-- National Address (migration 20261028131000)
SELECT has_column('public','tenants','building_number','Seller building number column');
SELECT has_column('public','tenants','postal_code','Seller postal code column');
SELECT has_column('public','tenants','district','Seller district column');
SELECT has_column('public','customers','city','Buyer city column (previously selected but missing)');
SELECT has_column('public','customers','building_number','Buyer building number column');
SELECT has_column('public','customers','country_code','Buyer country code column');
SELECT has_column('public','suppliers','postal_code','Supplier postal code column');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenants_national_address_format' AND conrelid='public.tenants'::regclass),'Seller National Address format is enforced');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customers_national_address_format' AND conrelid='public.customers'::regclass),'Buyer National Address format is enforced');
SELECT throws_ok($$INSERT INTO public.tenants(name_ar,name_en,building_number) VALUES ('اختبار','Synthetic','12')$$,'23514',NULL,'A 2-digit building number is rejected');
-- One transmission per source document (migration 20261028132000)
SELECT col_not_null('public','zatca_transmissions','source_id','Transmissions are keyed by their source document');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_zatca_transmissions_tenant_source' AND indexdef LIKE '%UNIQUE%'),'Unique per (tenant, doc_type, source_id)');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_zatca_transmissions_tenant_invoice'),'Old per-invoice key that blocked second credit notes is gone');
-- Riyadh-local IssueDate/IssueTime (migration 20261028130000)
SELECT ok(pg_get_functiondef('public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid)'::regprocedure) LIKE '%AT TIME ZONE ''Asia/Riyadh''%'
  AND pg_get_functiondef('public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid)'::regprocedure) NOT LIKE '%AT TIME ZONE ''UTC''%','Issuance checks the Riyadh-local issue date/time');
SELECT has_trigger('public','zatca_transmissions','trg_zatca_transmissions_default_source','Legacy writers default source_id to the invoice');
SELECT * FROM finish();
ROLLBACK;
