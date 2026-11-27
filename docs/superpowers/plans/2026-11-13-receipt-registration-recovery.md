# Receipt Registration Recovery Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans, then obtain one fresh scoped read-only review.

**Goal:** Prevent deletion of accepted receipt originals after uncertain RPC outcomes and recover only an exact proven registration.

**Architecture:** Preserve private Storage objects, validate RPC DTOs and read back an exact scoped attachment/claim on uncertain or unique-path errors. Keep permission/workflow errors as failures.

**Tech Stack:** Existing Next.js/TypeScript/Supabase/Vitest; no dependencies or migrations.

**Spec:** `docs/superpowers/specs/2026-11-13-receipt-registration-recovery.md`.

## Constraints and review focus

No live writes or provider messages. Never infer safe deletion from a failed database response or an empty read. A matching path alone is insufficient: actor/tenant/claim/content/source/filename must match. Denials and unavailable reads remain failures. No claim that Telegram replay identity, orphan collection or full R05 is solved.

### Task 1: Reproduce and repair registration recovery

- [x] Add failing tests in `src/lib/expense-claims/attachments.test.ts` for committed-response loss, unique-path retry, failed/mismatching recovery and retained originals.
- [x] Update only `src/lib/expense-claims/attachments.ts`: retain originals, validate result and reconcile exact outcomes without writes or raw error disclosure.
- [x] Prove definite permission/workflow errors stay failures and wrong path/actor/tenant/content cannot recover another receipt.

### Task 2: Verify and review

- [x] Run focused/full relevant checks; freeze source and run production build/PDF assets after application changes.
- [x] Obtain scoped independent review and resolve material findings with regressions.
- [ ] Publish reviewed passing source through the coordinated PR/Preview pipeline after owned acceptance cleanup; keep Production blocked while schema/recovery/provider gates remain open.

## Rulings

- The user has delegated professional implementation decisions and asked to continue all readiness fixes; retain the existing stack and route contracts.
- Choose read-only exact-outcome reconciliation over speculative deletion. Private orphan retention is explicit remaining operational work; it cannot authorize deletion of a potentially accepted original.
- Evidence: initial focused run observed20 failures/1 pass, including original deletion, lost-response recovery, malformed success and invalid-path client creation. After repair29/29 pass. Independent reviewer reran29/29, confirmed SQL field/exception compatibility and found no material issue. This is local code verification, not hosted employee-claim acceptance or fullR05 completion.
- Validation: first full run correctlyfailed TSC7053 at dynamic row indexing; failure/source-drift evidence preserved and build not run. Added an explicit object/non-array check and Record<string,unknown> narrowing. Frozen rerunPASS at2026-11-13T17:09:37.865Z: types, full lint,196 unit files/2,919 tests,524 guards, production build, receipt graph and invoice PDF assets; zero drift.
- Final verification-only delta: corrected the already-confirmed driver attendance alert expectation to the existing friendly mapping. Independent scoped review approved the retained denial/value/database assertions. Full524 guards, script lint/syntax/diff and33 focused tests PASS; all1,543 other frozen inputs match the complete application validation. Final freeze: supabase/.temp/receipt-registration-final-validation-20261113/source-freeze.json, resultPASS at2026-11-13T17:12:34.955Z. No live schema/data/permission/provider change.
