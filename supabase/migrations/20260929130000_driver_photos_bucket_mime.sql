-- ============================================================================
-- Driver photo workflow — enforce image-only MIME types at the storage layer
-- (20260929130000_driver_photos_bucket_mime.sql)
--
-- The driver-photos bucket was created (011) with allowed_mime_types NULL,
-- which storage treats as "allow any type". The app rejects SVG/PDF/etc. in
-- its upload surfaces and in updateDriverPhoto, but defense-in-depth belongs
-- in the bucket: this pins the bucket to the exact image list the shared
-- policy (src/lib/drivers/photo.ts) accepts — SVG deliberately excluded.
--
-- Mirrors the driver-applications bucket, which already carries a MIME list.
-- Idempotent: the UPDATE converges to the same row state on re-runs.
-- ============================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp'
]::text[]
WHERE id = 'driver-photos';
