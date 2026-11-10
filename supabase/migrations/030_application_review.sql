-- 030_application_review.sql
-- Admin review dashboard support for driver applications.
--
-- Adds review-tracking columns to driver_applications (who reviewed, when,
-- and an optional note) plus the missing updated_at trigger so status changes
-- bump updated_at automatically. The admin review UI writes these through the
-- service-role admin client; RLS is unchanged (staff already have tenant-scoped
-- SELECT via migration 029).

-- `reviewed_by` references the custom `users` table (not auth.users) because
-- the server actions store `getCurrentUser().id`, which is the users row id.
ALTER TABLE driver_applications
  ADD COLUMN IF NOT EXISTS reviewed_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note   TEXT;

-- Keep updated_at in sync on every status/column change.
DROP TRIGGER IF EXISTS trg_driver_applications_updated_at ON driver_applications;
CREATE TRIGGER trg_driver_applications_updated_at
  BEFORE UPDATE ON driver_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index for the review queue (status + submission order).
CREATE INDEX IF NOT EXISTS idx_driver_apps_review_queue
  ON driver_applications (tenant_id, status, created_at DESC);
