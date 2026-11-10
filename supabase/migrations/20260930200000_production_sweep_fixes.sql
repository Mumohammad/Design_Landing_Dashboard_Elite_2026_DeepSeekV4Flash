-- ============================================================================
-- Production incident sweep — driver-photos bucket size convergence
-- (20260930200000_production_sweep_fixes.sql)
--
-- Root cause this fixes: the driver-photos bucket was created in
-- 011_storage_buckets.sql with file_size_limit = 5242880 (5 MiB), and the app
-- enforces the same limit in one shared constant (DRIVER_PHOTO_MAX_BYTES,
-- src/lib/drivers/photo.ts) checked on the client before upload, in the
-- updateDriverPhoto server action, and mirrored by pgTAP test 067.
--
-- Prod drifted: the live bucket was raised to 10485760 (10 MiB) via the
-- dashboard and never converged back. Result: the app rejects every photo
-- between 5 MiB and 10 MiB with "الصورة كبيرة جدًا (الحد الأقصى 5MB)" — the
-- "upload rejected" incident symptom — while the bucket would have accepted
-- the file.
--
-- Fix direction (owner default, per Prompt L): converge the BUCKET to the
-- app's 5 MiB policy. No app loosening; ADR-007, tenant isolation and RLS
-- coverage are untouched.
--
-- Idempotent: converges to the same row state on re-runs; the DO block only
-- raises when the bucket is missing entirely (a hard schema error).
-- ============================================================================

UPDATE storage.buckets
SET file_size_limit = 5242880
WHERE id = 'driver-photos';

-- The bucket must exist — its absence breaks every photo surface, not just
-- the size policy. Fail loudly in CI/staging if the baseline is broken.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'driver-photos'
  ) THEN
    RAISE EXCEPTION 'driver-photos bucket missing — run 011_storage_buckets.sql first';
  END IF;
END
$$;

-- Post-condition guard: bucket limit must equal the app constant (5 MiB).
DO $$
BEGIN
  IF (
    SELECT file_size_limit FROM storage.buckets WHERE id = 'driver-photos'
  ) IS DISTINCT FROM 5242880 THEN
    RAISE EXCEPTION 'driver-photos file_size_limit must be 5242880 (5 MiB) to match DRIVER_PHOTO_MAX_BYTES';
  END IF;
END
$$;
