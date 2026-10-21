# Phase 2 QR format investigation — 19 October 2026

Production QR/signing remains blocked. The invoice print path continues to show its disclosed internal five-field QR. No customer invoice, certificate, secret, database row or integration flag was changed for this investigation.

## Historical finding in the supplied SDK 3.0.8

The supplied folder is named `zatca-envoice-sdk-203`, while its application reports version **3.0.8**. Its public demonstration certificate expired in April 2024. The offline runner pins that public certificate and verifies that the bundled demonstration key matches it; it refuses customized credential files. The current official portal now lists 3.4.8; this section describes only the older package.

The application-built simplified invoice passes that SDK's own signing and validation stages. Independently decoding the resulting QR gives:

| Tag | Published v1.2 field assignment | Supplied SDK 3.0.8 demonstration output |
| --- | --- | --- |
| 1–5 | Seller, VAT number, timestamp, invoice total, VAT total | Corresponding UTF-8 text |
| 6 | XML invoice hash | 44-byte Base64 digest text |
| 7 | ECDSA signature of the XML hash | 88-byte SPKI public key DER |
| 8 | ECDSA public key | Invoice signature's DER `r` integer bytes, including any sign-padding zero |
| 9 | Technical CA signature for simplified documents | Invoice signature's DER `s` integer bytes, including any sign-padding zero |

The runner verifies these identities byte for byte against the signed invoice's canonical digest, certificate public key and DER signature. It retains only tag numbers/lengths and boolean comparisons in `qrLayoutAudit` in ignored `evidence.json`. This is an observed discrepancy in the supplied demonstration output, not a claim about all SDK versions or a substitute for authority validation. Its successful SDK result cannot certify the QR as production compatible.

There is a separate encoding ambiguity to resolve: Security Features v1.2 section 4.1 describes tag 6 as a 32-byte hash while also describing UTF-8 values in its encoding sequence. The supplied output uses 44-byte Base64 text. Do not silently choose an encoding based on what one demonstration validator accepts.

## Current official SDK 3.4.8

The [public developer portal](https://sandbox.zatca.gov.sa/downloadSDK), version-history section, provides the Java 11 archive `zatca-einvoicing-sdk-Java-238-R3.4.8.zip`. Its internal application version is **238-R3.4.8**. The downloaded archive's computed SHA-256 is `91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6`; ZIP CRC/path checks passed before isolated extraction. This is an integrity record for the official-channel download, not a vendor-published checksum. No installer was run. The new public demonstration certificate is separately pinned, and expires in January 2029. The bundled demonstration key is publicly distributed and must never sign customer invoices.

This version uses signature at 7, SPKI at 8 and the CA signature at 9 on simplified documents. The harness preserves the original eight cases, adds an explicit `IssueTime=09:30:00Z` case, and independently compares these QR fields with the signed XML/certificate. The current SDK uses Base64 text for the digest/signature fields. The application candidate encoder must reproduce that UTC fixture's QR bytes exactly, and the decoder must reject it under the binary experiment. Results are recorded on the release PR after execution; these checks do not certify production use.

The current SDK converts a zoned invoice time into JVM-local QR time and omits the zone suffix. The harness pins `Asia/Riyadh`: source `09:30:00Z` becomes QR `12:30:00`. Bare source times remain unqualified. The candidate therefore requires an explicit time convention as well as an encoding profile: `utc` requires `Z`; `offsetless-plus03` requires suffix-less calendar text interpreted as UTC+03. The encoder retains supplied text; it does not convert or infer the source time. Tests reject missing/mismatched conventions, malformed dates and overflow. Integrating a real legal issuance time/profile with the preparation helper and database fence remains work; editing retained XML would change its hash and is not a valid migration or retry strategy.

## New offline format primitive

`zatca-phase2-qr.ts` provides a bounded candidate encoder and strict decoder. Both require an explicit experimental profile: `binary-digest-signature` or `base64-text-digest-signature`. Neither is an approved production profile. Tag assignments remain signature at 7, SPKI public key at 8, and certificate signature at 9 for simplified documents. Standard documents have eight tags; simplified documents/notes have nine. Candidate creation rejects a production environment even if TypeScript is bypassed.

Checks include ordered unique tags, complete single-byte lengths, canonical Base64, strict UTF-8, explicit time conventions, VAT-number format, exact decimal amount text, 32-byte invoice digest, minimal positive DER ECDSA scalars, secp256k1 SPKI encoding and the 700-character bound. Amounts are supplied by the financial engine and are not recomputed. Certificate issuer signatures are parsed separately from the EGS key's scalar range.

These checks prove format only. They do **not** verify certificate issuance/trust/expiry/revocation, registration, the certificate's relation to a taxpayer, invoice-signature validity, binding to source XML, XAdES properties, clearance or reporting. The encoder accepts public signature/certificate bytes, not a private key. It is not imported by the print path, legal issuance workflow, credential reader, adapter or transport. It does not create an official QR or turn a fabricated signature into trusted evidence.

## Required next evidence

The current SDK is now available and its corrected tag mapping can be tested independently. Complete the **application's signer** and resolve its `SignedInfo`/`SignedProperties` binding and legal time profile, then test with genuine non-production certificate onboarding, supported invoice/note/tax cases, positive/tampered controls and authority responses. Retain signed/cleared XML and use its QR as appropriate for the document kind. No flag should be enabled merely because the candidate encoder, a primitive ECDSA round trip or SDK demonstration output passes.

Primary source: [ZATCA Security Features Implementation Standards v1.2, 19 May 2023](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf), sections 2.3 and 4.1, pages 19–26. The public PDF was fetched directly and its tag table checked for this investigation. [Official SDK download page](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx).
