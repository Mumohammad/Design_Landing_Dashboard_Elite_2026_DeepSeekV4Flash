# Audit-Trail Module (Prompt D)

Makes the existing `audit_log` rows visible and explorable: the `/audit-log` stub becomes a full read-only explorer — server-side filtered list (Hijri dual timestamps, actor names, module badges, action labels, collapsed-by-default JSON metadata with PDPL masking), actor/action/module/entity-type/entity-id filters, CSV export of the filtered page, per-entity drill-down, loading/error/empty states.

> **Archived-v1, superseded:** #39 (audit-trail). Its intent is mined (make the audit rows explorable), none of its code is cherry-picked.

**Read-only module — no write paths.** Nothing in this PR inserts, updates, or deletes any table. The only `INSERT`-shaped code in the module's dependency graph is the pre-existing `writeAuditLog()` used by *other* modules; the audit surface itself performs zero writes. `audit_log`'s append-only contract is strengthened here (grant-layer hardening below).

---

## Part 1 — Surface (`/audit-log`, upgraded in place)

The existing `/audit-log` stub (unfiltered client page over `fetchAuditLog()`, limit 200, no server-side filters) is replaced. Left-nav entries (`app-sidebar.tsx`, `command-search.tsx`) already point at `/audit-log`, so no nav change is needed — the stub is upgraded where the shell expects it.

### Route/use-case coverage table (live DB facts per row)

| Route / use-case | Reads (tables / functions) | Writes | Handlers / notes |
| --- | --- | --- | --- |
| `/audit-log` — list (newest-first) | `audit_log` via `fetch_audit_trail_page()` RPC (id, created_at, module, action, entity_type, entity_id, actor_id, ip_address, reason, old_values, new_values) — tenant-scoped, `ORDER BY created_at DESC`, `LIMIT` clamped server-side | **none** | `fetchAuditTrailPage()` (`src/lib/audit-trail/queries.ts`) — admin client behind `requirePermission("audit_log","read")` (GM bypasses per `can()`); tenant from `getCurrentUser()` |
| `/audit-log` — filters (date range, actor, action, module, entity type, free-text entity id) | applied **server-side** inside the RPC (`p_from/p_to/p_actor_user_id/p_action/p_module/p_entity_type/p_entity_id`) | **none** | Filter state re-fetches the capped page (deferred-load effect per repo pattern); entity-id free text is validated as UUID server- and client-side before use |
| `/audit-log` — CSV export of the filtered set | client-side over the fetched rows (≤ cap) | **none** | `auditToCsv()` (RFC-4180 escaping, UTF-8 BOM — users-module pattern); metadata column is the masked payload, actor shown by name; `PDPL` column records `granted`/`masked` per row |
| `/audit-log` — per-entity drill-down | re-reads `audit_log` through the same RPC with `entity_type` + `entity_id` pinned | **none** | Row action + row click → `/audit-log?entityType=…&entityId=…`; the page opens pre-filtered on that entity's full history |
| `/audit-log` — actor picker + names | `users` (id, auth_user_id, full_name_ar/en, email; `deleted_at IS NULL`, tenant-scoped) | **none** | `actor_id` (auth.users UUID) resolves to display names; picker lists actors who can audit in the tenant |
| `/audit-log` — PDPL masking of metadata | `user_consents` via `has_user_pdpl_consent()` RPC (batched, one call per distinct actor on the page) | **none** | `maskAuditMetadata()` masks sensitive payload keys (`iqama|passport|license|iban|salary|mobile|phone|email|password|secret|otp|token|two_factor|national_address|date_of_birth`, substring match) when the actor's consent is absent; applied before render AND before export |
| `/audit-log` — KPI chips | computed from the fetched page only (events, distinct actors, distinct entities, system actions) | **none** | No fabricated values — page-scoped live facts, matching the drivers/users chip precedent |
| Loading / empty / error | — | — | `EnterpriseModulePage` skeleton rows; empty state "لا توجد أحداث تدقيق مطابقة لهذه الفلاتر" / "No audit events match these filters" (no-results vs no-events variants); `loading.tsx` + `error.tsx` (no SQL internals, digest ref only); load-failure banner |

### Explicitly deferred (prior decision)

- **Keyset pagination** — hard caps (50 default / 100 max, clamped in SQL) bound every response; keyset/offset-free paging is deferred. `fetchAuditLog()`'s old 200-row cap is superseded by the capped RPC.
- **Realtime subscriptions** — manual Refresh button + filter-driven re-fetch only, consistent with repo patterns.
- **Retention/archival** — backlog (see bottom).

