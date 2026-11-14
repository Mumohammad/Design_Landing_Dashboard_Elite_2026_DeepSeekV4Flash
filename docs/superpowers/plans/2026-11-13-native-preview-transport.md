# Native Preview Transport Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. Obtain one fresh read-only review after implementation.

**Goal:** Make hosted browser acceptance use native HTTP semantics without credential leakage or fetch/fulfill lifetime races.

**Architecture:** An authenticated loopback HTTPS proxy inserts scoped OIDC into upstream requests. Browser fixtures/coordinator opt into its context configuration; fault-injection helpers continue native routes. Direct preflights remain unchanged.

**Tech Stack:** Node 24, Playwright 1.62.1, installed jsrsasign; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-native-preview-transport.md`.

## Constraints and review focus

Preserve exact Preview/project/backend checks, app authorization, financial assertions, fixture ownership/cleanup and secret-free evidence. Never use a Production target or change project protection. Test foreign redirects, private addresses, invalid certificates, first/new-tab requests, response-loss injection and closure during streaming. No synthetic transport result establishes hosted CRUD acceptance.

### Task 1: Streaming authenticated loopback proxy

Files: create `scripts/lib/verification-proxy.mjs` and `scripts/verification-proxy.test.mjs`.

- [x] Write real HTTP/TLS/browser tests and observe failure before implementation.
- [x] Implement in-memory certificate/credentials, CONNECT authority validation, safe pinned DNS/TLS and streaming forwarding; preserve upgrades and cancellation.
- [x] Prove token/proxy-credential isolation, redirect/cookie/body semantics, TLS/private-address rejection and bounded shutdown.

### Task 2: Opt-in native browser transport

Files: modify `scripts/lib/verification-access.mjs`, `scripts/verification-access.test.mjs`, `e2e/preview-test.ts`, `scripts/verify-production-modules.mjs`, and CI guard list.

- [x] Add failing proxy/context probe and native route-continuation tests.
- [x] Wire worker fixture/coordinator lifecycle and fail-closed context verification; retain direct HTTP identity logic.
- [x] Run real Chromium fault-injection, multiple-tab, download and shutdown tests with synthetic input.

### Task 3: Review, validation and release evidence

- [x] Run guards, lint/types, unit/build checks and compare runtime inputs to the validated application baseline.
- [x] Obtain independent read-only review; resolve material findings with failing tests first.
- [ ] Publish only passing reviewed source to PR #128; verify exact staging Preview and complete hosted CI/cleanup.
- [ ] Update the readiness report with actual outcomes and remaining schema/recovery/provider blockers. Do not merge or deploy Production while blocked.

## Execution ledger

- Ruling: do not repeat the rejected draining experiments. Native forwarding removes the Playwright APIResponse object from ordinary browser transport.
- Ruling: current actual OIDC-cookie capability probe returned zero cookies; it is not a supported browser-session solution for this project.
- Ruling: browser-level CDP non-flat auto-attach is unsupported by the installed Chromium; no implementation relies on private SDK session routing.
- Current source additionally corrects the reports ambiguous alert and driver raw-error-code assertions. Persisted state/audit/stale-write checks remain unchanged.
- Evidence: actual protected 13b8abc Preview read-only probe passed EN/AR landing and new-tab invoice redirect, with zero browser-visible identity headers/runtime errors and zero sockets after closure. No fixtures/settings/secrets changed.
- Evidence: actual public Playwright fixture passed13/13 with zero retries/flakes/skips. This verifies the working verifier against the existing deployed app, not final exact-head hosted acceptance.
- Review: independent reviewer reproduced cancellation after deferred identity, late upstream socket assignment during shutdown, and contextOptions legacy fallback. Each failed before its fix and passed afterward. Late-assignment closure additionally passed five consecutive runs.
- Review: no unresolved Critical/Important finding in the inspected transport boundary. Additional persistent cases cover binary downloads, concurrent responses, CONNECT authentication/authority/Host rejection and incorrect upstream certificate trust/hostname.
- Ruling: native browser continuation never clones incoming cookies/authorization into redirect-persistent Playwright overrides. Explicit browser header or cross-origin URL overrides are rejected; scoped direct HTTP/API access is unchanged.
- Final local validation: PASS at2026-11-13T09:43:37.059Z; 195 unit files/2,890 tests,523 guards, types, lint, build and invoice bundle. Rechecked all1,543 frozen inputs with zero drift before publication. Dependency audit and deployment/API/history guards also pass.
- Current working verifier repeated the13 public staging fixture tests at2026-11-13T16:05:53.141Z:13PASS,0failed/flaky/skipped,0retries. No data fixtures or credentials persisted.
- Ruling: selected hosted entry points own/configure the proxy. Additional tabs reuse those contexts. The unselected legacy photo suite and explicitly loopback-only MFA harness are not silently migrated or represented as new hosted acceptance.
- Hosted follow-up: 592c5d0 Preview passed exact-head/backend/auth preflight at2026-11-13T16:16:42.809Z. Initial E2E selector expired19 seconds before preflight completed; no browser tests ran in that attempt. Preserve its failure and prepare the next verified registry entry before advancing the feature ref.
- Hosted follow-up: Linux passed11 native transport cases; the context-override fixture failed immediately and left its listener open. A real clean-cwd reproduction confirmed ENOENT because ignored supabase/.temp was absent. The fixture now uses an OS temporary directory, resolves its import from this module and encloses file setup in listener cleanup. A persistent child-process regression proves it completes from an empty working directory. The CI step has a3-minute failure boundary; it does not force successful test exit or relax assertions.
- Correction validation:524/524 guards,0 failed/skipped/cancelled, changed-script lint and diff check PASS at2026-11-13T16:27:49.043Z. Only two frozen verification/CI inputs changed;1,541 inputs are unchanged from the full passing validation. Types also reran successfully. Independent scoped review found no material issue and reran both targeted regressions2/2 without forced exit. Linux confirmation remains pending.
- Actual df1b22c CI43463873032: corePASS including13 native Linux cases; complete disposable database/browserPASS; E2E41passed/1failed/0flaky/0skipped, with vehicle HTTP400 and one loading attempt failure. No disposed-response/already-handled exceptions recur. All9 staging groups ran: VAT review and legacy expensesPASS;7FAIL; all9 owned cleanups/recoveryPASS. Driver top-level CRUD/stale/archive assertions nowPASS; its next helper still expected raw PAY_PREPARATION_LOCKED despite the existing dialog using friendlyError. Update that assertion to the exact established English message, preserving the entered-value and unchanged-database checks. Do not call the whole driver group accepted.
