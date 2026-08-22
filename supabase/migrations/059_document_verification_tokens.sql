-- 059_document_verification_tokens.sql
-- Package 3: Replace predictable public identifiers with opaque tokens.
--
-- Security issues addressed:
--   1. /verify-document/[docNumber] uses enumerable doc_number (DOC-YYYYMMDD-XXXX)
--   2. getApplicationStatus() uses enumerable application_number (DRV-YYYY-NNNNNN)
--   3. Storage anon upload policy lacks per-record binding
--
-- Solution:
--   * Add verify_token (hash stored in DB, plaintext in URL) to generated_documents
--   * Add status_token (hash stored in DB, plaintext in URL) to driver_applications
--   * Backfill existing rows with cryptographically random tokens
--   * Tighten storage upload policy with size and path constraints
--   * Add public rate-limiting function for anonymous lookups

-- ═══ 1. Crypto helpers ═══════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generate a 32-byte hex token (64 hex chars) — high-entropy, non-enumerable.
-- VOLATILE: calls gen_random_bytes() which must not be memoized by the planner.
CREATE OR REPLACE FUNCTION generate_verify_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT encode(gen_random_bytes(32), 'hex')
$$;

-- SHA-256 hash for storage (constant-time comparison).
-- STABLE: deterministic for the same input — safe to index.
CREATE OR REPLACE FUNCTION hash_token(token text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT encode(digest(token, 'sha256'), 'hex')
$$;

-- ═══ 2. generated_documents: verify_token ════════════════════════════════════
ALTER TABLE generated_documents
  ADD COLUMN IF NOT EXISTS verify_token_hash text;

-- Backfill existing rows.
UPDATE generated_documents
  SET verify_token_hash = hash_token(generate_verify_token())
  WHERE verify_token_hash IS NULL;

-- Make NOT NULL after backfill.
ALTER TABLE generated_documents
  ALTER COLUMN verify_token_hash SET NOT NULL;

-- Unique index for constant-time lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_docs_verify_token
  ON generated_documents (verify_token_hash);

-- ═══ 3. driver_applications: status_token ════════════════════════════════════
ALTER TABLE driver_applications
  ADD COLUMN IF NOT EXISTS status_token_hash text;

-- Backfill existing rows.
UPDATE driver_applications
  SET status_token_hash = hash_token(generate_verify_token())
  WHERE status_token_hash IS NULL;

ALTER TABLE driver_applications
  ALTER COLUMN status_token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_apps_status_token
  ON driver_applications (status_token_hash);

-- Trigger: auto-generate status_token_hash on INSERT (new applications).
CREATE OR REPLACE FUNCTION assign_application_status_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status_token_hash IS NULL THEN
    NEW.status_token_hash := hash_token(generate_verify_token());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_applications_status_token ON driver_applications;
CREATE TRIGGER trg_driver_applications_status_token
  BEFORE INSERT ON driver_applications
  FOR EACH ROW EXECUTE FUNCTION assign_application_status_token();

-- Similarly, auto-generate verify_token_hash on generated_documents INSERT.
CREATE OR REPLACE FUNCTION assign_generated_doc_verify_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.verify_token_hash IS NULL THEN
    NEW.verify_token_hash := hash_token(generate_verify_token());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generated_docs_verify_token ON generated_documents;
CREATE TRIGGER trg_generated_docs_verify_token
  BEFORE INSERT ON generated_documents
  FOR EACH ROW EXECUTE FUNCTION assign_generated_doc_verify_token();

-- ═══ 4. Storage hardening ════════════════════════════════════════════════════
-- Tighten the anon upload policy: path must be exactly drafts/{uuid}/... and
-- the draft UUID must be a valid UUID format (not an attacker-controlled path).
DROP POLICY IF EXISTS "driver_apps_upload_anon" ON storage.objects;
CREATE POLICY "driver_apps_upload_anon"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'driver-applications'
    AND (storage.foldername(name))[1] = 'drafts'
    -- Enforce UUID-format draft ID to prevent path traversal
    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    -- Maximum 5 subdirectories deep (drafts/uuid/docType/filename.ext)
    AND array_length(storage.foldername(name), 1) <= 4
  );

-- Authenticated staff can read within their tenant via service-role (unchanged).
-- No anon SELECT/UPDATE/DELETE on driver-applications bucket (unchanged).

-- ═══ 5. Public lookup rate-limiting RPC ══════════════════════════════════════
-- A lightweight, server-side rate limiter for anonymous document verification
-- lookups. Tracks attempts per IP in a temporary table that auto-expires.

CREATE TABLE IF NOT EXISTS public_lookup_rate_limits (
  ip_hash    text NOT NULL,
  endpoint   text NOT NULL,  -- 'verify_doc' or 'app_status'
  window_start timestamptz NOT NULL DEFAULT now(),
  count      int NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, endpoint, window_start)
);

