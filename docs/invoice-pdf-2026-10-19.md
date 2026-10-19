# Invoice PDF output — 19 October 2026

The latest request replaces strict imitation of the original Letter sample with
a clean modern invoice. The newly supplied PDF showed browser-added date/title,
`about:blank` and page-count text. Browser print settings can add those even
with zero CSS page margins, so the invoice workflow now returns an actual PDF
rather than asking the browser to print an HTML popup.

## Output and workflow

- A4, restrained navy/white styling, embedded OFL-licensed Cairo, bilingual
  headings, isolated phone/IBAN direction, six readable financial columns and
  a clear total. Missing optional fields and redundant zero-payment rows are
  omitted. Stored line, VAT, adjustment, payment and invoice values are retained.
- Download PDF saves the finished file with the invoice number. Open invoice
  for printing opens that same kind of PDF in the browser's PDF viewer; its
  normal print/download controls operate on the PDF, without HTML print headers.
- A compact bilingual internal/unvalidated QR label remains. The fuller ZATCA
  explanation stays in the app's print dialog. This is not an official Phase 2
  QR, authority acceptance, a signed tax artifact or certified PDF/A-3/XML delivery.
- Generated PDFs are private, stored under tenant/invoice/content-hash paths,
  and referenced from the existing generated-document record with format,
  layout version and SHA-256. Reprints do not overwrite earlier file contents.
  Historic HTML files are not rewritten in bulk. Generating a document does
  not claim that a physical printer has printed it.

## Runtime boundary

`POST /api/invoices/[id]/pdf` requires a same-origin request, an assured active
session and `invoices:print`. Options only accept an optional bank UUID, whose
tenant, currency and active state are checked during generation. The shared
database/Redis limiter allows ten PDF requests per minute per authenticated
user and fails closed on backend failure. Errors have English/Arabic messages
and never return raw renderer/database details.

The Node.js renderer uses pinned `@sparticuz/chromium` 153.0.0 and
`playwright-core` 1.62.1, a new browser/context per render, JavaScript disabled,
all non-inline network requests blocked, a 45-second browser deadline, two
simultaneous renderers per warm process, and 4 MiB input/output limits. Fonts,
logo and QR are embedded; rendering does not download a browser or external
assets at request time. The function has a 60-second limit. Deployment tracing
explicitly includes the packaged browser binaries and invoice font.

On Windows/macOS local development, set the non-secret
`INVOICE_CHROMIUM_EXECUTABLE_PATH` to an installed compatible Chromium. For a
local Playwright installation its path is available from
`require('playwright-core').chromium.executablePath()`. Vercel ignores this
override and uses the bundled Linux binary. No production secret is required.

## Verification

Tests cover origin/session/permission/rate guards, rejected arbitrary HTML and
options, safe filenames and private response headers; renderer cleanup,
concurrency, asset waiting and network denial; tenant-scoped financial reads,
private stored bytes/hash and failure behavior; client rejection of login HTML
or malformed PDFs and Arabic error selection.

`scripts/verify-invoice-print.mjs` renders a one-page short A4 invoice, checks
unclipped cells, authoritative totals and absence of browser/application
metadata, and extracts all 60 line markers from a multipage PDF. The real server
renderer was also exercised locally with network blocking and disabled JS.
The hosted invoice release harness now downloads the actual PDF, exercises a
503/retry, checks amounts/status/internal-QR disclosure and matches the downloaded
bytes to the private retained artifact's hash. Current exact-commit CI and hosted
results are recorded in PR 76 after execution; local success alone does not
confirm Linux/Vercel packaging or production deployment.

No database migration, production-data repair, permission change or secret
change is required by this feature. Overall launch remains conditional on the
other module, ZATCA, genuine company setup and operational requirements in the
production module review.
