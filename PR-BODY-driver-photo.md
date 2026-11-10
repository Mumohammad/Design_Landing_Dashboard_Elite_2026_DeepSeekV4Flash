# Prompt K — Driver Photo Workflow (fix/driver-photo)

## Result: COMPLETE

## Root Cause

The photo was "saved" to storage and `drivers.photo_url` on the happy path — the
vanishing/stale-photo symptoms came from **eight compounding defects** across the
flow, none of them the DB write itself:

1. **Audit trail was silently RLS-denied (the hidden DB regression).**
   `audit_log` carried only a SELECT policy (010_rls_policies.sql: "INSERT is
   service-role / SECURITY DEFINER"). `updateDriverPhoto`/`removeDriverPhoto`
   inserted audit rows through the **authenticated** client — every insert was
   denied with no error surfaced (code logged-and-continued). Photo changes were
   invisible to the audit surface. Verified by experiment pre-fix: `ERROR: new
   row violates row-level security policy for table "audit_log"`.
2. **10MB vs 5MB limit mismatch.** The detail page and card panel accepted
   10MB, but the `driver-photos` bucket enforces 5,242,880 bytes — a 5–10MB
   upload failed at storage with a raw error after the UI had already shown an
   optimistic preview (which was then never rolled back — the photo "appeared"
   but was never persisted).
3. **No MIME policy at the storage layer.** The bucket was created with
   `allowed_mime_types` NULL (allow-all), so SVG (active content) and any
   non-image could be uploaded via crafted requests; client checks differed
   per surface (one accepted SVG explicitly).
4. **Divergent duplicate implementations.** A second 846-line
   `driver-card-panel.tsx` under `(dashboard)/drivers/` carried its own photo
   flow with the wrong 10MB limit — dead code (nothing imported it), but the
   source of inconsistent behavior claims.
5. **Fragile card-preview photo bridge.** The real card panel consumed the
   shared signed photo through a **module-level ref** written in a
   `setTimeout(0)` by a sibling component — a mount race: open the card before
   the bridge fired and the photo was `null` (old/missing image on the card).
6. **Missing cross-surface notification.** The compliance-engine photo upload
   never emitted `emitDriverChanged({action:"photo"})`, so other surfaces kept
   the previous photo until a manual reload.
7. **Orphaned/leaked storage objects.** A failed DB update left the uploaded
   object in the bucket; a successful replace left the old object there too
   (and storage RLS grants authenticated users no DELETE — cleanup was
   impossible from the client path).
8. **No broken-image fallback.** Signed URLs expire; if an object was deleted,
   list rows rendered broken image icons instead of the initials fallback.

## Files Changed (14)

| File | Change |
|---|---|
| `src/lib/drivers/photo.ts` | **NEW** — single source of truth: bucket name, 5MB limit, MIME policy (SVG excluded), path builder, server-side path validation, legacy-URL detection |
| `src/lib/drivers/photo.test.ts` | **NEW** — 14 unit tests (path traversal, cross-driver isolation, MIME/extension resolution, safe names, legacy URLs) |
| `src/app/actions/drivers/driver-photo.ts` | Server-side MIME+size validation; path validation via shared helper; old-object cleanup on replace; orphan cleanup on DB failure; audit inserts moved to service-role client (ADR-007) |
| `supabase/migrations/20260929120000_audit_log_insert_policy.sql` | **NEW** — `audit_log_insert_own_actor` INSERT policy (own tenant via `get_my_tenant_id()` + own actor via `auth.uid()`); UPDATE/DELETE stay blocked (immutability trigger asserted) — also fixes documents/cards/overrides audit writes |
| `supabase/migrations/20260929130000_driver_photos_bucket_mime.sql` | **NEW** — pins driver-photos bucket to image-only MIME list |
| `src/app/(dashboard)/drivers/[id]/page.tsx` | Shared policy; error paths roll back the optimistic preview to the persisted photo; passes contentType/size to the action; emits the photo event on success |
| `src/app/(dashboard)/drivers/page.tsx` | List avatar falls back to initials on broken/expired signed URL |
| `src/components/drivers/photo-provider.tsx` | Re-syncs when a caller supplies a different path (list refetch after upload) |
| `src/components/drivers/driver-card-panel.tsx` | Card preview/print consume `useDriverPhoto()` context directly — bridge and its mount race deleted |
| `src/components/drivers/driver-card-preview.tsx` | Card face falls back to user icon when the photo URL fails |
| `src/components/drivers/driver-compliance-engine.tsx` | Shared 5MB/MIME policy; explicit bilingual errors; sends contentType/size; emits the photo event after success |
| `src/app/(dashboard)/drivers/driver-card-panel.tsx` | **DELETED** — 846-line dead duplicate with divergent photo flow |
| `supabase/tests/067_driver_photo_tests.sql` | **NEW** — 13 pgTAP assertions |
| `e2e/driver-photo.spec.ts` | **NEW** — Playwright workflow spec (skips gracefully without fixtures) |

## Implementation Details (flow after the fix)

1. **Pick:** every surface validates with `driverPhotoImageMeta` (browser type
   or extension fallback for HEIC/AVIF; SVG rejected) and the shared 5MB limit.
2. **Preview:** object-URL preview shown immediately, but **rolled back** to the
   last persisted photo on any failure — no misleading "saved" state.
3. **Upload:** to `driver-photos` under `${tenant}/${driver}/photo-<ts>-<name>`
   (safe-name builder strips traversal); bucket enforces 5MB + MIME.
4. **Persist:** `updateDriverPhoto` re-validates path/MIME/size server-side,
   writes `drivers.photo_url` (the storage **path** — single source of truth),
   cleans up the previous object (service role), writes the audit row (now
   actually lands), recomputes compliance, revalidates both driver routes.
5. **Display:** `DriverPhotoProvider` re-reads `photo_url` from the DB, signs a
   10-minute URL, cache-busts with `drivers.updated_at`, re-signs every 5 min,
   and re-signs on `photo` events from any surface — one provider per driver
   feeds profile header, lightbox, list avatar, compliance panel, and the card
   preview/print. Legacy full-URL rows and photo-less drivers (initials) still
   render.
6. **Failure:** invalid type/oversize reject before any network call; storage
   failure rolls the preview back; DB failure removes the orphaned object and
   rolls back; removal cleans up the object and clears every surface.

## Database / API Changes

- `audit_log` +1 INSERT policy (`audit_log_insert_own_actor`, authenticated):
  `WITH CHECK (tenant_id = get_my_tenant_id() AND actor_id = auth.uid())`.
  SELECT/UPDATE/DELETE unchanged; immutability trigger untouched (ADR-007).
- `storage.buckets` row `driver-photos`: `allowed_mime_types` NULL →
  image-only list (jpeg/png/webp/gif/avif/heic/heif/bmp — no SVG).
- `updateDriverPhoto` input accepts optional `contentType`/`size`
  (defense-in-depth validation); response shape unchanged.
- No schema/column changes; `drivers.photo_url` remains the storage path.

## Test Results

| Gate | Result |
|---|---|
| pgTAP full suite (12 files) | **341 ok / 0 fail** (328 baseline + 13 new in `067_driver_photo_tests.sql`) |
| vitest | **523/523 across 42 files** (509 baseline + 14 new photo tests) |
| tsc `--noEmit` | clean |
| eslint | **0 errors / 67 warnings** (baseline 71 — dead-file deletion removed 4) |
| Playwright `e2e/driver-photo.spec.ts` | added: refresh persistence, re-login persistence, invalid-type rejection, oversize rejection, photo-less fallback; auto-skips without seeded fixtures |

New pgTAP coverage: private 5MB bucket with image-only MIME (SVG excluded),
storage RLS tenant-folder SELECT/INSERT and no UPDATE/DELETE policies,
`drivers.photo_url` + tenant-checked UPDATE policy, audit INSERT policy shape,
forged-actor denial (42501), and a live photo-audit round-trip insert + read
back as the acting user.

## Acceptance Criteria Mapping

- *Photo remains after refresh/re-login* — path persisted in DB, signed URL
  regenerated from it on every load (pgTAP 067 + e2e refresh/re-login tests).
- *Consistent on profile and card* — one provider, one signed URL, no bridge
  race (e2e consistency check + card panel now context-driven).
- *Replacement updates everywhere* — old object deleted, `updated_at`
  cache-bust, photo event re-signs all surfaces (unit + pgTAP replace-path
  assertions).
- *Failed uploads never mislead* — pre-network validation, preview rollback,
  orphan cleanup, no success toast unless storage+DB both succeeded.
- *Photo-less drivers keep working* — null/legacy paths render initials or
  legacy URL directly (unit tests + e2e fallback test).
