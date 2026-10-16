# Bank-account lifecycle — 14 October 2026

## Implemented

- Create/edit, deactivate/reactivate, and confirmed soft deletion of unused bank accounts.
- Permission/MFA enforcement, tenant-derived ownership, row/version locks, atomic audit records, IBAN normalization/checksum checks, exact monetary precision, active tenant asset-account mapping, and serialized duplicate checks.
- Accounts with payment/transaction/reconciliation history retain their identity, currency, opening balance and ledger mapping; names and active status may change. Referenced accounts cannot be deleted.
- New financial references require an active bank account from the same tenant and serialize against deactivation. Existing payment/transaction history remains available for reconciliation and voiding.
- Bank cards include lifecycle controls, errors appear within dialogs, the editor is responsive, and the bank list uses 50-row server pagination with counts/retry.
- The payment bank picker independently searches active accounts by bank name, paginates 25 at a time, and retains the selected account across result pages. Loading, empty, retry and mobile states are explicit.
- Audits store only the IBAN's last four characters. IBAN validation checks format/checksum; it does not prove account ownership or provider acceptance.

## Verification at initial push

- New database test file passed 26 assertions, including stale edits, duplicate/checksum rejection, tenant/MFA isolation, transaction guards, history preservation and audit rollback.
- The full local database suite completed successfully: 2,354 assertions, zero failed files. Local build/type/lint processes were stopped due to memory pressure; those checks are not claimed passed locally for this branch.
- CI runs unit tests, lint, production build/types, migration replay, database tests, storage integration and combined invoice/journal/bank browser lifecycle verification on an isolated runner. Review exact-head results before release.
- The migration has only been applied to the isolated local database; no hosted mutation or production deployment occurred.

## Follow-up verification

- At commit `7bb516b08fd882348282b179c9000ff11f7e0659`, GitHub run `38564546815` passed the CI and pgTAP jobs, including production build/types/lint/unit tests, fresh migration replay, Auth/Storage integration and combined invoice/journal/bank browser flows. Hosted staging E2E failed its missing-configuration gate; the PR is not ready to merge.
- The bank editor's desktop and 375px mobile screenshots were inspected. The local production build and bank create/edit/state/delete/reload/audit flow passed before adding the independent payment picker.
- The picker regression adds 53 synthetic active bank accounts and checks access beyond the management page, pagination, search, selection retention and mobile overflow. Its exact-head CI and browser results must pass before release.

## Remaining release and module work

This branch stacks on journal PR #71, invoice PR #70 and release PR #69. Hosted staging E2E, Supabase migration privileges/history reconciliation and verified recovery remain unresolved. Production is currently a redeploy of unchanged master SHA 3362ab17b8da7240cd44ef15a6c8cd47c59bae21, not these changes.

Payment allocation/voiding still need a separate atomicity review. Journal list pagination/search, party selectors beyond their existing limits, reconciliation workflows, and other modules are not certified by this bank-account change. Migrate and deploy the matching app together because direct authenticated bank writes are now revoked.
