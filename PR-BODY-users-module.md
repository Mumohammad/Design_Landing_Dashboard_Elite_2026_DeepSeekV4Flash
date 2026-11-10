# Users Module (§26) — Prompt C

Closes the Users-module build on the drivers-module precedent (#44–#49 surface + real-data seed, #48 audit remediation). Two commits: `chore(toolchain)` (Part 0) and `feat(users)` (Parts 1–3).

> **Archived-v1, superseded:** #37 (users stubs), #38 (Node 20 deploy config), #39 (audit-trail). This PR supersedes all three; nothing is cherry-picked from them.

> ⚠️ **Blueprint deviation note:** `elite-feature-docs/docs/users-module.md` (§1–§26), `docs/clients/elite-dashboard.md`, `MODULE_TEMPLATE.md`, `types_and_validation_schemas.md`, and `wiring_map.md` are **not present in this repository** (verified repo-wide + sibling dirs). Per maintainer decision, the module was built from the canonical Phase-2 references that *do* exist — `docs/phase-2-schema-plan.md` (§6.3 users, §6.6/6.7 RBAC, §7/8 triggers), `docs/elite-master-prompt-v2.md` (Module 14, AIDesigner lock, error taxonomy), migration history 005/008/058/060, and the shipped drivers module as the surface precedent. §-numbered rows below cite the Phase-2/master-prompt sections actually implemented. When the blueprint lands, diff it against `src/lib/users/` and `src/app/(dashboard)/users/` — the server layer is deliberately thin so route tables can be re-mapped without UI churn.

---

## Part 0 — Node 24 sync (`581b064`)

| File | Change |
| --- | --- |
| `.nvmrc` / `.node-version` | `22` → `24` (new `.node-version` for tooling that reads it) |
| `package.json` | `engines: { "node": ">=24", "pnpm": ">=10" }`; added `seed:users` script |
| `.github/workflows/ci.yml` | `setup-node` `node-version: 22` → `24` in all three jobs (ci / pgtap / e2e) |
| `vercel.json` | No `runtime`/`nodeVersion` field exists (buildCommand only) — Vercel reads `.nvmrc` |

**Human step (Anya):** verify the Vercel project **Settings → Runtime** shows Node 24 after this lands.

## Part 1 — Module build

### Route/use-case coverage table (live DB facts per row)

| Route / use-case | Reads (tables) | Writes (tables) | Handlers / actions |
| --- | --- | --- | --- |
| `/users` — roster + KPIs (§ Phase-2 6.3; Master v2 M14) | `users` (safe-field projection: id, employee_code, names, email, phone, role, status, two_factor_enabled, invited_at, last_login_at, created_at) | — | `fetchUsersPageData()` (`src/lib/users/queries.ts`) — admin client behind `requirePermission("users","read")`, tenant-scoped, `deleted_at IS NULL`, limit 200. KPIs computed from the same result set (total / active / pending_invite / locked+terminated / 2FA / Arabic-profile share) — no fabricated values |
| `/users` — filter/search/CSV | client-side over the fetched rows (roster ≤200; matches drivers list) | — | `filtered` memo + `usersToCsv()` (RFC-4180 escaping, UTF-8 BOM) |
| `/users` — invite user (create path) | `invites` (dup pending check), `roles` (assignment on accept) | `invites` INSERT, `audit_log` INSERT | Existing GM-only `createInvite()` (`src/lib/auth/invites.ts`) — hashed token, Resend email, `users.invite_created` audit. **No direct `users` INSERT exists by design** (058 removed authenticated provisioning; account creation = invite → `acceptInvite()`) |
| `/users` — status lifecycle (suspend/lock/reactivate/terminate) | `users` (id, status, role, tenant scope) | `users` UPDATE (status), `audit_log` INSERT | `updateUserStatus()` (`src/lib/users/actions.ts`) — `users:update` permission; guards: no self-edit, transition matrix `ALLOWED_STATUS_TRANSITIONS`, reason ≥5 chars (confirm-destructive dialog), GM-status parity with 058 AUTH005; audit `users.status_changed` with `{from,to,reason}` |
| `/users/[id]` — detail (profile/account/lifecycle) | `users` (18 safe fields, tenant-scoped `maybeSingle`), `user_consents` via RPC | — | `fetchUserDetail()` + `has_user_pdpl_consent()` RPC |
| `/users/[id]` — PDPL masking (Master v2 §PDPL-aware design) | `user_consents` (inside definer RPC) | — | `has_user_pdpl_consent(user,'terms')` (latest-version gate) → `maskSensitiveValue()` shows last-2 chars or `••••••`; mask explanation rendered while consent missing |
| `/users/[id]` — assign employee code (schema plan 6.3: sequence, never COUNT+1) | `users` (existing-code guard) | `users` UPDATE (employee_code), `audit_log` INSERT | `assignEmployeeCode()` → `next_employee_code(tenant)` RPC → `EDU-NNNNNN`; refuses when a code exists (sequence never rewound); audit `users.employee_code_assigned` |
| Loading/empty/error states | — | — | `EnterpriseModulePage` skeleton rows + empty states (no-results vs no-users variants); `[id]/loading.tsx` + `[id]/error.tsx`; list-level `loadFailed` banner |

**Not built (deliberate, documented):** roles CRUD surfaces — `roles`/`role_permissions` writes are service-role only by 058 and the role-permission matrix is seeded (013); role *changes* flow through invites. Duplicate-user has no meaning (auth.users one-to-one); deactivate = status transition.

### Anti-goal sweep

```
grep -ri 'mock\|TODO\|placeholder\|FIXME\|lorem' src/app/(dashboard)/users
→ 5 hits, all HTML `placeholder=` attributes on inputs/selects (localization
  hints), identical to the shipped drivers module. 0 mock data / TODO / FIXME
  / lorem. Mock template files (data-table.tsx, stat-cards.tsx, data.json)
  deleted in this PR.
```

## Part 2 — Saudi compliance

- **Hijri dual dates:** `formatDualDate()` from existing `src/lib/formatting/hijri.ts` on every date display in `/users/[id]` (last login, invited, accepted, created, updated) — Gregorian + Umm al-Qura Hijri side by side, AR/EN aware.
- **PDPL masking:** `has_user_pdpl_consent()` (users analogue of the drivers `has_pdpl_consent` gate) + `user_consents` append-only ledger (no UPDATE/DELETE policies, versioned, `accepted_at` + ip_hash-ready) — sensitive `phone` masked until the latest-version consent is accepted.
- **Status KPI chips:** roster KPIs (active / pending / locked+terminated / 2FA) as AIDesigner-status chips; Saudization-style share chip (Arabic-profile share of roster — same live-DB-fact approach as the drivers Saudization KPI).
- **AIDesigner lock:** `EnterpriseModulePage` shell, `rounded-2xl` glassmorphic containers, elite-blue gradient CTA, gradient avatar, `group-hover` row actions, bilingual AR/EN with `dir="ltr"` on emails/codes — no new tokens, no keyframe inventions.

## Part 3 — Real-data seed

`scripts/seed-users-test-data.mts` → `pnpm seed:users` (primer: `README.users-module.md`)

- Gated: refuses without `SEED_ALLOW=true`; refuses under `NODE_ENV=production`.
- Idempotent: keyed on email; fixed timestamps; `upsert ... ignoreDuplicates` on consents.
- `ED-SEED-USERS-*` markers: 5 users — active auditor + active supervisor (consented: terms+privacy v2), `pending_invite`, `locked`, `inactive` (unconsented → masking path). Fixed codes `ED-SEED-USERS-CODE-1..3`; two users left uncoded to exercise assign-code. Auth rows via `admin.createUser` with `_users_seed` metadata.
- **Not executed this session** (no linked-DB credentials available locally) — run `SEED_ALLOW=true pnpm seed:users` against the dev project to populate.

## Migrations + pgTAP results

**Migration list (this PR):** `20260924120000_users_module_surface.sql`
1. `user_employee_code_seq` + `next_employee_code(uuid)` — SECURITY DEFINER, pinned `search_path=public`, sequence revoked from PUBLIC/anon/authenticated/service_role, EXECUTE to authenticated+service_role
2. `user_consents` — append-only PDPL ledger, `UNIQUE (tenant_id,user_id,consent_type,version)`, RLS, tenant SELECT/INSERT via `get_my_tenant_id()`, **no UPDATE/DELETE policies**
3. `has_user_pdpl_consent(uuid,text)` — latest-version consent gate, SECURITY DEFINER, anon denied

**Fresh-rebuild proof** (`supabase db reset` → `CREATE EXTENSION pgtap` → all suites with `-tA --single-transaction`):

```
PASS 010_full_rls_test_suite.sql      — 109/109
PASS 011_track1_rpc_grants_tests.sql  —  25/25
PASS 012_drivers_module_tests.sql     —  41/41
PASS 013_sensitive_tables_rls_tests.sql — 24/24
PASS 058_rls_security_tests.sql       —   1/1
PASS 060_behavioral_rls_tests.sql     —  10/10
PASS 061_users_module_tests.sql       —  28/28   ← NEW
────────────────────────────────────────────────
pgTAP Results: 238/238 passed, 0 failed  (plan counts proven, zero `not ok`, zero psql ERROR lines)
```

New suite `061_users_module_tests.sql` proves: table+RLS shape, exactly 2 tenant policies + zero UPDATE/DELETE policies, `consent_type` CHECK, uniqueness, definer+pinned-search_path on both functions, anon/authenticated/service_role grants, behavioral gate semantics (false → accepted-2026.1 true → newest-unaccepted false) and `EDU-` monotonic minting. Fixture note: `auth.users` inserts carry `_invite_provisioned` (060 AUTH010 blocks direct signups); consent versions must outrank the seed.sql per-tenant v1 row.

**Other gates:** `pnpm lint` exit 0 (78 pre-existing warnings, 0 errors) · `tsc --noEmit` exit 0 · `vitest` 416/416 (15 new) · `pnpm build` exit 0 (`/users` ○, `/users/[id]` ƒ).

## How to verify in 60 seconds

1. `SEED_ALLOW=true pnpm seed:users` → 5 `ED-SEED-USERS-*` users (+2 consented).
2. Sign in as GM → **/users**: 6 KPI chips, status/role filters, search, CSV export.
3. Row ⋯ menu → "Set to: Locked" → dialog demands a reason (≥5 chars) → confirm → chip flips; audit row `users.status_changed`.
4. Open a seeded user → **/users/[id]**: Hijri dual dates, phone masked `••••••••67` for consented users / `••••••` for unconsented (PDPL note shown).
5. On an uncoded user → "Assign code" → `EDU-0010xx` appears; repeat attempt is refused (idempotency guard).
6. Local-only GM check: row actions on your own account → status changes refused with a readable error (058 parity).

## References

- `docs/elite-master-prompt-v2.md` — Module 14, AIDesigner UI lock, §5 standards (sequence refs, soft-delete index pattern, error taxonomy)
- `docs/phase-2-schema-plan.md` — §6.3 users, §6.6/6.7 RBAC, §7.3/8.2/8.3 triggers (blueprint stand-in, see deviation note)
- `docs/phase-2-auth-plan.md` — invite flow (§6), authorization boundary (§7)
- Drivers precedent: #41–#49 (surface/seed/audit pattern), `supabase/migrations/20260923120000_reconcile_drivers_module_drift.sql` §5 (PDPL gate pattern)
- `README.users-module.md` — seed + pgTAP + verify primer (in-repo)
