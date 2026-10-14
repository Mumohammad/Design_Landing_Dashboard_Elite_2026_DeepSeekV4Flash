# Invoice print reference — 14 October 2026

The invoice renderer follows the supplied one-page reference: US Letter (612 × 792 points), a 487.5-point content area, Tahoma typography, right-side logo/company details, left-side title/QR, double divider, eight-column RTL item table, left-side totals and right-side bank footer. Print and browser Save as PDF use the same HTML. Logo/QR images are embedded; printing waits for fonts and image decoding.

The app offers a print dialog with an optional receiving bank. Bank selection is checked against the current tenant, active/deleted state and invoice currency. Payment totals come from the linked AR/AP record. Printing now refuses a missing/invalid company VAT number instead of inventing one. Stored net amounts and VAT are displayed separately; gross line amounts include VAT, and line discounts are not deducted twice.

## Verification

- Reference-sized PDF and 60-line pagination render checks in scripts/verify-invoice-print.mjs; intermediate PDFs/screenshots remain in ignored supabase/.temp.
- Nine template regression cases cover money, mixed VAT, discounts, currency/precision, HTML escaping, bank details and document identity.
- Print helper tests verify asset readiness, failed image handling and closed windows.
- The authenticated local invoice workflow tests the print action, loaded logo, gross VAT total, draft marker and PDF generation in addition to CRUD.
- CI runs all tests, lint, types, build, local database/integration/browser checks and the standalone print rendering check. Check the PR for exact-commit results.

## Scope and release limits

- Invoice/customer/company/QR content is dynamic. The supplied private PDF and customer/contact fixture values are not committed. Automated fixtures are synthetic.
- The renderer supports an optional item name; current invoice records store a description and line number, so existing app invoices use the line number in the Item column. This change does not invent item names or alter financial calculations to match example numbers.
- Tahoma is used when installed (the reference and local visual review used Windows). Other systems fall back to Arial/sans-serif; licensed Tahoma binaries are not redistributed. Browser paper/scale/header settings affect output. Use Letter, 100%, headers/footers off.
- Existing application branding supplies the embedded logo. This is not a new tenant-branding management feature, direct PDF download service, or ZATCA certification.
- No hosted data/schema/secret changes, merge or deployment are included. Existing staging and recovery release gates still apply.
