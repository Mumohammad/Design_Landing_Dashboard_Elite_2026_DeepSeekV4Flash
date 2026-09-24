# Users Module (Module 14) — primer

Real-data surfaces for `/users` (roster + detail), backed by the Phase-2
auth/RBAC schema (migrations 005/008/058) plus
`supabase/migrations/20260924120000_users_module_surface.sql`.

## Real-data seed

Gated + idempotent, same contract as the drivers seed:

```bash
SEED_ALLOW=true pnpm seed:users
```

- Refuses to run when `NODE_ENV=production` or `SEED_ALLOW != true`.
- Seeds 5 marked users (`ED-SEED-USERS-*` emails): active auditor + active
  supervisor, one `pending_invite`, one `locked`, one `inactive`.
- Creates the required `auth.users` rows via `admin.createUser`
  (`user_metadata._users_seed = true`).
- Issues fixed employee codes `ED-SEED-USERS-CODE-1..3` and leaves two users
  uncoded to exercise the assign-code action.
- Upserts `user_consents` (terms + privacy, version `2026.1`) for the two
  consented users; the other three exercise the PDPL masking path.

## Database support migration

`20260924120000_users_module_surface.sql`:

- `user_employee_code_seq` + `next_employee_code(uuid)` — sequence-driven
  `EDU-NNNNNN` codes (no COUNT(*)+1); sequence revoked, helper is
  SECURITY DEFINER with pinned `search_path`, `authenticated` + `service_role`
  EXECUTE only.
- `user_consents` — append-only PDPL consent ledger (no UPDATE/DELETE
  policies), UNIQUE `(tenant_id, user_id, consent_type, version)`.
- `has_user_pdpl_consent(uuid, text)` — masking gate that follows the user's
  LATEST consent version.

## pgTAP

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "CREATE EXTENSION IF NOT EXISTS pgtap;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA --single-transaction \
  -f supabase/tests/061_users_module_tests.sql
```

28 assertions — policy shape, gate behavior (latest-version semantics),
definer security, and code minting. Must print `1..28` and zero `not ok`.

## 60-second verification

1. `SEED_ALLOW=true pnpm seed:users` → 5 seeded users.
2. Sign in as GM → `/users`: KPI chips (total/active/pending/locked/2FA),
   status + role filters, search, CSV export.
3. Open a seeded user → detail shows Hijri dual dates, masked phone for the
   unconsented users, `ED-SEED-USERS-CODE-*` codes.
4. Row actions → "Set to: Locked" → confirm with a reason → toast + audit
   row (`users.status_changed`), status chip flips.
5. Detail → "Assign code" on an uncoded user → `EDU-0010xx` appears.
