-- ============================================================================
-- Production incident sweep — bucket/app size convergence + drift guards
-- (068_production_sweep_tests.sql)
--
-- Proves the DB-level guarantees behind Prompt L fixes:
--
--   1. driver-photos bucket enforces the 5 MiB limit the app advertises
--      (converged by 20260930200000_production_sweep_fixes.sql), is
--      image-only (MIME pin from 20260929130000) and PRIVATE
--   2. drift guard: the converged value matches 011_storage_buckets.sql's
--      declared baseline for every bucket (no silent size drift)
--   3. audit_log INSERT policy from 20260929120000 remains in place
--      (ADR-007: own-tenant + own-actor inserts only, immutability intact)
--
-- Conventions (match 067): single transaction, idempotent assertions only —
-- no fixtures required (storage.buckets rows are created by 011).
-- plan(11) equals the actual assertion count.
-- ============================================================================

SELECT plan(11);

-- ─── 1. driver-photos: the converged contract ────────────────────────────────

SELECT is(
  (SELECT b.file_size_limit::int FROM storage.buckets b WHERE b.id = 'driver-photos'),
  5 * 1024 * 1024,
  'driver-photos bucket enforces 5 MiB — matches DRIVER_PHOTO_MAX_BYTES (prod drift converged)'
);

SELECT is(
  (SELECT b.public::int FROM storage.buckets b WHERE b.id = 'driver-photos'),
  0,
  'driver-photos bucket is PRIVATE'
);

SELECT ok(
  (SELECT b.allowed_mime_types IS NOT NULL
   FROM storage.buckets b WHERE b.id = 'driver-photos'),
  'driver-photos carries the image-only MIME pin (20260929130000)'
);

SELECT ok(
  (SELECT NOT ('image/svg+xml' = ANY (b.allowed_mime_types))
   FROM storage.buckets b WHERE b.id = 'driver-photos'),
  'driver-photos MIME pin still excludes SVG'
);

-- ─── 2. Drift guard: no other bucket silently changed size ──────────────────
-- Baseline from 011_storage_buckets.sql (declared single source of truth).

SELECT is(
  (SELECT b.file_size_limit::int FROM storage.buckets b WHERE b.id = 'driver-documents'),
  20 * 1024 * 1024,
  'driver-documents bucket still enforces 20 MiB'
);

SELECT is(
  (SELECT b.file_size_limit::int FROM storage.buckets b WHERE b.id = 'vehicle-photos'),
  10 * 1024 * 1024,
  'vehicle-photos bucket still enforces 10 MiB'
);

SELECT is(
  (SELECT b.file_size_limit::int FROM storage.buckets b WHERE b.id = 'vehicle-documents'),
  20 * 1024 * 1024,
  'vehicle-documents bucket still enforces 20 MiB'
);

SELECT is(
  (SELECT b.file_size_limit::int FROM storage.buckets b WHERE b.id = 'violation-evidence'),
  50 * 1024 * 1024,
  'violation-evidence bucket still enforces 50 MiB'
);

-- ─── 3. ADR-007 stays intact after the sweep ────────────────────────────────

SELECT ok(
  (SELECT count(*) = 1 FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'audit_log'
     AND policyname = 'audit_log_insert_own_actor'),
  'audit_log INSERT policy (own tenant + own actor) is present'
);

SELECT ok(
  (SELECT count(*) = 0 FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'audit_log'
     AND cmd IN ('UPDATE', 'DELETE')),
  'audit_log carries no UPDATE/DELETE policies (ADR-007 immutability)'
);

SELECT ok(
  (SELECT count(*) = 1 FROM pg_trigger
   WHERE tgrelid = 'public.audit_log'::regclass
     AND tgname = 'trg_audit_log_immutable'
     AND tgenabled <> 'D'),
  'audit_log immutability trigger is present and enabled'
);

SELECT * FROM finish();
