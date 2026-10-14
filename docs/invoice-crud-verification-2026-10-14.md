# Invoice draft CRUD verification — 14 October 2026

## Scope

This branch follows release PR #69. It adds editing and soft deletion of sales and purchase drafts, accessible line fields, mobile scrolling within the line editor, status filtering, explicit loading failures/retry, and 50-row server pagination instead of an unexplained 200-invoice cutoff. Search and metrics explicitly cover the current page. SAR totals exclude other currencies.

Draft creation, replacement of lines, totals and audit evidence now commit in one authenticated database operation. Tenant and actor are derived from Auth, active parties must belong to the tenant, permissions/MFA are enforced, row locks serialize writes and expected timestamps reject stale edits/deletions. Issued and finalized documents are not editable/deletable through these functions.

Invoice math uses decimal parsing and integer arithmetic before multiplication. PostgreSQL rounds decimal ties away from zero; the old tests incorrectly claimed truncation. VAT on 4.10 at 15% is now 0.62. Unsupported precision, negative net amounts and monetary overflow are rejected. Existing historical amounts are not rewritten.

## Evidence

- Production build and its TypeScript check passed.
- Full lint: zero errors / 87 inherited warnings. API guard and deployment configuration checks passed.
- Unit suite: 53 files, 599 assertions passed.
- Database suite: 2,300 pgTAP assertions passed, including 27 draft CRUD/tenant/MFA/atomicity checks.
- Invoice browser flow passed against the production build and isolated local Supabase: create, VAT preview, persisted total, edit, changed version, mobile viewport, soft delete, reload and complete audit history.
- Owner sign-in/enrollment/returning-user MFA/sign-out checks passed with zero browser runtime errors.
- Database security advisors reported no errors. One inherited warning remains on the search path of get_default_tenant_id.
- Final hosted CI results are recorded on the pull request; local evidence does not replace that gate.

One initial browser run failed without a granular invoice checkpoint. The subsequent instrumented run passed the complete flow. Assertions now allow 20 seconds for cold local rendering; credential values and MFA secrets are never recorded.

## Rollout constraints

The new migration has only been applied to the isolated local database. It revokes direct authenticated invoice writes, so deploying it independently ahead of its matching application would break the previous draft-save implementation. Coordinate the migration/application cutover and verify create/edit before opening writes to users. Never apply this additional migration as part of the earlier PR #69 rollout.

The initial production snapshot was Vercel deployment dpl_BQivroCHVCr6To9zARPX5fQCjboC from 3 October. A fresh October 14 API check found READY deployment dpl_6AvrHT1TvQwRJjyyENqrheoYZVWD on elite-dashboard-blush.vercel.app: a redeploy of unchanged master SHA 3362ab17b8da7240cd44ef15a6c8cd47c59bae21, created October 13 at 21:02:35 UTC. Health/sign-in return HTTP 200, but it does not contain these CRUD or release fixes. The Vercel CLI can access the intended project; the connector still reports a team-scope 403. No new production deployment or merge is claimed.

The user selected existing Supabase staging project viowrovartosrkqukjxy (elite-staging). Read-only inspection found migration history through 20260906213149, 26 pending release migration files, no active driver documents and no orphan current-driver assignments. The existing Vercel preview configuration currently points at production Supabase; it must be isolated before running mutation tests. Secret-type values cannot be recovered by env pull, and their omission does not prove that deployed secrets are absent.

Supabase CLI project linking and production backup inspection return access-control errors. Authentication with the authorized project account remains pending. No staging reset, paid branch, production data change, secret replacement, or migration-history repair has been performed.

## Remaining module work

Accounting journal drafts still need update/delete controls and corresponding atomic, permission-aware operations. Submitted/posted/reversed journal entries require approval or reversal workflows rather than arbitrary CRUD. Bank accounts and other modules need independent lifecycle/permission/browser coverage; this invoice change does not certify every module for launch. Hosted end-to-end verification, recovery evidence and coordinated production rollout remain required.

## UI follow-up

Row actions now use a compact accessible menu. Visual inspection found mobile dialog clipping even though the document-width assertion passed; responsive dialog sizing and a zero minimum width on the form now keep the editor inside the viewport. The regression check also measures overflow within the dialog. The updated production build, create/edit/delete browser flow, audit persistence, mobile screenshot inspection, and complete owner MFA flow passed. Unit/database behavior is unchanged by this UI-only follow-up.

The latest release access and recovery findings are in `release-status-2026-10-14.md` on the base release branch. A successful backup inspection reported no listed production backups and PITR disabled; migration login still returns intermittent authorization errors. No hosted migration or production deployment is included in this follow-up.
