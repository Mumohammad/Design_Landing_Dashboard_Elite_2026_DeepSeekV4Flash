# Release candidate — 21 October 2026

The user authorized push, review, merge and production deployment subject to passing checks and no unresolved launch blockers. This checkpoint supersedes the earlier local-only restriction; earlier readiness reports remain dated evidence, not current permissions.

## Candidate scope

Invoice issue/finalize decisions now bind authenticated identity, tenant permissions and the exact reviewed version to one database transaction with audit/outbox/receipt. Zero-VAT invoices produce balanced two-line journals. Full unpaid SAR sales credit notes and debit notes commit document, ledger, VAT, receivables, audit and request receipt together. Unposted draft/issued cancellation is atomic and emits no financial reversal. Generic journal reversal cannot independently reverse system invoice journals. Legacy cancellation events fail closed for accounting review. Service dispatchers can read private note receipts but cannot mutate them; browser roles have no access.

The UI retains failed decisions for review/retry, uses explicit Saudi note dates, separates debit VAT inputs, and displays posting outcomes honestly. Purchase reversals, paid refunds and partial credits remain unavailable. No historical accounting repair or tenant configuration backfill is included.

## Verification

- Units: 1,255 assertions / 86 files passed on the final source; controlled two-worker run.
- Disposable native PostgreSQL: 338 invoice assertions plus 38 journal reversal assertions passed. These focused harnesses use selected actual schema/functions with minimal supporting fixtures; they do not replace the full Supabase stack.
- Prior final production build and explicit type check passed. Lint and exact-head CI are rerun for publishing.
- New full-schema rollback-only pgTAP suite exercises actual provisioning, RBAC, MFA, invoice triggers and consumers; execution pending CI.
- New browser lifecycle acceptance runs with the existing MFA/CRUD/PDF gate; execution pending CI/staging.
- New native invoice/reversal harnesses wired into CI. Existing full migration reset, Auth/Storage, security audit, E2E and bundle gates retained.

## Read-only target audit

GitHub PR #76 remains open against master. Production Vercel most recently lists READY commit `2fbca4fb7881a05a264a41443e716fd3930d91ca`; the old candidate `ca3b72c` checks do not validate this new delta. Automatic production deployment is held.

Production Supabase is at `20261016161500`; staging is at `20261020211615` before this candidate. The CLI still returns HTTP 403 for staging migration access; the connected Supabase management API works. No migrations were applied by this checkpoint.

Production event inventory: six processed credits, five processed/duplicate cancellation events, and three failed original-invoice posting events with no matching tenant invoice. No pending/failed credit, debit or cancellation events were found. This inventory does not prove historical GL/AR/AP/VAT reconciliation. All historical records remain unchanged. Twenty-four active tenants include five without a chart of accounts; migration scope does not initialize them.

## Merge / production gates

Require exact-head CI, full-schema and authenticated browser acceptance, staging migrations/deployment bound to the exact commit, dependency/secret review and a final diff review. Before production, rehearse the complete pending migration chain on an isolated restored backup, inventory/reconcile legacy financial effects, and coordinate affected writes/dispatchers so old service-based multi-write actions cannot race the new database/app cutover. No direct historical repair, live role/finance backfill, data deletion or secret change is authorized by this report.

ZATCA official production acceptance, bank/WPS/provider acceptance and full remaining-module operational readiness are unverified. Their controls remain disabled. Keeping the current Supabase plan means paid leaked-password protection remains unavailable by the user's decision. No blanket production-ready or identical-reference-PDF claim is made.

Do not merge or promote while required gates or launch blockers remain unresolved. Record exact commit, migration state, CI run, staging results and final deployment evidence as the pipeline progresses.

## Staging migration checkpoint

All six candidate migrations were applied to the existing staging project through the connected management API after focused native verification. Local migration filenames now match the exact versions recorded by that API (`20261021091437` through `20261021091526`). No production schema or data changed.

CI at `5f63040` passed the build/unit job and the new 136-assertion full-schema suite. Two legacy RBAC INSERT-grant expectations required adjustment for intentionally RPC-only notes. Hosted E2E correctly failed because its staging preview still served an older commit; a matching preview and rerun remain required. Local lint passed with zero errors and 85 existing warnings.

## Cutover and posted-finance update (2026-10-21)

- Added database guards against direct service-role invoice, note, line, outbox and managed AR/AP writes from old deployments. Current caller-bound transactions and source row-lock reads remain supported. Historical records are retained unchanged.
- Replaced invoice-header dashboard estimates with complete posted-ledger income/expense and outstanding invoice/debit-note receivables. Exact cents, equal inclusive comparison periods and honest unavailable states are preserved. Four existing SELECT policies cache caller-wide decisions without changing tenant/RBAC semantics; catalog drift aborts the migration.
- Local verification: 1,301 units, types, production build and configuration/API/PDF bundle checks pass. Lint: zero errors, 85 existing warnings. Native invoice guard/contracts: 399 assertions. Full-schema write guard83, financial KPI44 and invoice136 pass; KPI suite13.238seconds under30second statement limits.
- Both new migrations are applied to isolated staging, with source versions matching its migration history. Browser lifecycle now checks exact posted income/AR changes before/after a100.25SAR invoice and full credit, with retained debit balance in English/Arabic.
- New-head CI/browser checks, atomic production rehearsal, merge and exact-commit production deployment are pending. Previous-head passing evidence is not acceptance for the new head.
- Official ZATCA production acceptance, bank/WPS/provider acceptance and unsupported refund/partial-credit/purchase-reversal flows remain unavailable or unverified; no whole-product launch or official QR certification claim is made.
