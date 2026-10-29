-- ============================================================================
-- Driver Photo Workflow — persistence + audit trail tests (pgTAP)
-- (067_driver_photo_tests.sql)
--
-- Proves the DB-level guarantees behind the driver photo workflow:
--
--   1. driver-photos storage bucket exists, is PRIVATE, and enforces the
--      5 MiB limit the UI advertises (bucket limit + allowed MIME types)
--   2. Storage SELECT/INSERT policies enforce tenant paths and permissions;
--      UPDATE is absent so replacements cannot overwrite evidence bytes.
--   3. drivers.photo_url exists and direct authenticated driver UPDATE is
--      revoked; source/derived state/audit now use mutate_driver_evidence.
--   4. Ordinary users cannot forge audit rows; trusted backend writers may
--      retain a source event, whose non-sensitive event ID remains readable.
--      Full atomic photo workflow regressions are in suite144.
--
-- Conventions (match 061/063): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
-- idempotent fixed-id fixtures (a failed run COMMITS at EOF and can leak —
-- every insert is guarded so a re-run is a clean no-op). plan(13) equals the
-- actual assertion count.
-- ============================================================================

BEGIN;

SELECT plan(13);

-- ─── Fixtures (idempotent, fixed ids; mirrors 061 discipline) ───────────────

CREATE TEMP TABLE photo_fixture (
  tenant_id uuid,
  driver_id uuid,
  auth_id   uuid,
  user_id   uuid
);

DO $$
DECLARE
  v_t   uuid := '12700000-0000-0000-0000-000000000000';
  v_d   uuid := '12700000-0000-0000-0000-000000000001';
  v_aid uuid := '12700000-0000-0000-0000-000000000002';
  v_u   uuid := '12700000-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t, 'مستأجر اختبار الصور', 'Photo Fixture Tenant')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.drivers (id, tenant_id, full_name_ar, primary_mobile, category)
  VALUES (v_d, v_t, 'سائق الصور', '0570000000', 'freelancer')
  ON CONFLICT (id) DO NOTHING;

  -- users row required by get_my_tenant_id() / auth_user_id FK conventions.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'photo-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status, must_change_password)
  VALUES (v_u, v_aid, v_t, 'photo-fixture@test.local', 'general_manager', 'active', false)
  ON CONFLICT (id) DO UPDATE SET role = 'general_manager', status = 'active', must_change_password = false;

  -- NOTE: no leak-purge for audit_log here — it is immutable (ADR-007), so a
  -- half-committed prior run can leave extra photo rows. The read-back
  -- assertion below therefore uses >= 1 (row exists and is visible), not = 1.

  INSERT INTO photo_fixture (tenant_id, driver_id, auth_id, user_id)
  VALUES (v_t, v_d, v_aid, v_u);
END;
$$;

-- ─── 1. Storage bucket: private, 5 MiB, image-only MIME (4) ────────────────

SELECT is(
  (SELECT (not b.public)::int
   FROM storage.buckets b WHERE b.name = 'driver-photos'),
  1,
  'driver-photos bucket is private (signed-URL delivery)'
);

SELECT is(
  (SELECT b.file_size_limit::int
   FROM storage.buckets b WHERE b.name = 'driver-photos'),
  5 * 1024 * 1024,
  'driver-photos bucket enforces the 5 MiB limit the UI advertises'
);

SELECT ok(
  (SELECT array_to_string(b.allowed_mime_types, ',') NOT LIKE '%svg%'
     AND b.allowed_mime_types IS NOT NULL
   FROM storage.buckets b WHERE b.name = 'driver-photos'),
  'driver-photos allowed_mime_types set and excludes SVG'
);

SELECT ok(
  (SELECT 'image/jpeg' = ANY (b.allowed_mime_types)
   FROM storage.buckets b WHERE b.name = 'driver-photos'),
  'driver-photos accepts image/jpeg'
);

-- ─── 2. Storage RLS shape (3) ───────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename  = 'objects'
     AND cmd IN ('SELECT', 'INSERT')
     AND (qual LIKE '%driver-photos%' OR with_check LIKE '%driver-photos%')
     AND (qual LIKE '%storage_path_in_current_tenant%'
          OR with_check LIKE '%storage_path_in_current_tenant%')
     AND (qual LIKE '%user_has_permission%'
          OR with_check LIKE '%user_has_permission%')),
  2,
  'driver-photos SELECT+INSERT policies enforce active tenant paths and driver permissions'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename  = 'objects'
     AND cmd = 'UPDATE'
     AND (qual LIKE '%driver-photos%' OR with_check LIKE '%driver-photos%')),
  0,
  'driver-photos has no in-place UPDATE policy; replacements require fresh objects'
);

SELECT is(
  (SELECT (b.public = false
           AND EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname = 'storage'
                         AND p.tablename  = 'objects'
                         AND p.cmd = 'SELECT'
                         AND (p.qual LIKE '%driver-photos%')))::int
   FROM storage.buckets b WHERE b.name = 'driver-photos'),
  1,
  'private bucket with an explicit SELECT policy (no public access path)'
);

-- ─── 3. drivers.photo_url + tenant-checked UPDATE policy (2) ───────────────

SELECT has_column('public', 'drivers', 'photo_url', 'drivers.photo_url exists');

SELECT ok(
  NOT has_table_privilege('authenticated','public.drivers','UPDATE')
  AND has_function_privilege('authenticated','public.mutate_driver_evidence(text,uuid,integer,jsonb,uuid,integer)','EXECUTE'),
  'photo persistence is caller-bound through the reviewed evidence RPC'
);

-- ─── 4. audit_log INSERT policy (2) ─────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'audit_log'
     AND policyname = 'audit_log_insert_own_actor'
     AND cmd = 'INSERT'),
  0,
  'authenticated audit_log INSERT policy is removed'
);

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
      '{"sub": "12700000-0000-0000-0000-000000000002", "role":"authenticated","aal":"aal2"}', true);
    INSERT INTO public.audit_log (tenant_id, actor_id, module, action)
    VALUES ('12700000-0000-0000-0000-000000000000',
            '99999999-9999-9999-9999-999999999999', 'drivers', 'photo_updated')$$,
  '42501', NULL,
  'ordinary users cannot forge audit rows because direct INSERT is denied'
);

-- ─── 5. BEHAVIORAL: photo audit trail round-trip + immutability (2) ────────

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT lives_ok(
  $$INSERT INTO public.audit_log
      (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
    VALUES ('12700000-0000-0000-0000-000000000000',
            '12700000-0000-0000-0000-000000000002',
            'drivers', 'driver', '12700000-0000-0000-0000-000000000001',
            'photo_updated',
            jsonb_build_object('photo_url',
              '12700000-0000-0000-0000-000000000000/12700000-0000-0000-0000-000000000001/photo-1759000000-test.jpg'))$$,
  'service-role audit writer can insert a photo audit row'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "12700000-0000-0000-0000-000000000002", "role":"authenticated","aal":"aal2"}', true);

SELECT ok(
  (SELECT count(*)::int FROM public.audit_log
   WHERE module = 'drivers' AND action = 'photo_updated'
     AND entity_id = '12700000-0000-0000-0000-000000000001'::uuid) >= 1,
  'photo event identifier remains readable for same-tenant history verification'
);

RESET ROLE;
SET LOCAL ROLE postgres;

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

SELECT * FROM finish();

ROLLBACK;
