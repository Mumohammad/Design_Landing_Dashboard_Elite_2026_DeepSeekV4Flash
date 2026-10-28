# ZATCA configuration and verification

Production integration is incomplete and disabled in code. Adding credentials or setting a flag cannot enable it. This replaces the older, incorrect description of a configuration-only production release.

## Current gates

`src/lib/release/integrations.ts` opens ZATCA onboarding and submission **only** when a valid non-production gateway is configured (`ZATCA_MODE=sandbox|simulation` plus the matching official URL, `zatcaNonProductionEnabled()`); otherwise both are rejected before database access. `zatca-config.ts` independently rejects production mode, including when `ZATCA_PRODUCTION_ENABLED=true`. The browser cannot read these variables, so the accounting ZATCA tab uses the server action `getZatcaStatus()` (`zatca-management.ts`) to decide what is enabled.

| Configuration | Transport behavior |
|---|---|
| No `ZATCA_MODE`, no gateway | Offline mock. Its `reported`/`cleared` values are simulated, with `sandbox: true` and `NOT_VALIDATED`. |
| `ZATCA_MODE=mock` and a gateway URL | Error; credentials/URLs cannot silently enable networking. |
| `sandbox` | Requires exactly `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal`. Transport accepts only an application-stamped invoice (XAdES + Phase 2 QR from `zatca-signer.ts`) with its hash, UUID and a tenant CSID, then POSTs the official JSON envelope (`invoiceHash`, `uuid`, base64 `invoice`) to `/invoices/reporting/single`, `/invoices/clearance/single` or `/compliance/invoices` (Basic auth, `Accept-Version: V2`, no redirects, 30 s timeout). Status comes from the response body only. |
| `simulation` | Requires exactly `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation`. Same contract as `sandbox`. |
| `production` | Rejected, regardless of credentials or flags. |

Gateway modes reject non-HTTPS URLs, other hosts/paths, credentials in URLs, ports, query strings and fragments. Missing or unsupported configuration never becomes a simulated success. The former invoice HTTP path was removed: a missing signature placeholder silently left XML unsigned, the body was not the required JSON envelope, and an HTTP success was incorrectly mapped to acceptance. Supplying a certificate/key cannot re-enable that path. Gateway bodies must remain excluded from errors/logs because they may contain invoice or credential data.

Stored CSIDs are scoped to tenant, environment and kind. Their table has RLS enabled and no client policies. Only authorized server code may access certificates, secrets and private keys. Browser summaries contain no credential characters. A sandbox credential of kind `production` is still a sandbox credential, not production onboarding.

## Invoice QR

The current print path creates an **internal, unvalidated five-field QR**. It now encodes TLV bytes as Base64 text before QR rendering, as the official specification requires. This fixes encoding, not Phase 2 integration. Its timestamp is document-generation time. Financial finalization time already exists, but the print/official issuance workflow does not yet establish the required legal issuance timestamp. Reprinting must not be treated as a new valid tax issuance.

The app and generated print/PDF disclose the internal status. The QR does not prove authority acceptance. Standard tax invoices require the clearance flow; simplified tax invoices use reporting and the EGS's certificate-bound cryptographic stamp. A sample SDK signature is not a tenant signature. An ordinary browser PDF is not PDF/A-3 with embedded XML; the required XML delivery/retention path remains outstanding.

## Offline SDK verification

