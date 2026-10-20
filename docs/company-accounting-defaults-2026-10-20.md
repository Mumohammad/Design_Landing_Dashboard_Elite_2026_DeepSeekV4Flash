# Complete accounting initialization

The first hosted expense-approval check exposed a real onboarding defect: a new
company had no expense-category mappings, so its first approval failed with
`EXP005`. Only the demo tenant had received those mappings. Provisioning created
roles/settings but did not initialize the standard chart or mapping template.

New-company provisioning now calls the existing accounting initializer in the
same company transaction. Initialization creates the repository's 28 standard
accounts, six category mappings and current open period. The explicit authorized
accounting initializer also creates missing mappings. Existing account names,
category choices, VAT recoverability and period states are preserved. Concurrent
initializers use the period's unique constraint as well as the existing account
and mapping constraints. A finance failure aborts company creation rather than
leaving a partial workspace.

Migration `20261020093321_expense_accounting_defaults` defines these functions on
staging only. It performs no call that backfills an existing tenant. Existing
production configuration is unchanged; repairs there need an explicit authorized
initialization/review. Empty accounts and mappings are templates, not invented
opening balances, VAT registrations or finance-owner acceptance.

The functions remain service-only with empty search paths. The accounting action
keeps its permission, tenant and MFA checks. Staging advisor findings were compared
without observation timestamps and are unchanged.

Focused native PostgreSQL verification passed six concurrent initializations,
exact one chart/mapping set/period, customization preservation, injected mapping
failure rollback of accounts and period, recovery and anonymous/authenticated
execution denial. New pgTAP tests exercise full company provisioning and failure
rollback using real Auth/RBAC schema in CI. Browser verification now requires the
freshly provisioned company to have six mappings resolving to real accounts; it
does not insert mappings into fixtures to hide the onboarding defect.

Final CI, exact-commit preview and hosted approval evidence are recorded on PR 76
after execution. The earlier `03e0c38` main and E2E jobs passed; its database job
passed 2,565 assertions and the approval concurrency tests, then failed the browser
check at the missing-mapping boundary. That candidate was not merged or promoted.
