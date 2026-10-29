-- 078 — Per-bucket Storage RBAC, tenant prefixes, traversal, and account state.

BEGIN;

CREATE TEMP TABLE storage_policy_matrix (
  bucket_id text NOT NULL,
  command_name text NOT NULL,
  module_name text NOT NULL,
  action_name text NOT NULL,
  PRIMARY KEY (bucket_id, command_name)
);

INSERT INTO storage_policy_matrix VALUES
  ('driver-photos', 'SELECT', 'drivers', 'read'),
  ('driver-photos', 'INSERT', 'drivers', 'update'),
  ('driver-documents', 'SELECT', 'drivers', 'read'),
  ('driver-documents', 'INSERT', 'drivers', 'update'),
  ('vehicle-photos', 'SELECT', 'vehicles', 'read'),
  ('vehicle-photos', 'INSERT', 'vehicles', 'update'),
  ('vehicle-photos', 'UPDATE', 'vehicles', 'update'),
  ('vehicle-documents', 'SELECT', 'vehicles', 'read'),
  ('vehicle-documents', 'INSERT', 'vehicles', 'update'),
  ('vehicle-documents', 'UPDATE', 'vehicles', 'update'),
  ('violation-evidence', 'SELECT', 'violations', 'read'),
  ('violation-evidence', 'INSERT', 'violations', 'create'),
  ('violation-evidence', 'UPDATE', 'violations', 'update'),
  ('generated-reports', 'SELECT', 'reports', 'read'),
  ('payroll-payslips', 'SELECT', 'payroll', 'read'),
  ('invoice-documents', 'SELECT', 'invoices', 'read'),
  ('invoice-documents', 'INSERT', 'invoices', 'create'),
  ('invoice-documents', 'UPDATE', 'invoices', 'update'),
  ('invoice-documents', 'DELETE', 'invoices', 'update'),
  ('company-assets', 'INSERT', 'settings', 'manage'),
  ('company-assets', 'UPDATE', 'settings', 'manage'),
  ('company-assets', 'DELETE', 'settings', 'manage');

CREATE TEMP TABLE storage_write_matrix (
  bucket_id text PRIMARY KEY,
  mime_type text NOT NULL,
  extension text NOT NULL
);
INSERT INTO storage_write_matrix VALUES
  ('driver-photos', 'image/jpeg', 'jpg'),
  ('driver-documents', 'application/pdf', 'pdf'),
  ('vehicle-photos', 'image/jpeg', 'jpg'),
  ('vehicle-documents', 'application/pdf', 'pdf'),
  ('violation-evidence', 'application/pdf', 'pdf'),
  ('invoice-documents', 'application/pdf', 'pdf'),
  ('company-assets', 'image/png', 'png');

CREATE TEMP TABLE storage_read_matrix (bucket_id text PRIMARY KEY);
INSERT INTO storage_read_matrix VALUES
  ('generated-reports'), ('payroll-payslips');

GRANT SELECT ON storage_policy_matrix, storage_write_matrix,
  storage_read_matrix TO authenticated, service_role;

-- Tenant 2's test caller has a valid JWT but no role-permission rows.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users
SET role = 'readonly_auditor', status = 'active',
    locked_until = NULL, deleted_at = NULL
WHERE auth_user_id = '00000000-0000-0000-0000-000000000002';

