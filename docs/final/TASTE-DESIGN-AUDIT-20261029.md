# Design audit before changes

Source: 890b0a0732b9a37c7a50545b84a33fd1b97228a1. Source audit completed before visual edits. Before screenshots and Taste measurements were recorded on the immutable feature preview at desktop/tablet/phone sizes. Final merged-candidate visual sign-off is still pending.

67 pages, five layouts,123 shared components,88 module-local components;55 rendered screens,11 redirects,one intentional404.

- Decorative module KPIs and repeated glass/gradient surfaces obscure operational hierarchy.
- Hover-only row actions lack keyboard/touch discovery.
- Physical table/search/dialog spacing contradicts RTL.
- Nested content gutters and independently composed headings vary.
- Public/platform/auth/admin use separate theme systems.
- Nested full-screen auth content conflicts with its shared form shell.
- Sidebar detail routes lose active module context.
- Global transitions/reveal layers create unnecessary app entrances.
- The audited baseline used the ADR015 navy sidebar gradient. Upstream ADR020 now supersedes it; the reconciled design uses semantic light/dark sidebar surfaces.
- Landing driver-intake CTA targets intentional404; valid tenant context must be supplied rather than inventing a new route.
- Exact-reference invoice HTML/PDF and business actions/data are excluded from visual changes.

## All page sources

- src/app/(dashboard)/accounting/page.tsx
- src/app/(dashboard)/applications/[id]/page.tsx
- src/app/(dashboard)/applications/page.tsx
- src/app/(dashboard)/approvals/page.tsx
- src/app/(dashboard)/attendance/page.tsx
- src/app/(dashboard)/audit-log/page.tsx
- src/app/(dashboard)/calendar/page.tsx
- src/app/(dashboard)/chat/page.tsx
- src/app/(dashboard)/dashboard-2/page.tsx
- src/app/(dashboard)/dashboard/page.tsx
- src/app/(dashboard)/drivers/[id]/page.tsx
- src/app/(dashboard)/drivers/page.tsx
- src/app/(dashboard)/expenses/page.tsx
- src/app/(dashboard)/faqs/page.tsx
- src/app/(dashboard)/hr/page.tsx
- src/app/(dashboard)/invoices/page.tsx
- src/app/(dashboard)/mail/page.tsx
- src/app/(dashboard)/maintenance/page.tsx
- src/app/(dashboard)/orders/page.tsx
- src/app/(dashboard)/payments/page.tsx
- src/app/(dashboard)/payroll/page.tsx
- src/app/(dashboard)/payroll/preparation/page.tsx
- src/app/(dashboard)/platforms/[id]/page.tsx
- src/app/(dashboard)/platforms/page.tsx
- src/app/(dashboard)/pricing/page.tsx
- src/app/(dashboard)/reports/page.tsx
- src/app/(dashboard)/roles/page.tsx
- src/app/(dashboard)/security/page.tsx
- src/app/(dashboard)/settings/company/page.tsx
- src/app/(dashboard)/settings/language/page.tsx
- src/app/(dashboard)/settings/mfa/page.tsx
- src/app/(dashboard)/settings/page.tsx
- src/app/(dashboard)/settings/payroll-defaults/page.tsx
- src/app/(dashboard)/settings/security/page.tsx
- src/app/(dashboard)/settings/users/page.tsx
- src/app/(dashboard)/tasks/page.tsx
- src/app/(dashboard)/templates/page.tsx
- src/app/(dashboard)/users/[id]/page.tsx
- src/app/(dashboard)/users/page.tsx
- src/app/(dashboard)/vehicles/[id]/page.tsx
- src/app/(dashboard)/vehicles/page.tsx
- src/app/(dashboard)/violations/page.tsx
- src/app/apply/[tenantSlug]/page.tsx
- src/app/auth/accept-invite/page.tsx
- src/app/auth/change-password/page.tsx
- src/app/auth/errors/forbidden/page.tsx
- src/app/auth/errors/internal-server-error/page.tsx
- src/app/auth/errors/not-found/page.tsx
- src/app/auth/errors/unauthorized/page.tsx
- src/app/auth/errors/under-maintenance/page.tsx
- src/app/auth/forgot-password/page.tsx
- src/app/auth/mfa-challenge/page.tsx
- src/app/auth/reset-password/page.tsx
- src/app/auth/sign-in/page.tsx
- src/app/auth/sign-up/page.tsx
- src/app/driver-application-status/[reference]/page.tsx
- src/app/driver-registration/page.tsx
- src/app/help/page.tsx
- src/app/landing/page.tsx
- src/app/page.tsx
- src/app/platform/admin/page.tsx
- src/app/platform/login/page.tsx
- src/app/platform/page.tsx
- src/app/platform/register/page.tsx
- src/app/privacy/page.tsx
- src/app/terms/page.tsx
- src/app/verify-document/[docNumber]/page.tsx

