# Staging Preview registry

This data-only branch records public metadata for independently verified immutable staging Previews. It contains no application code or credentials and must never be merged into application branches.

The trusted release CI reads release/staging-previews.json using its existing contents-read permission. Entries must match the exact PR commit and approved Vercel project/team, release branch and staging Supabase backend. CI still performs its live health, exact-commit and exclusive-staging-CSP preflight before exporting the selected public URL or creating synthetic fixtures.

Publish an entry only after checking the READY deployment metadata and successful read-only preflight. Keep updates non-forced with the expected previous branch head. Never record secrets, signed URLs, credentials, business records or Production targets. The schema is bounded to 128 entries / 64 KiB; archive older metadata deliberately before those limits are reached.

Automatic Vercel deployments are disabled for this data-only branch by its own vercel.json. This configuration must not be copied into application branches.
