# Reference invoice fonts

The reference layout uses Tahoma regular and bold. Cairo remains the bundled fallback; its glyph metrics differ, so that fallback must not be described as identical to the sample.

Only an operator-provided package with rights for server use and PDF embedding may enable the reference font. No Windows system fonts are committed, uploaded, or installed by this implementation.

## Private server packaging

Place the licensed TrueType files at `private/invoice-fonts/regular.ttf` and `private/invoice-fonts/bold.ttf` in the clean deployment source. Set the existing server-only `INVOICE_REFERENCE_FONT_DIR` variable to `bundled`. Next's PDF-route trace explicitly includes only those fixed files; the directory is ignored by Git and never placed under `public/`. The deployment ignore file permits only those two files under `private/`. A clean Git checkout will not contain licensed assets: the operator must provision them through the release packaging step before building. Do not enable the variable until both files are provisioned and the exact deployment package is verified.

Alternatively, a host with a separately provisioned private mount may set an absolute directory path. Relative paths, URLs, files under `public/`, escaping symlinks, invalid TrueType signatures and files over 2 MiB are rejected. Invalid configured assets stop invoice generation before upload; errors do not expose the operator path.

After packaging, inspect the PDF route's file trace and render with the actual Linux runtime. Compare the reference fixture and a multipage invoice, checking Arabic shaping, every line, totals, page boundaries and the required internal-QR disclosure. Font configuration alone does not establish visual identity or official ZATCA issuance.

The owner supplied the licensed regular/bold package on 23 October 2026. Both files identify as Tahoma, include Arabic glyphs and declare editable PDF embedding (OS/2 fsType 8). They have been provisioned into the ignored private packaging directory. Production-runtime tracing, rendering and the sample comparison remain release checks; local visual comparisons alone do not establish a deployed result.