## All shared layouts

- src/app/(dashboard)/layout.tsx
- src/app/apply/[tenantSlug]/layout.tsx
- src/app/auth/layout.tsx
- src/app/driver-registration/layout.tsx
- src/app/layout.tsx

## All reusable components

- src/components/accounting/accounting-option-picker.tsx
- src/components/accounting/accounting-page-controls.tsx
- src/components/accounting/bank-account-picker.tsx
- src/components/accounting/invoice-party-picker.tsx
- src/components/accounting/ledger-toolbar.tsx
- src/components/accounting/payment-allocation-picker.tsx
- src/components/app-sidebar.tsx
- src/components/auth/password-form.tsx
- src/components/color-picker.tsx
- src/components/command-search.tsx
- src/components/dashboard/Header.tsx
- src/components/dashboard/app-topbar.tsx
- src/components/dashboard/enterprise-module-page.tsx
- src/components/dashboard/placeholder-page.tsx
- src/components/dot-pattern.tsx
- src/components/drivers/attendance-tab.tsx
- src/components/drivers/document-upload-dialog.tsx
- src/components/drivers/documents-delete-dialog.tsx
- src/components/drivers/driver-actions-menu.tsx
- src/components/drivers/driver-assets-card.tsx
- src/components/drivers/driver-card-panel.tsx
- src/components/drivers/driver-card-preview.tsx
- src/components/drivers/driver-compliance-engine.tsx
- src/components/drivers/driver-history-toolbar.tsx
- src/components/drivers/driver-leave-tab.tsx
- src/components/drivers/driver-orders-kpi-card.tsx
- src/components/drivers/driver-tabs-form-dialog.tsx
- src/components/drivers/expiry-alert-chips.tsx
- src/components/drivers/leave-request-actions-dialog.tsx
- src/components/drivers/leave-request-dialog.tsx
- src/components/drivers/onboarding-checklist-chip.tsx
- src/components/drivers/performance-tab.tsx
- src/components/drivers/photo-provider.tsx
- src/components/drivers/training-tab.tsx
- src/components/drivers/vehicle-assignment-card.tsx
- src/components/drivers/violation-dialog.tsx
- src/components/drivers/violations-tab.tsx
- src/components/flag-icon.tsx
- src/components/image-3d.tsx
- src/components/landing/compliance-section.tsx
- src/components/landing/cost-control.tsx
- src/components/landing/dashboard-preview.tsx
- src/components/landing/driver-360.tsx
- src/components/landing/faq-section.tsx
- src/components/landing/final-cta.tsx
- src/components/landing/fleet-section.tsx
- src/components/landing/hero-section.tsx
- src/components/landing/landing-footer.tsx
- src/components/landing/landing-header.tsx
- src/components/landing/operations-section.tsx
- src/components/landing/payroll-showcase.tsx
- src/components/landing/platform-marquee.tsx
- src/components/landing/platform-overview.tsx
- src/components/landing/pricing-section.tsx
- src/components/landing/reporting-section.tsx
- src/components/landing/shared.tsx
- src/components/landing/trust-section.tsx
- src/components/landing/workflow-section.tsx
- src/components/language-toggle.tsx
- src/components/localized-text.tsx
- src/components/logo.tsx
- src/components/mode-toggle.tsx
- src/components/nav-main.tsx
- src/components/nav-secondary.tsx
- src/components/nav-user.tsx
- src/components/pricing-plans.tsx
- src/components/sidebar-notification.tsx
- src/components/sidebar.tsx
- src/components/site-footer.tsx
- src/components/site-header.tsx
- src/components/theme-customizer.tsx
- src/components/theme-customizer/import-modal.tsx
- src/components/theme-customizer/index.tsx
- src/components/theme-customizer/layout-tab.tsx
- src/components/theme-customizer/main.tsx
- src/components/theme-customizer/theme-tab.tsx
- src/components/theme-provider.tsx
- src/components/ui/accordion.tsx
- src/components/ui/avatar.tsx
- src/components/ui/badge.tsx
- src/components/ui/breadcrumb.tsx
- src/components/ui/button.tsx
- src/components/ui/calendar.tsx
- src/components/ui/card-decorator.tsx
- src/components/ui/card.tsx
- src/components/ui/chart.tsx
- src/components/ui/checkbox.tsx
- src/components/ui/collapsible.tsx
- src/components/ui/command.tsx
- src/components/ui/dialog.tsx
- src/components/ui/drawer.tsx
- src/components/ui/dropdown-menu.tsx
- src/components/ui/error-boundary.tsx
- src/components/ui/form.tsx
- src/components/ui/hover-card.tsx
- src/components/ui/input.tsx
- src/components/ui/label.tsx
- src/components/ui/loading-skeleton.tsx
- src/components/ui/loading-spinner.tsx
- src/components/ui/navigation-menu.tsx
- src/components/ui/page-transition.tsx
- src/components/ui/popover.tsx
- src/components/ui/progress.tsx
- src/components/ui/radio-group.tsx
- src/components/ui/resizable.tsx
- src/components/ui/scroll-area.tsx
- src/components/ui/scroll-reveal.tsx
- src/components/ui/select.tsx
- src/components/ui/separator.tsx
- src/components/ui/sheet.tsx
- src/components/ui/sidebar.tsx
- src/components/ui/skeleton.tsx
- src/components/ui/sonner.tsx
- src/components/ui/switch.tsx
- src/components/ui/table.tsx
- src/components/ui/tabs.tsx
- src/components/ui/textarea.tsx
- src/components/ui/toggle-group.tsx
- src/components/ui/toggle.tsx
- src/components/ui/tooltip.tsx
- src/components/vehicles/assign-driver-card.tsx
- src/components/vehicles/fleet-history-panels.tsx
- src/components/vehicles/vehicle-record-controls.tsx

