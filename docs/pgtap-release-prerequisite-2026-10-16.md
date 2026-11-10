# Hosted pgTAP release prerequisite

Production had pgTAP installed in `public`, owned by `supabase_admin`. Its two helper views retained non-DML API grants that `postgres` could not revoke, so `20261010073050_rbac_completion` correctly rolled back. The preceding security migration had succeeded. The new app was built but not promoted.

`20261016161500_isolate_pgtap_extension` moves only pgTAP from `public` to `extensions`, using Supabase's supported privileged-extension administration. It does not drop objects, change owners, widen privileges, or write business data. It is a no-op if pgTAP is absent or already outside `public`.

For a hosted database blocked at `rbac_completion`, apply this operational prerequisite first, then resume the original pending migrations. Keep its canonical version in migration history; do not mark the failed RBAC migration as applied. On fresh databases normal chronological migration order remains valid because pgTAP is not installed in `public`.

Validation on staging `viowrovartosrkqukjxy`: within a rolled-back transaction, install pgTAP in `public`, run the exact relocation SQL, assert the extension and `tap_funky` view moved to `extensions`, and repeat the SQL to verify idempotence. All assertions passed; the temporary installation was rolled back. Existing full application and hosted CRUD/PDF checks passed on PR #74; this follow-up changes only database extension placement.

References: [Supabase pgTAP guidance](https://supabase.com/docs/guides/database/extensions/pgtap), [Supabase extension schema handling](https://github.com/supabase/supautils/blob/master/src/extensions.c).