SELECT plan(
  (SELECT count(*)::integer * 2 FROM storage_policy_matrix)
  + (SELECT count(*)::integer * 4 FROM storage_write_matrix)
  + (SELECT count(*)::integer * 4 FROM storage_read_matrix)
  + 15
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage'
      AND p.tablename = 'objects'
      AND p.cmd = m.command_name
      AND 'authenticated' = ANY(p.roles)
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
          LIKE ('%' || m.bucket_id || '%')
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE
          ('%user_has_permission(''' || m.module_name || '''::text, ''' ||
           m.action_name || '''::text)%')
  ),
  format('%s %s requires %s:%s', m.bucket_id, m.command_name,
         m.module_name, m.action_name)
)
FROM storage_policy_matrix m ORDER BY m.bucket_id, m.command_name;

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage'
      AND p.tablename = 'objects'
      AND p.cmd = m.command_name
      AND 'authenticated' = ANY(p.roles)
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
          LIKE ('%' || m.bucket_id || '%')
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
          LIKE '%storage_path_in_current_tenant%'
  ),
  format('%s %s enforces the active caller tenant path',
         m.bucket_id, m.command_name)
)
FROM storage_policy_matrix m ORDER BY m.bucket_id, m.command_name;

-- Driver evidence is append-only: read/upload remain authorized, while
-- replacements finalize a fresh object through the reviewed driver RPC.
SELECT is(
 (SELECT count(*)::integer FROM pg_policies p WHERE p.schemaname='storage' AND p.tablename='objects' AND p.cmd='UPDATE' AND (coalesce(p.qual,'')||coalesce(p.with_check,'')) LIKE '%'||bucket||'%'),
 0,format('%s has no in-place UPDATE policy',bucket)
) FROM unnest(ARRAY['driver-photos','driver-documents']) bucket;

-- Authorized role: each human-writable bucket accepts an own-tenant path.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT lives_ok(
  format(
    'INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (%L, %L, %L::jsonb)',
    m.bucket_id,
    '00000000-0000-0000-0000-000000000001/078-' || m.bucket_id ||
      '-valid.' || m.extension,
    jsonb_build_object('mimetype', m.mime_type)::text
  ),
  format('authorized role may insert into %s', m.bucket_id)
)
FROM storage_write_matrix m ORDER BY m.bucket_id;

-- Even the authorized uploading GM cannot change stored evidence metadata
-- in place. RLS UPDATE without a policy returns zero rows rather than success.
WITH changed AS (
 UPDATE storage.objects SET metadata='{"mimetype":"application/octet-stream","overwrite":true}'::jsonb
 WHERE bucket_id='driver-photos' AND name='00000000-0000-0000-0000-000000000001/078-driver-photos-valid.jpg' RETURNING id
) SELECT is(count(*)::integer,0,'authorized driver photo uploader cannot overwrite existing object') FROM changed;
WITH changed AS (
 UPDATE storage.objects SET metadata='{"mimetype":"application/octet-stream","overwrite":true}'::jsonb
 WHERE bucket_id='driver-documents' AND name='00000000-0000-0000-0000-000000000001/078-driver-documents-valid.pdf' RETURNING id
) SELECT is(count(*)::integer,0,'authorized driver document uploader cannot overwrite existing object') FROM changed;
SELECT is(
 (SELECT metadata FROM storage.objects WHERE bucket_id=m.bucket_id AND name='00000000-0000-0000-0000-000000000001/078-'||m.bucket_id||'-valid.'||m.extension),
 jsonb_build_object('mimetype',m.mime_type),format('%s retains original stored object metadata',m.bucket_id)
) FROM storage_write_matrix m WHERE bucket_id IN('driver-photos','driver-documents') ORDER BY bucket_id;

-- A valid own-tenant prefix cannot replace the required permission.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000002"}',
  true
);
SELECT throws_ok(
  format(
    'INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (%L, %L, %L::jsonb)',
    m.bucket_id,
    '00000000-0000-0000-0000-000000000002/078-' || m.bucket_id ||
      '-insufficient.' || m.extension,
    jsonb_build_object('mimetype', m.mime_type)::text
  ),
  '42501', NULL,
  format('insufficient role cannot insert into %s', m.bucket_id)
)
FROM storage_write_matrix m ORDER BY m.bucket_id;

-- A fully authorized role still cannot write a foreign tenant prefix.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT throws_ok(
  format(
    'INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (%L, %L, %L::jsonb)',
    m.bucket_id,
    '00000000-0000-0000-0000-000000000002/078-' || m.bucket_id ||
      '-foreign.' || m.extension,
    jsonb_build_object('mimetype', m.mime_type)::text
  ),
  '42501', NULL,
  format('foreign tenant prefix is rejected in %s', m.bucket_id)
)
FROM storage_write_matrix m ORDER BY m.bucket_id;

SELECT throws_ok(
  format(
    'INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (%L, %L, %L::jsonb)',
    m.bucket_id,
    '00000000-0000-0000-0000-000000000001/../078-' || m.bucket_id ||
      '-traversal.' || m.extension,
    jsonb_build_object('mimetype', m.mime_type)::text
  ),
  '42501', NULL,
  format('path traversal is rejected in %s', m.bucket_id)
)
FROM storage_write_matrix m ORDER BY m.bucket_id;

-- Seed read-only bucket objects through the trusted service boundary.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO storage.objects (bucket_id, name, metadata)
SELECT m.bucket_id, name, '{"mimetype":"application/pdf"}'::jsonb
FROM storage_read_matrix m
CROSS JOIN LATERAL (
  VALUES
    ('00000000-0000-0000-0000-000000000001/078-own.pdf'),
    ('00000000-0000-0000-0000-000000000002/078-foreign.pdf'),
    ('00000000-0000-0000-0000-000000000001/../078-traversal.pdf')
) paths(name);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects o
   WHERE o.bucket_id = m.bucket_id
     AND o.name = '00000000-0000-0000-0000-000000000001/078-own.pdf'),
  1,
  format('authorized role reads own-tenant %s object', m.bucket_id)
)
FROM storage_read_matrix m ORDER BY m.bucket_id;

SELECT is(
  (SELECT count(*)::integer FROM storage.objects o
   WHERE o.bucket_id = m.bucket_id
     AND o.name = '00000000-0000-0000-0000-000000000002/078-foreign.pdf'),
  0,
  format('foreign tenant object is hidden in %s', m.bucket_id)
)
FROM storage_read_matrix m ORDER BY m.bucket_id;

SELECT is(
  (SELECT count(*)::integer FROM storage.objects o
   WHERE o.bucket_id = m.bucket_id
     AND o.name = '00000000-0000-0000-0000-000000000001/../078-traversal.pdf'),
  0,
  format('traversal-shaped object is hidden in %s', m.bucket_id)
)
FROM storage_read_matrix m ORDER BY m.bucket_id;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000002"}',
  true
);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects o
   WHERE o.bucket_id = m.bucket_id
     AND o.name = '00000000-0000-0000-0000-000000000002/078-foreign.pdf'),
  0,
  format('insufficient role cannot read own-tenant %s object', m.bucket_id)
)
FROM storage_read_matrix m ORDER BY m.bucket_id;

-- import-files is intentionally service-only until an import permission exists.
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(*)::integer FROM pg_policies p
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
     AND 'authenticated' = ANY(p.roles)
     AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
         LIKE '%import-files%'),
  0,
  'import-files has no authenticated policy'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES ('import-files', '078/service.csv',
            '{"mimetype":"text/csv"}'::jsonb)$$,
  'service role may insert into import-files'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES ('import-files',
            '00000000-0000-0000-0000-000000000001/078/user.csv',
            '{"mimetype":"text/csv"}'::jsonb)$$,
  '42501', NULL,
  'even a general manager cannot insert into service-only import-files'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND p.policyname = 'anon_insert_driver_drafts'
      AND p.cmd = 'INSERT'
      AND 'anon' = ANY(p.roles)
      AND p.with_check LIKE '%drafts/%'
      AND p.with_check LIKE '%array_length%'
  ),
  'driver-applications requires signed uploads instead of anonymous writes'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND p.policyname = 'storage_read_public_assets'
      AND p.cmd = 'SELECT'
      AND 'public' = ANY(p.roles)
  ),
  'company-assets retains its intentional public read policy'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND p.policyname IN (
        'storage_read_own_tenant', 'storage_insert_own_tenant',
        'storage_read_invoice_docs', 'storage_insert_invoice_docs',
        'storage_update_invoice_docs', 'storage_delete_invoice_docs'
      )
  ),
  'legacy broad Storage policies are absent'
);

-- Account state is enforced by Storage, not merely by page middleware.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = now() + interval '1 hour'
WHERE auth_user_id = '00000000-0000-0000-0000-000000000001';

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES ('driver-documents',
            '00000000-0000-0000-0000-000000000001/078-locked.pdf',
            '{"mimetype":"application/pdf"}'::jsonb)$$,
  '42501', NULL,
  'locked user with a valid JWT cannot write Storage'
);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects
   WHERE bucket_id = 'generated-reports'
     AND name = '00000000-0000-0000-0000-000000000001/078-own.pdf'),
  0,
  'locked user with a valid JWT sees zero Storage rows'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = NULL
WHERE auth_user_id = '00000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::integer FROM pg_policies p
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
     AND 'authenticated' = ANY(p.roles)
     AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
         NOT LIKE '%storage_path_in_current_tenant%'),
  0,
  'every authenticated Storage policy uses the active tenant path helper'
);

SELECT * FROM finish();
ROLLBACK;