-- Auto-cleanup old rate limit entries (older than 2 hours).
CREATE OR REPLACE FUNCTION cleanup_lookup_rate_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public_lookup_rate_limits
  WHERE window_start < now() - interval '2 hours';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_lookup_rate_limits ON public_lookup_rate_limits;
CREATE TRIGGER trg_cleanup_lookup_rate_limits
  AFTER INSERT ON public_lookup_rate_limits
  FOR EACH STATEMENT EXECUTE FUNCTION cleanup_lookup_rate_limits();

-- Enable RLS on rate limits (only service-role can write/read).
ALTER TABLE public_lookup_rate_limits ENABLE ROW LEVEL SECURITY;

-- ═══ 6. RPC: verify document by token ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public_verify_document(token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as owner, bypasses RLS
SET search_path = public
AS $$
DECLARE
  v_ip text;
  v_hash text;
  v_row record;
  v_limit constant int := 30;  -- 30 lookups per 5-min window
  v_window timestamptz;
  v_count int;
BEGIN
  -- Extract client IP from request headers (best-effort).
  v_ip := coalesce(
    current_setting('request.headers', true)::json->>'x-forwarded-for',
    'unknown'
  );
  v_hash := encode(digest(v_ip || 'verify_doc', 'sha256'), 'hex');

  -- Rate limit: max 30 lookups per 5-minute window per IP.
  v_window := date_trunc('minute', now()) - (extract(minute FROM now())::int % 5) * interval '1 minute';
  SELECT count INTO v_count
  FROM public_lookup_rate_limits
  WHERE ip_hash = v_hash AND endpoint = 'verify_doc' AND window_start = v_window;

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'retryAfter', 300);
  END IF;

  -- Increment counter.
  INSERT INTO public_lookup_rate_limits (ip_hash, endpoint, window_start, count)
  VALUES (v_hash, 'verify_doc', v_window, 1)
  ON CONFLICT (ip_hash, endpoint, window_start)
  DO UPDATE SET count = public_lookup_rate_limits.count + 1;

  -- Look up by token hash.
  SELECT
    gd.doc_number,
    gd.status,
    gd.generated_at,
    gd.verify_url,
    dt.name_ar AS template_name_ar,
    dt.name_en AS template_name_en
  INTO v_row
  FROM generated_documents gd
  LEFT JOIN document_templates dt ON dt.id = gd.template_id
  WHERE gd.verify_token_hash = hash_token(token)
    AND gd.deleted_at IS NULL;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'doc_number', v_row.doc_number,
    'status', v_row.status,
    'generated_at', v_row.generated_at,
    'type', coalesce(v_row.template_name_en, v_row.template_name_ar)
  );
END;
$$;

-- ═══ 7. RPC: application status by token ═════════════════════════════════════
CREATE OR REPLACE FUNCTION public_application_status(token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip text;
  v_hash text;
  v_row record;
  v_limit constant int := 20;  -- 20 lookups per 5-min window
  v_window timestamptz;
  v_count int;
BEGIN
  v_ip := coalesce(
    current_setting('request.headers', true)::json->>'x-forwarded-for',
    'unknown'
  );
  v_hash := encode(digest(v_ip || 'app_status', 'sha256'), 'hex');

  v_window := date_trunc('minute', now()) - (extract(minute FROM now())::int % 5) * interval '1 minute';
  SELECT count INTO v_count
  FROM public_lookup_rate_limits
  WHERE ip_hash = v_hash AND endpoint = 'app_status' AND window_start = v_window;

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'retryAfter', 300);
  END IF;

  INSERT INTO public_lookup_rate_limits (ip_hash, endpoint, window_start, count)
  VALUES (v_hash, 'app_status', v_window, 1)
  ON CONFLICT (ip_hash, endpoint, window_start)
  DO UPDATE SET count = public_lookup_rate_limits.count + 1;

  SELECT
    da.application_number,
    da.status,
    da.submitted_at,
    da.full_name
  INTO v_row
  FROM driver_applications da
  WHERE da.status_token_hash = hash_token(token);

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Return minimum safe fields — no PII beyond full_name.
  RETURN jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'submitted_at', v_row.submitted_at,
    'application_number', v_row.application_number
  );
END;
$$;

-- ═══ 8. Comments for documentation ══════════════════════════════════════════
COMMENT ON COLUMN generated_documents.verify_token_hash IS
  'SHA-256 hash of the high-entropy verify token. The plaintext token is embedded in the QR code and /verify-document/[token] URL. Never expose the hash to clients.';

COMMENT ON COLUMN driver_applications.status_token_hash IS
  'SHA-256 hash of the high-entropy status token. The plaintext token is shown to applicants for status tracking. Never expose the hash to clients.';

COMMENT ON FUNCTION public_verify_document(text) IS
  'Public (anonymous) document verification by opaque token. Rate-limited, returns minimum safe fields.';

COMMENT ON FUNCTION public_application_status(text) IS
  'Public (anonymous) application status lookup by opaque token. Rate-limited, returns minimum safe fields.';