## Part 2 — Migration + pgTAP

**Migration (this PR):** `20260924140000_audit_trail_surface.sql` — idempotent, forward-only.

1. **Index re-assertion** (`IF NOT EXISTS`): all four list/filter indexes from 007 — `(tenant_id, created_at DESC)`, `(actor_id, created_at DESC) WHERE actor_id IS NOT NULL`, `(entity_type, entity_id) WHERE entity_id IS NOT NULL`, `(tenant_id, module, action)` — drift-proofing the surface's query paths (007's own statements are not `IF NOT EXISTS`).
2. **Grant-layer append-only hardening (live-DB finding):** recon against a fresh stack showed `anon`/`authenticated` still held `UPDATE, DELETE, TRUNCATE` on `audit_log` (default Supabase privileges, never tightened like migration 058 did for `users`). **`TRUNCATE` bypasses both RLS and the 009 immutability row-trigger** — now revoked; both roles keep SELECT only. `service_role` write breadth for `writeAuditLog()` is untouched.
3. **`fetch_audit_trail_page()`** — SECURITY DEFINER, `STABLE`, pinned `search_path=public`, EXECUTE revoked from PUBLIC/anon and granted to `authenticated, service_role`. Applies every surface filter server-side with the hard cap (`LEAST(GREATEST(…), 100)`) in SQL. Tenant arg is always supplied by the server layer from `getCurrentUser()`.
4. **`has_user_pdpl_consent()` repair (in-scope dependency):** the audit surface's masking gate is this exact RPC. Its `created_at DESC, id DESC` latest-version tiebreak is **nondeterministic whenever timestamps tie** — `id` is a random UUID. This is not theoretical: any pgTAP `--single-transaction` run fixes `now()` at transaction start, so 061's "newest unaccepted version closes the gate" test flipped with coin-toss probability (observed failing on this branch's first fresh rebuild; it had passed during #50's run). Tiebreak is now `created_at DESC, version DESC` (monotonic strings; rows remain distinguishable via id — no unique-timestamp assumption added). SECURITY DEFINER / STABLE / pinned search_path / grants preserved; `DEFAULT 'terms'` signature preserved.

**Fresh-rebuild proof** (`supabase db reset` → `CREATE EXTENSION pgtap` → every suite with `-tA --single-transaction`):

```
PASS 010_full_rls_test_suite.sql      — 109/109
PASS 011_track1_rpc_grants_tests.sql  —  25/25
PASS 012_drivers_module_tests.sql     —  41/41
PASS 013_sensitive_tables_rls_tests.sql — 24/24
PASS 058_rls_security_tests.sql       —   1/1
PASS 060_behavioral_rls_tests.sql     —  10/10
PASS 061_users_module_tests.sql       —  28/28
PASS 062_audit_trail_tests.sql        —  25/25   ← NEW
────────────────────────────────────────────────
pgTAP Results: 263/263 passed, 0 failed  (plan counts proven, zero `not ok`, zero psql ERROR lines)
```

**Suite `062_audit_trail_tests.sql` (25 tests)** proves: table + RLS enabled + exactly 1 SELECT policy + zero UPDATE/DELETE policies; all 4 indexes present; **anon+authenticated hold no UPDATE/DELETE/TRUNCATE privilege**; RPC is SECURITY DEFINER with pinned search_path, anon denied, authenticated + service_role granted; behavioral: hard cap clamps 500→100, tenant isolation (definer still never crosses tenants), newest-first ordering, reason projection from `new_values->>'reason'`, action/entity-type+id/actor/date-range filters; **append-only enforcement: authenticated UPDATE / DELETE / TRUNCATE / INSERT all fail (42501)** and the 009 trigger still blocks privileged UPDATE (P0001); anon sees 0 rows; an authenticated user sees only their tenant's rows.

## Part 3 — Saudi compliance / PDPL

- **PDPL masking:** audit payloads embed personal data written by other modules (e.g. `drivers.created` carries `primary_mobile`, `iqama_number`; `users.created` carries the invited email). `maskAuditMetadata()` mirrors the drivers/users consent gate: sensitive keys masked when the actor's `has_user_pdpl_consent('terms')` is absent — applied before DOM render **and** before CSV export; the CSV `PDPL` column records the per-row state. Consent resolution is batched (one RPC per distinct actor on the page) and fails closed (RPC error ⇒ masked).
- **Hijri dual dates:** `formatDualDate()` from `src/lib/formatting/hijri.ts` on every timestamp (Gregorian + Umm al-Qura side by side, AR/EN aware).
- **Arabic copy parity:** every UI string is bilingual inline (filters, KPI chips, badges, action labels, empty states, errors) — matches the users-module inline-string convention.
- **AIDesigner lock:** `EnterpriseModulePage` shell, `rounded-2xl` glassmorphic toolbar, KPI chips, module badge dots in brand palette, `dir="ltr"` on UUIDs/JSON/emails — no new tokens, no keyframe inventions.

