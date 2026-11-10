-- 001_extensions.sql
-- Both extensions are idempotent and safe to re-run.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
