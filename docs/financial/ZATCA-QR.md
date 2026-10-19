# Phase 2 QR format investigation — 19 October 2026

Production QR/signing remains blocked. The invoice print path continues to show its disclosed internal five-field QR. No customer invoice, certificate, secret, database row or integration flag was changed for this investigation.

## Independent finding in the supplied SDK

The supplied folder is named `zatca-envoice-sdk-203`, while its application reports version **3.0.8**. Its public demonstration certificate expired in April 2024. The offline runner pins that public certificate and verifies that the bundled demonstration key matches it; it refuses customized credential files. It does not establish that this is the current SDK release.

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

## New offline format primitive

`zatca-phase2-qr.ts` provides a bounded candidate encoder and strict decoder. Both require an explicit experimental profile: `binary-digest-signature` or `base64-text-digest-signature`. Neither is an approved production profile. Tag assignments remain signature at 7, SPKI public key at 8, and certificate signature at 9 for simplified documents. Standard documents have eight tags; simplified documents/notes have nine. Candidate creation rejects a production environment even if TypeScript is bypassed.

Checks include ordered unique tags, complete single-byte lengths, canonical Base64, strict UTF-8, UTC seconds, VAT-number format, exact decimal amount text, 32-byte invoice digest, minimal positive DER ECDSA scalars, secp256k1 SPKI encoding and the 700-character bound. Amounts are supplied by the financial engine and are not recomputed. Certificate issuer signatures are parsed separately from the EGS key's scalar range.

These checks prove format only. They do **not** verify certificate issuance/trust/expiry/revocation, registration, the certificate's relation to a taxpayer, invoice-signature validity, binding to source XML, XAdES properties, clearance or reporting. The encoder accepts public signature/certificate bytes, not a private key. It is not imported by the print path, legal issuance workflow, credential reader, adapter or transport. It does not create an official QR or turn a fabricated signature into trusted evidence.

## Required next evidence

Obtain and verify the current official SDK and authoritative encoding/signature behavior; resolve the independently observed tag mapping and `SignedInfo` discrepancy. Then test the **application's complete signer** against that profile with genuine non-production certificate onboarding, supported invoice/note/tax cases, positive and tampered controls, and authority responses. Retain signed/cleared XML and use its QR as appropriate for the document kind. No flag should be enabled merely because the candidate encoder, a primitive ECDSA round trip or the older SDK's own output passes.

Primary source: [ZATCA Security Features Implementation Standards v1.2, 19 May 2023](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf), sections 2.3 and 4.1, pages 19–26. The public PDF was fetched directly and its tag table checked for this investigation. [Official SDK download page](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx).