## All module-local components

- src/app/(dashboard)/accounting/components/chart-of-accounts-manager.tsx
- src/app/(dashboard)/accounting/components/parties-manager.tsx
- src/app/(dashboard)/accounting/components/statements-manager.tsx
- src/app/(dashboard)/approvals/components/decision-dialog.tsx
- src/app/(dashboard)/calendar/components/calendar-main.tsx
- src/app/(dashboard)/calendar/components/calendar-sidebar.tsx
- src/app/(dashboard)/calendar/components/calendar-unified.tsx
- src/app/(dashboard)/calendar/components/calendar.tsx
- src/app/(dashboard)/calendar/components/calendars.tsx
- src/app/(dashboard)/calendar/components/date-picker.tsx
- src/app/(dashboard)/calendar/components/event-form.tsx
- src/app/(dashboard)/calendar/components/quick-actions.tsx
- src/app/(dashboard)/chat/components/chat-header.tsx
- src/app/(dashboard)/chat/components/chat.tsx
- src/app/(dashboard)/chat/components/conversation-list-new.tsx
- src/app/(dashboard)/chat/components/conversation-list.tsx
- src/app/(dashboard)/chat/components/message-input.tsx
- src/app/(dashboard)/chat/components/message-list.tsx
- src/app/(dashboard)/dashboard-2/components/customer-insights.tsx
- src/app/(dashboard)/dashboard-2/components/dashboard-header.tsx
- src/app/(dashboard)/dashboard-2/components/metrics-overview.tsx
- src/app/(dashboard)/dashboard-2/components/quick-actions.tsx
- src/app/(dashboard)/dashboard-2/components/recent-transactions.tsx
- src/app/(dashboard)/dashboard-2/components/revenue-breakdown.tsx
- src/app/(dashboard)/dashboard-2/components/sales-chart.tsx
- src/app/(dashboard)/dashboard-2/components/top-products.tsx
- src/app/(dashboard)/dashboard/components/action-center.tsx
- src/app/(dashboard)/dashboard/components/chart-card.tsx
- src/app/(dashboard)/dashboard/components/compliance-radar.tsx
- src/app/(dashboard)/dashboard/components/dashboard-header.tsx
- src/app/(dashboard)/dashboard/components/driver-table.tsx
- src/app/(dashboard)/dashboard/components/driver-targets.tsx
- src/app/(dashboard)/dashboard/components/filter-bar.tsx
- src/app/(dashboard)/dashboard/components/insights.tsx
- src/app/(dashboard)/dashboard/components/kpi-card.tsx
- src/app/(dashboard)/dashboard/components/ops-panel.tsx
- src/app/(dashboard)/dashboard/components/orders-trend.tsx
- src/app/(dashboard)/dashboard/components/payroll-summary.tsx
- src/app/(dashboard)/dashboard/components/platform-performance.tsx
- src/app/(dashboard)/dashboard/components/quick-actions.tsx
- src/app/(dashboard)/dashboard/components/recent-activity.tsx
- src/app/(dashboard)/dashboard/components/revenue-trend.tsx
- src/app/(dashboard)/dashboard/components/states.tsx
- src/app/(dashboard)/dashboard/components/violations-trend.tsx
- src/app/(dashboard)/drivers/components/create-driver-dialog.tsx
- src/app/(dashboard)/faqs/components/faq-list.tsx
- src/app/(dashboard)/faqs/components/features-grid.tsx
- src/app/(dashboard)/invoices/components/invoices-manager.tsx
- src/app/(dashboard)/mail/components/account-switcher.tsx
- src/app/(dashboard)/mail/components/mail-display.tsx
- src/app/(dashboard)/mail/components/mail-list.tsx
- src/app/(dashboard)/mail/components/mail.tsx
- src/app/(dashboard)/mail/components/nav.tsx
- src/app/(dashboard)/maintenance/components/event-dialogs.tsx
- src/app/(dashboard)/maintenance/components/odometer-dialog.tsx
- src/app/(dashboard)/orders/components/create-order-entry-dialog.tsx
- src/app/(dashboard)/platforms/components/entry-dialog.tsx
- src/app/(dashboard)/platforms/components/import-dialog.tsx
- src/app/(dashboard)/platforms/components/platform-dialogs.tsx
- src/app/(dashboard)/pricing/components/faq-section.tsx
- src/app/(dashboard)/pricing/components/features-grid.tsx
- src/app/(dashboard)/tasks/components/add-task-modal.tsx
- src/app/(dashboard)/tasks/components/columns.tsx
- src/app/(dashboard)/tasks/components/data-table-column-header.tsx
- src/app/(dashboard)/tasks/components/data-table-faceted-filter.tsx
- src/app/(dashboard)/tasks/components/data-table-pagination.tsx
- src/app/(dashboard)/tasks/components/data-table-row-actions.tsx
- src/app/(dashboard)/tasks/components/data-table-toolbar.tsx
- src/app/(dashboard)/tasks/components/data-table-view-options.tsx
- src/app/(dashboard)/tasks/components/data-table.tsx
- src/app/(dashboard)/tasks/components/user-nav.tsx
- src/app/(dashboard)/users/components/user-form-dialog.tsx
- src/app/(dashboard)/users/components/user-management-controls.tsx
- src/app/(dashboard)/users/components/user-status-dialog.tsx
- src/app/(dashboard)/vehicles/components/create-vehicle-dialog.tsx
- src/app/auth/errors/forbidden/components/forbidden-error.tsx
- src/app/auth/errors/internal-server-error/components/internal-server-error.tsx
- src/app/auth/errors/not-found/components/not-found-error.tsx
- src/app/auth/errors/unauthorized/components/unauthorized-error.tsx
- src/app/auth/errors/under-maintenance/components/under-maintenance-error.tsx
- src/app/auth/forgot-password/components/forgot-password-form-1.tsx
- src/app/auth/sign-in/components/login-form-1.tsx
- src/app/auth/sign-up/components/signup-form-1.tsx
- src/app/driver-registration/components/fields.tsx
- src/app/driver-registration/components/steps.tsx
- src/app/driver-registration/components/success.tsx
- src/app/driver-registration/components/welcome-hero.tsx
- src/app/driver-registration/components/wizard.tsx


