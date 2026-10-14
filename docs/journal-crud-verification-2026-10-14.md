# Accounting journal draft CRUD — 14 October 2026

## Change

Manual journal drafts can now be created, edited and soft deleted from Accounting. Edits load a fresh header/line snapshot, preserve descriptions, pass the expected update timestamp, and refresh the list and expanded-line cache after saving. Deletion requires confirmation. New entries default to draft mode. Mobile editors retain the viewport width with horizontal scrolling limited to line fields.

Authenticated database functions derive tenant and actor from the caller, enforce accounting permissions and privileged MFA, validate active tenant accounts and exact two-decimal amounts, lock/version-check drafts, and commit header, lines and audit together. Submitted/approved, posted, reversed and non-manual entries cannot use draft edit/delete. Deleted records and lines remain available for audit.

Approval writes lock/recheck their parent entry so late submissions cannot revive a deleted draft. Period closing rechecks pending drafts after acquiring the period lock; draft saves hold the target period against concurrent closure. Existing approval/posting/reversal functions remain in use.

## Verification

- Production build and TypeScript: passed.
- Unit suite: 53 files / 599 tests passed, with two workers to fit local memory.
- Full lint: zero errors / 87 inherited warnings.
- Database regression: all 2,300 pre-existing assertions passed; the new file passed 28 additional assertions after correcting its income-account fixture and balancing its posted-entry fixture.
- Database advisors: no errors; inherited get_default_tenant_id search-path warning remains.
- Browser against the production build and isolated local database: create, edit, persisted replacement lines, mobile editor overflow check, soft delete, reload, and all three audit records passed.
- Owner sign-in, enrollment, persisted MFA, returning-user challenge and sign-out passed with no browser runtime errors.
- Desktop and mobile screenshots were inspected. Credential/MFA values were not logged; synthetic fixtures were used only in the isolated local database.

## Release limits

The migration has only been applied locally. This change is stacked after invoice PR #70 and release PR #69. Exact-head CI and hosted staging checks remain required before merge. No production deployment, hosted schema mutation, migration-history repair or live-data change is claimed.

The journal table still displays the existing 100 most recent entries; full journal search/pagination and independent bank-account/payment lifecycle work remain outstanding. These changes do not certify every accounting or SaaS module. See release-status-2026-10-14.md for Supabase permission/history/recovery blockers and the verified Vercel production SHA.
