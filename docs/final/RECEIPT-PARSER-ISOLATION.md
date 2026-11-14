# Receipt decoding resource boundary

Receipt suggestions for Telegram and expense-claim uploads use a separate trusted
Node program, `workers/receipt-extract.cjs`. The original attachment is retained;
decoded values remain unverified suggestions. Recognizing TLV QR fields does not
authenticate a signature or establish ZATCA clearance/reporting.

## Runtime contract

- Bytes travel over IPC, without receipt filenames, temporary receipt files or
  request-controlled program paths. The worker inherits only a small operating
  system environment allowlist; application credentials and Node preload settings
  are excluded.
- One worker may run per application process. A busy parser returns no optional
  suggestions; users can complete the retained document manually. This is not a
  deployment-wide concurrency limit.
- Input is limited to 10 MiB. XML is limited to 256 KiB and rejects DTD/entities.
  PDF reading covers at most the first three pages of documents of at most 100
  pages. Text output is limited to 60,000 characters. Raster decoding has explicit
  pixel/frame limits, and PDF image candidates are bounded after extraction.
- The parent enforces a deadline of at most 25 seconds (20 seconds by default),
  observes child-process closure before resolving, and polls Linux RSS. The child
  also reports RSS and runs with a 128 MiB V8 heap limit. The 256 MiB RSS guard is
  sampled; native allocations may temporarily exceed it. It is not an OS memory
  quota or security sandbox.
- Invalid output, parser failure or exceeded budgets yield no suggestions. There
  is no inline PDF/image decoder fallback. If termination cannot be confirmed,
  the operation fails explicitly and its occupied slot remains until closure.
- QR search continues after unrelated base64 content. Its eligibility check
  matches the existing receipt decoder's minimum TLV/seller/VAT/total checks.

Bounded UBL field and PDF-text heuristic mapping still occurs in the request
process after decoding. It is not covered by the child's interruptible deadline.
UBL mapping is performed once. Full isolation of those existing heuristics is
separate work; do not claim every step of receipt processing is interruptible.

## Build and packaging

`pnpm build` uses a shell-independent Node runner. Only after a successful Next
build, Next's own dependency tracer adds the worker graph to the Telegram route
and expense-claim action/page manifests. Dynamic unpdf assets and installed Sharp
native packages and pnpm resolution links are included.

When extending the manifests, optional stale file hashes are removed and base
symlink indexes/targets are regenerated. Nonempty `additionalRoots` is explicitly
unsupported until cross-root symlink remapping is implemented.

The build then checks the manifests with installed Next's `mapNftFileEntries`,
checks function-size and private-file boundaries, and creates an isolated copy of
only the traced worker graph. Real synthetic PDF text and TLV QR-image decoding
must succeed there, without access to the original dependency tree. Probe files
are removed afterward. Invoice PDF bundle verification remains a separate gate.

## Evidence and acceptance limits

The new lifecycle and suggestion tests exercise actual synchronous child
termination, parent responsiveness, occupied-slot release, credential/preload
exclusion, malformed output, page/input limits, real QR images, and a PDF with an
unrelated QR preceding a valid receipt QR. They use synthetic local input and do
not call providers or mutate hosted data.

Windows checks alone do not establish Linux native packaging, Linux RSS behavior
or execution inside an assembled Vercel function. Exact-commit Linux CI, Preview
upload/receipt flows, hosted module acceptance and the broader release gates must
pass before Production release. This change does not close the durable Telegram
inbox, atomic receipt acceptance, database recovery or provider-validation work.
