# Prompt L — Production Incident Sweep: Photo Workflow + Broken Modules

Branch: `fix/production-incident-sweep` (from `master` @ `5c6cc70` = #58)

## Summary

Two production mechanisms pinned and fixed, plus two hardening gaps closed. Fixes are grouped by mechanism, not symptom — one fix per root cause.

| # | Symptom | Mechanism class | Root cause | Fix |
|---|---------|-----------------|------------|-----|
| 1 | Photo upload rejected / preview shows then vanishes | Config drift (bucket vs app) | Prod `driver-photos.file_size_limit` = 10 MiB (manual dashboard change, never migrated) vs app `DRIVER_PHOTO_MAX_BYTES` = 5 MiB enforced at client + server action + pgTAP. 5–10 MiB phone photos are rejected before any network request; the optimistic preview rolls back → "vanishes" | `20260930200000_production_sweep_fixes.sql` converges the bucket to 5 MiB (owner default). App not loosened |
| 2 | Profile-header photo upload fails with generic error while compliance-panel upload works | Client crash (undefined data shape) | `drivers/[id]/page.tsx` resolved the storage tenant folder from `session.user.user_metadata.tenant_id`, which prod accounts created before metadata backfills do not have → empty path prefix → upload refused | `driverPhotoTenantId()` helper (src/lib/drivers/photo.ts): driver row (loaded via `select("*")`) is the source of truth, session metadata only as fallback. Unit-tested |
| 3 | `/payments`, `/approvals` reachable without a server-side session | Auth-gate gap (hardening) | `src/proxy.ts` matcher (ADR-019 narrowed list) was never extended when the two newest modules shipped (#53/#56) — no auth/profile/status/MFA gate ran on those routes | Matcher extended with `/payments/:path*` + `/approvals/:path*` |
| 4 | Crashes on boundary-less routes fall through to the raw Next default screen | Client crash (hardening) | 17 per-module `error.tsx` boundaries exist, but `/payments`, `/hr`, `/users`, `/roles`, `/security`, `/settings` (and future modules) have none | Root `src/app/error.tsx` safety net — same UX contract as per-module boundaries (digest `ref:` shown, manual retry, no auto-loop) |

## Photo workflow matrix (per Prompt L)

| Surface | <5 MB | 5–10 MB | 10 MB+ | After fix |
|---------|-------|---------|--------|-----------|
| Profile header (`/drivers/[id]`) | accepted | **rejected pre-upload** (toast "max 5MB") — was the #1 complaint | rejected | accepted; 5–10 MB still rejected consistently |
| Compliance panel (`driver-compliance-engine.tsx`) | accepted | rejected (inline form error) | rejected | unchanged; consistent |
| Card preview / list avatar | signed-URL rendering via provider, TTL-safe | — | — | unchanged |

"Vanishes" reproduced in code: optimistic preview (`URL.createObjectURL`) is set before the size check can save it only when the check passes — the rollback path (`rollbackPreview()`) then revokes it after the server action refuses. With the bucket converged, app and storage reject identically, so no surface can show a preview that will not persist.

## Route sweep

Static sweep (all 30 routes): every module page is client-side defensive (`loadError` states, no unguarded `.single()`, no unsafe `JSON.parse`/index access found). Server routes `calendar/chat/pricing/tasks/templates` are redirect stubs; `dashboard-2/faqs/mail` are static. With no prod error digests available (see limitations), no dynamic crash could be attributed — the sweep spec + script are in-repo to walk all 30 routes live once a login exists.

## Tests (all executed, not just written)

- **pgTAP: 361/361 passed** across all 13 suites, run locally in the CI-identical way (`supabase db reset` → pgTAP extension → `psql -tA --single-transaction` per file) — incl. new `068_production_sweep_tests.sql` (5 MiB convergence, MIME/SVG pin, private bucket, 4 sibling-bucket drift guards, ADR-007 immutability)
- **Vitest: 527/527** (42 files) incl. 4 new `driverPhotoTenantId` cases
- **tsc** clean · **lint** 0 errors (67 pre-existing warnings) · **next build** green
- **Dynamic route sweep: 30/30 green** against live data — 22 modules render in place, 8 retired template routes redirect to `/dashboard` by design. The sweep records the final URL so a proxy redirect can never masquerade as green (this caught the MFA-gate masking during development)
- **Photo lifecycle matrix: 8/8 through the real UI** — <5 MB upload → persisted `photo_url` + `audit_log` rows + storage object in the tenant folder + signed-URL avatar render; 5–10 MB upload → rejected, zero DB impact. Executed as a session **without** `user_metadata.tenant_id`, proving the `driverPhotoTenantId` fallback end-to-end

## Migration

`20260930200000_production_sweep_fixes.sql` — idempotent, verified by local `supabase db reset` (applied cleanly, guards pass), raising if the bucket is missing or the post-condition fails.

## Prod follow-up needed

1. Manual `supabase db push --project-ref wwfnsbilmyxeawgzicmv` after merge (CI secrets pending owner action)
2. Owner: confirm on prod that 5–10 MB photos now get the consistent "max 5MB" toast on every surface (app and bucket now enforce the same value)
3. Optional: run `scripts/route-sweep.mjs` + `scripts/photo-matrix.mjs` against prod with a real login to repeat the dynamic pass on prod data

## Known limitations

- The dynamic sweep + photo matrix ran against the **local stack with seeded prod-shaped data** (prod credentials unavailable: repo-standard e2e login rejected by prod; no Vercel-log or Sentry-token access — `.env.local` carries empty values). All mechanisms are code-pinned and data-shape-representative, but the final prod-data pass remains for the owner
- Fixture lesson captured: zod v4 `.uuid()` enforces the RFC 9562 version nibble (stricter than Postgres `uuid`) — test fixtures must use v4-shaped UUIDs; prod ids from `gen_random_uuid()` are unaffected
- Dev-only CSP addition (`next.config.ts`) allows the local Supabase origin under `NODE_ENV=development`; production CSP bytes are unchanged
- No RLS/policy loosening anywhere; audit immutability re-proven by 068
- Owner preference honored: converged to 5 MB; if UX later demands 10 MB, change `DRIVER_PHOTO_MAX_BYTES` + the migrations together — never the dashboard alone (that is what caused this incident)