### Anti-goal sweep

```
grep -rin 'mock\|TODO\|FIXME\|lorem' \
  src/lib/audit-trail "src/app/(dashboard)/audit-log" \
  supabase/migrations/20260924140000_audit_trail_surface.sql \
  supabase/tests/062_audit_trail_tests.sql
→ 0 hits (exit 1). No mock data, TODOs, FIXMEs, or lorem anywhere in the
  module. (HTML `placeholder=` attrs — the drivers/users precedent — are not
  even present here.)
```

## Agent worklog entry (chat context only — not committed)

```
## 2026-09-24 — Audit-Trail Module (Prompt D) — v4-flash
Branch: feat/audit-trail-module (off master dc7815a8). Supersedes archived-v1 #39.
Shipped: /audit-log upgraded from stub to full read-only explorer (server-filtered
capped list via new fetch_audit_trail_page RPC; Hijri dual timestamps; module badges;
actor names; collapsed-by-default metadata with PDPL masking; actor/action/module/
entity-type/entity-id filters; CSV export; per-entity drill-down; loading/error/empty).
DB: 20260924140000 (index re-assertion x4 IF NOT EXISTS; TRUNCATE/UPDATE/DELETE
revoked from anon+authenticated — live-DB finding, TRUNCATE bypasses RLS+trigger;
fetch_audit_trail_page SD/pinned/capped; has_user_pdpl_consent tiebreak repaired
id-DESC(random)→version-DESC — fixes 061's nondeterministic consent-gate test under
--single-transaction). Tests: 062_audit_trail_tests.sql 25/25.
Gates: lint 0 err (76 pre-existing warnings), tsc 0, vitest 431/431 (15 new),
build 0 (/audit-log ○), pgTAP 263/263 fresh rebuild.
Gotchas: pgTAP failures don't abort --single-transaction → fixtures committed →
subsequent runs hit unique-violation cascades (root error is the FIRST error line);
writeAuditLog actor_id = auth.users UUID but consent RPC + picker use custom users.id
(two id-spaces, join via users.auth_user_id); has_user_pdpl_consent carries
DEFAULT 'terms' — CREATE OR REPLACE must keep it or 42P13 on rebuild.
Deferred: keyset pagination, realtime, retention/archival (backlog below).
```

## How to verify in 60 seconds

1. `pnpm dlx supabase db reset` → `CREATE EXTENSION pgtap` → run `supabase/tests/062_audit_trail_tests.sql` → `1..25`, zero `not ok`.
2. Sign in as GM → **/audit-log**: 4 KPI chips, Hijri dual timestamps, module badges, collapsed "Metadata" toggles that expand to pretty JSON (masked when the actor lacks PDPL consent).
3. Set **Action = Status changed** → only `status_changed` rows remain; set **Module = Users** → badges all read "المستخدمون"; paste any row's entity id into **Entity ID** → that entity's history.
4. Click a row → URL becomes `/audit-log?entityType=…&entityId=…` and the list opens pre-filtered (per-entity drill-down).
5. **Export CSV** → file opens in Excel with Arabic intact (BOM), metadata column masked where consent is absent.
6. As anon (incognito): the page's data fetch returns nothing — and `psql` confirms `SELECT has_table_privilege('anon','audit_log','TRUNCATE')` → `false`.

## Backlog (explicitly out of scope here)

- Retention/archival policies (e.g. partition by month + detach-and-dump after N months) and external log shipping.
- Realtime subscriptions for live tailing.
- Keyset pagination once tenants routinely exceed the cap window.

## References

- `docs/phase-2-schema-plan.md` §6.5 (audit_log, ADR-007), §7.1/10 (RLS), §8.3 (immutability trigger)
- `docs/phase-2-auth-plan.md` §7 (authorization boundary), §9 (audit writes)
- Drivers/users precedent: #48/#49/#50 (`writeAuditLog` payload anatomy, masking gate, CSV, module shell)
- `PR-BODY-users-module.md` — surface/PR conventions followed
