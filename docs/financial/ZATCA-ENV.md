# ZATCA configuration and verification

Production integration is incomplete and disabled in code. Adding credentials or setting a flag cannot enable it. This replaces the older, incorrect description of a configuration-only production release.

## Current gates

`src/lib/release/integrations.ts` rejects application onboarding and submission before database access. `zatca-config.ts` independently rejects production mode, including when `ZATCA_PRODUCTION_ENABLED=true`.

| Configuration | Transport behavior |
|---|---|
| No `ZATCA_MODE`, no gateway | Offline mock. Its `reported`/`cleared` values are simulated, with `sandbox: true` and `NOT_VALIDATED`. |
| `ZATCA_MODE=mock` and a gateway URL | Error; credentials/URLs cannot silently enable networking. |
| `sandbox` | Requires exactly `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal`. Invoice transport rejects before credential access/networking until signing/API validation is complete. Separate onboarding primitives remain development-only. |
| `simulation` | Requires exactly `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation`. Invoice transport rejects before credential access/networking until signing/API validation is complete. Separate onboarding primitives remain development-only. |
| `production` | Rejected, regardless of credentials or flags. |

Gateway modes reject non-HTTPS URLs, other hosts/paths, credentials in URLs, ports, query strings and fragments. Missing or unsupported configuration never becomes a simulated success. The former invoice HTTP path was removed: a missing signature placeholder silently left XML unsigned, the body was not the required JSON envelope, and an HTTP success was incorrectly mapped to acceptance. Supplying a certificate/key cannot re-enable that path. Gateway bodies must remain excluded from errors/logs because they may contain invoice or credential data.

Stored CSIDs are scoped to tenant, environment and kind. Their table has RLS enabled and no client policies. Only authorized server code may access certificates, secrets and private keys. Browser summaries contain no credential characters. A sandbox credential of kind `production` is still a sandbox credential, not production onboarding.

## Invoice QR

The current print path creates an **internal, unvalidated five-field QR**. It now encodes TLV bytes as Base64 text before QR rendering, as the official specification requires. This fixes encoding, not Phase 2 integration. Its timestamp is document-generation time. Financial finalization time already exists, but the print/official issuance workflow does not yet establish the required legal issuance timestamp. Reprinting must not be treated as a new valid tax issuance.

The app and generated print/PDF disclose the internal status. The QR does not prove authority acceptance. Standard tax invoices require the clearance flow; simplified tax invoices use reporting and the EGS's certificate-bound cryptographic stamp. A sample SDK signature is not a tenant signature. An ordinary browser PDF is not PDF/A-3 with embedded XML; the required XML delivery/retention path remains outstanding.

## Offline SDK verification

The user supplied a package whose application reports **SDK 3.0.8**. It includes a public, expired demonstration certificate. Do not install its Windows batch script: it edits the user's PATH. The repository harness runs Java directly with a temporary config and leaves global settings alone.

```powershell
node scripts/verify-zatca-sdk.mjs 'C:\path\to\the\official-sdk-folder'
```

Alternatively set `ZATCA_SDK_ROOT` locally. No Supabase/Vercel credentials or application `.env` files are needed. The harness refuses an unreviewed SDK certificate, uses synthetic companies/invoices only, and keeps XML/logs under ignored `supabase/.temp/zatca-sdk-verification/`. It requires explicit successful validation stages because SDK 3.0.8 can exit zero on failure.

The suite builds standard/simplified invoices, credit notes and debit notes with the application UBL builder, then uses the **SDK sample signer**, followed by SDK validation. It also compares application-computed hashes with SDK hash generation for unsigned and signed documents, exercises Arabic/Unicode, CRLF, comments, CDATA and attribute quoting, and requires rejection of a tampered signed invoice. This establishes a bounded format/hash regression. It does not validate a complete application signer, certificate validity, real onboarding, current SDK version, live API requests, production credentials, or acceptance by ZATCA. Never reuse its XML, QR or sample key for customer invoices.

### Canonicalization and signature boundary

`zatca-canonical.ts` removes `ext:UBLExtensions`, `cac:Signature` and the `cac:AdditionalDocumentReference` whose direct `cbc:ID` is `QR`, retaining surrounding whitespace. `computeInvoiceHash` hashes that canonical representation rather than raw XML. The implementation deliberately supports only the controlled XML 1.0 namespace/prefix profile emitted by our builder and the supplied SDK. It rejects DTD/entities, processing instructions, external-root comments, XML namespace attributes (`xml:base/id/lang/space`), namespace changes, unsupported attributes, malformed input and oversized/deep documents. It uses the common C14N 1.0/1.1 subset; it does **not** register a 1.0 implementation under a 1.1 algorithm URI or claim to handle arbitrary external XML.

The supplied SDK demonstration signature verifies with SHA256/ECDSA over the raw 32-byte invoice digest, not the former invented digest/time concatenation. That observation alone does not resolve the published XMLDSig requirement to bind canonical `SignedInfo`, including `SignedProperties`. The primitive helper is explicitly labeled SDK-observed, and cannot transmit an invoice. Complete certificate-bound XAdES/QR construction and this SDK/specification discrepancy remain unresolved before any official submission.

## Remaining implementation and release evidence

1. Persist genuine structured taxpayer/branch addresses and EGS identities; verify VAT registration with the business owner. Never fill production data with SDK sample values.
2. Integrate the [non-production preparation ledger](ZATCA-ISSUANCE.md) into the genuine legal issuance workflow. The new ledger stores preparation UUID/time/counter/PIH/XML/source snapshots atomically, with independent note identities and tested concurrency. It does not establish historical legal issue times or yet retain signed/cleared artifacts and authority-attempt evidence.
3. Expand the bounded application hash coverage as tax cases are added; implement the complete certificate-bound XAdES stamp and resolve the SDK/signature-standard discrepancy above. Validate application-produced signatures/QR with the current official SDK, including all supported tax and adjustment cases.
4. Implement and validate the official JSON request/response contract before replacing the blocked transport. Preserve explicit authority status, validation results and cleared XML/QR, and reject ambiguous success.
5. Complete real EGS compliance/simulation onboarding and all required invoice/note checks with genuine authorized credentials. Test retry/idempotency, rejection, certificate expiry/revocation and evidence retention.
6. For standard tax invoices, print the QR from the accepted cleared invoice. For simplified documents, print the validated EGS-stamped QR and retain reporting evidence. Historical mocks never satisfy either requirement.
7. Only after evidence review may the code gate change. Production credential installation/rotation requires explicit owner approval. Never place OTPs, secrets or private keys in chat, logs, source, test artifacts or browser responses.

The older `verify-zatca-phase18-*` scripts are development seam probes, not launch gates. Prefer the bounded offline harness above; do not point legacy probes at production or interpret a primitive sign/verify round trip as an official validation result.

## Primary references

- [ZATCA Security Features Implementation Standards](https://www.zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards.pdf), signature transforms, PIH and QR sections.
- [W3C Canonical XML 1.1](https://www.w3.org/TR/xml-c14n11/), XML 1.0 applicability and XML-attribute inheritance/base handling.
- [ZATCA XML specifications](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx).
- [Official SDK page](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx), including the distinction between SDK validation and authority approval.