The initial supplied package reports **SDK 3.0.8**, with an expired public demonstration certificate. The current [public developer portal](https://sandbox.zatca.gov.sa/downloadSDK) lists **3.4.8**. Its official Java 11 archive was downloaded on 19 October 2026, passed ZIP CRC checks and reports **238-R3.4.8** internally. Its computed archive SHA-256 is `91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6`. This is a local integrity record, not a claim of a published vendor checksum. Do not run either install script: the harness runs the selected JAR with a temporary config, leaving global settings alone.

```powershell
node scripts/verify-zatca-sdk.mjs 'C:\path\to\the\official-sdk-folder'
```

Alternatively set `ZATCA_SDK_ROOT` locally. No Supabase/Vercel credentials or application `.env` files are needed. The harness explicitly allows only the reviewed SDK version/certificate pairs and checks the public demonstration key matches the certificate. It rejects customized credentials and unreviewed versions. The 3.4.8 public sample certificate expires in January 2029; validity dates do not make it a taxpayer credential. Synthetic XML/logs remain under ignored `supabase/.temp/zatca-sdk-verification/` for 3.0.8 and `supabase/.temp/zatca-sdk-verification-238-R3.4.8/` for the current package. Successful validation stages are required; an exit code alone is insufficient.

The suite builds standard/simplified invoices, credit notes, debit notes and discounted invoices with the application UBL builder, then uses the **SDK sample signer**, followed by SDK validation. It compares application/SDK hashes for signed and unsigned documents, tests five text/encoding variants and requires tamper rejection. The current package adds a ninth explicit-UTC fixture and independently binds QR fields to the invoice hash, signature, certificate key and CA signature, comparing the application's candidate encoder byte for byte with the SDK. This is a bounded format/hash regression, not validation of a complete application signer, certificate trust/revocation, genuine onboarding, live API requests or authority acceptance. Never reuse the public sample key or its output for customer invoices.

### Canonicalization and signature boundary

`zatca-canonical.ts` removes `ext:UBLExtensions`, `cac:Signature` and the `cac:AdditionalDocumentReference` whose direct `cbc:ID` is `QR`, retaining surrounding whitespace. `computeInvoiceHash` hashes that canonical representation rather than raw XML. The implementation deliberately supports only the controlled XML 1.0 namespace/prefix profile emitted by our builder and the supplied SDK. It rejects DTD/entities, processing instructions, external-root comments, XML namespace attributes (`xml:base/id/lang/space`), namespace changes, unsupported attributes, malformed input and oversized/deep documents. It uses the common C14N 1.0/1.1 subset; it does **not** register a 1.0 implementation under a 1.1 algorithm URI or claim to handle arbitrary external XML.

The supplied SDK demonstration signature verifies with SHA256/ECDSA over the raw 32-byte invoice digest, not the former invented digest/time concatenation. That observation alone does not resolve the published XMLDSig requirement to bind canonical `SignedInfo`, including `SignedProperties`. The primitive helper is explicitly labeled SDK-observed, and cannot transmit an invoice. Complete certificate-bound XAdES/QR construction and this SDK/specification discrepancy remain unresolved before any official submission.

The independent [Phase 2 QR investigation](ZATCA-QR.md) found that **3.0.8** puts SPKI in tag 7 and signature `r`/`s` in tags 8/9. That legacy finding does not apply to all versions: **3.4.8** uses the published signature/key/CA-signature assignments. Its UTC-source fixture supplies the independent positive comparison for the text-digest/signature candidate. The current SDK converts a zoned `IssueTime` to JVM-local QR time without a suffix; the harness pins `Asia/Riyadh` and explicitly chooses the offset-less UTC+03 convention. The candidate requires a time profile and never infers it. The preparation helper/ledger and legal issuance workflow still need integration with a verified time profile. No immutable preparations are rewritten and no print or submission path is enabled.

## Application signer (Phase 2)

`src/lib/accounting/zatca-signer.ts` produces the XAdES enveloped signature in the SDK layout (certificate digest, SignedProperties digest, ECDSA signature over the invoice hash) and the nine-tag QR read back from the signed XML. `scripts/verify-zatca-app-signer.mjs <sdk>` validates application-signed simplified/standard invoices and notes with the official SDK 3.4.8 offline (Java 11), plus tamper and SignedProperties negative controls; all cases pass. `submitPreparedZatcaDocument` (server action) signs a prepared issuance with the tenant CSID, transmits it and appends the attempt to `zatca_submission_attempts` (append-only, service-role only).

`scripts/verify-zatca-sandbox-live.mjs` (opt-in `ZATCA_LIVE_SANDBOX=yes`, synthetic data, public sandbox OTP) was run against the developer portal on 28 October 2026 with owner approval:

| Step | Result |
|---|---|
| Compliance CSID (application-built CSR) | Issued |
| Standard invoice / credit note / debit note — compliance check | `cleared`, validation PASS, 0 warnings, 0 errors |
| Simplified invoice / credit note / debit note — compliance check | `reported`, validation PASS, 0 warnings, 0 errors |
| Production CSID request | Issued |
| Clearance/reporting with that CSID | Not exercised: the developer portal returns a fixed sample certificate not bound to the CSR key; the signer correctly refuses it (`KEY_MISMATCH`). Core-pipeline submission with a key-bound production CSID needs the simulation portal and the taxpayer's own onboarding. |

The first live run exposed a CSR defect: the request body must be Base64 of the **PEM text** (`zatcaCsrRequestPayload`), and the CSR must mirror the SDK (subject C as PrintableString, OU/O/CN UTF8; extension request with only the certificate-template name and the SAN directory name SN/UID/title/registeredAddress/businessCategory; no basicConstraints/keyUsage). Both are fixed and unit-tested. This is developer-portal evidence only; it is not production onboarding or authority approval.

### Event-driven adapter

`runZatcaAdapter` (`zatca.ts`) no longer sends unsigned XML in network modes. Each finalized sales invoice/note is prepared on the tenant's EGS issuance stream (`prepareZatcaDocument`: ICV/PIH chain, replayed on retry so no counter is consumed twice), signed with the stored CSID key and cleared (buyer has a valid VAT number → standard) or reported (simplified) via `submitPreparedZatcaDocument`. It fails closed, before preparation, when the seller or a Saudi standard-invoice buyer lacks a complete National Address, when the seller VAT number is invalid, or when no EGS stream exists. Rejections and gateway failures are recorded as `rejected`/`failed`, never as reported. Offline mock mode is unchanged and still labelled mock.

### Accounting fixes (28 October 2026)

- **Issue date/time are Riyadh-local** (`20261028130000_zatca_issue_time_riyadh.sql`, `riyadhLocal`). Recording UTC put documents issued 21:00–24:00 UTC on the previous calendar day, i.e. in the wrong VAT period at month/quarter end, and disagreed with the QR timestamp. `issued_at` stays an absolute timestamp.
- **One transmission per source document** (`20261028132000_zatca_transmission_source.sql`). The old key (tenant, invoice, doc type) filed notes under their reference invoice, so a second credit note against the same invoice was treated as already reported and never sent.
- **Structured National Address** (`20261028131000_zatca_national_address.sql`): building/additional number, district and postal code on the company profile; city, district, building/additional number, postal code and country on customers and suppliers, with format checks in the database, server actions and forms. The adapter previously selected a non-existent `customers.city`, which silently fell back to a walk-in buyer.
- **Printed QR from authority evidence** (`zatca-document-qr.ts`): a sales invoice PDF uses the QR from ZATCA's cleared XML (standard) or the EGS-stamped reported XML (simplified) from the latest accepted attempt, labelled with its sandbox/simulation environment; compliance checks never count. Otherwise the disclosed internal QR is used.
- **CSID validity**: the signer refuses a certificate outside its validity window (`CERT_EXPIRED`) so expired CSIDs are renewed rather than used.
- Company VAT number must be 15 digits starting and ending with 3.

### Onboarding and monitoring (28 October 2026)

- **Onboarding** (`onboardZatcaCsids`): 6-digit OTP; production refused; the environment must match the configured gateway. The seller VAT number and complete National Address are required (no demo values). An existing EGS stream's serial is reused for renewals so the ICV/PIH chain continues; otherwise `1-EliteDev|2-Dashboard|3-<uuid>`. Certificate validity dates are stored.
- **Compliance checks** (`zatca-compliance-checks.ts`): before requesting the production CSID, six test documents (standard/simplified × invoice/credit/debit note) are signed with the compliance certificate on a private ICV/PIH chain with a synthetic buyer and sent to `/compliance/invoices`. All must be cleared (standard) or reported (simplified), otherwise onboarding stops and the results are audited and shown. They never touch the tenant's legal stream or ledger.
- **Stream registration**: on success the `zatca_issuance_streams` row (genesis PIH, counter 0) is created once.
- **Automatic submission**: finalizing a sales invoice or issuing a note prepares and submits it immediately (the preparation time is the legal issue time, within the DB's 300-second window). If the user lacks *accounting: approve*, the tenant's registered operator (`zatca_automation`, set at onboarding, re-authorized by `zatca_operator_authorized` on every run) is used. The daily Vercel cron `/api/cron/zatca` (CRON_SECRET bearer, fail-closed) retries anything pending.
- **Go-live cutoff and idempotency**: documents finalized before the EGS stream was registered for the configured environment are never submitted. A document counts as done only when accepted *in that environment*; mock or other-environment acceptance is not evidence.
- **Readiness panel**: the ZATCA tab shows tax-profile gaps, the EGS stream and ICV, certificate days left (warning ≤ 30 days, expired), and the submission backlog (`zatca-backlog.ts`): finalized documents without a reported/cleared transmission, with those open for more than 24 hours flagged overdue.

See [ZATCA-GO-LIVE.md](ZATCA-GO-LIVE.md) for the step-by-step go-live runbook.

## Remaining implementation and release evidence

1. Enter the genuine taxpayer National Address and register EGS issuance streams per branch/device; verify the VAT registration with the business owner. Structured address columns, validation and forms now exist. Never fill production data with SDK sample values.
2. The adapter now prepares, signs, submits and retains signed/cleared artifacts (`zatca_submission_attempts`). The 24-hour backlog monitor now exists in the ZATCA tab. Still open: treating the preparation time as the legal issue time in the finalization workflow itself (today preparation happens when the adapter runs), and a scheduled run/alert rather than the manual adapter button.
3. Expand the bounded application hash coverage as tax cases are added; implement the complete certificate-bound XAdES stamp and resolve the SDK/signature-standard discrepancy above. Validate application-produced signatures/QR with the current official SDK, including all supported tax and adjustment cases.
4. Implement and validate the official JSON request/response contract before replacing the blocked transport. Preserve explicit authority status, validation results and cleared XML/QR, and reject ambiguous success.
5. Complete real EGS compliance/simulation onboarding and all required invoice/note checks with genuine authorized credentials. Test retry/idempotency, rejection, certificate expiry/revocation and evidence retention.
6. For standard tax invoices, print the QR from the accepted cleared invoice. For simplified documents, print the validated EGS-stamped QR and retain reporting evidence. Historical mocks never satisfy either requirement.
7. Only after evidence review may the code gate change. Production credential installation/rotation requires explicit owner approval. Never place OTPs, secrets or private keys in chat, logs, source, test artifacts or browser responses.

The older `verify-zatca-phase18-*` scripts are development seam probes, not launch gates. Prefer the bounded offline harness above; do not point legacy probes at production or interpret a primitive sign/verify round trip as an official validation result.

## Primary references

- [ZATCA Security Features Implementation Standards v1.2](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf), signature transforms, PIH and QR sections.
- [W3C Canonical XML 1.1](https://www.w3.org/TR/xml-c14n11/), XML 1.0 applicability and XML-attribute inheritance/base handling.
- [ZATCA XML specifications](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx).
- [Official SDK page](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx), including the distinction between SDK validation and authority approval.