## Implemented design and verification

The app direction is achromatic-ledger (seed1384398047), with existing Inter/Cairo and semantic status colours. The public direction is type-only-statement (seed1209014620). Four sections were redrawn because the original three plans, supplied platform logos, ten workflow steps and actual CTA destinations did not match the dealt content assumptions.

Implemented flat shared surfaces, quiet KPI strips, consistent controls/dialogs, visible keyboard/touch actions, logical RTL alignment, stable active navigation, responsive auth/platform layouts, progressive content visibility, and public module filtering/illustrative cost estimation. No new dependencies, business-data rewrites or external provider actions.

Local pre-upstream checks:2,111 unit tests,332 release guards, types, lint (zero errors/49 retained warnings), optimized production build and invoice PDF runtime asset verification passed on unchanged source. Independent review found and repaired two dark-theme contrast regressions; destructive foreground/background pairs measure6.50:1/light and6.96:1/dark.

## Upstream reconciliation required before release

Master847ac6fa154de6e1fb04967c908f6100e206cbcc was released by another process during this work. Its ADR020 supersedes ADR015 and establishes a light semantic sidebar; retain that current direction during integration. Preserve its driver save/resume, National Address, gated ZATCA, source-specific transmission and cache work, together with this branch’s guarded CRUD and reference invoice data. Previously tested23-migration backup/cutover preparation is stale against the new121-version production baseline.

Do not treat the local checks above as merged-candidate or production approval. The integrated candidate needs complete checks, authenticated EN/AR/light/dark visual verification, hosted acceptance and the current backup/cutover rehearsal before merge/promotion. Exact PDF sample identity and authority acceptance remain separate evidence requirements.
