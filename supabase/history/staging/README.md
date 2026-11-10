# Historical staging migration provenance

This archive preserves the eight staging-specific versions observed in project `viowrovartosrkqukjxy`. The SQL is copied from the exact PR #68 head recorded in the manifest, with normalized SHA-256 checksums. It is historical evidence, not the current schema.

Only `supabase/migrations/` is executable migration input. Do not copy this archive into that directory, replay it on production or staging, or change remote migration history to match it. Later reviewed migrations already supply the canonical application schema.

Run `node scripts/verify-staging-history.mjs` to check archive integrity. This check is offline and does not connect to any database.
