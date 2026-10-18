# ZATCA implementation boundary

## 1. Status

The owner requested the official invoice/QR integration on 18 October 2026. Implementation and validation are in scope. **Production remains disabled in code**, not configuration-only. Existing adapter, cryptography, onboarding and transport modules are development seams; they do not establish a completed official integration.

The supplied SDK 3.0.8 exposed schema, discount, address, line-tax and PIH defects. The continuation corrects those bounded problems, adds an application canonical hash restricted to the generated UBL profile and compares it against SDK hash generation. Offline format validation still uses the SDK's demonstration signer. Passing that regression does not validate a complete application signer, real EGS onboarding, the live API contract or production QR. Invoice networking is independently blocked until those requirements are implemented and tested.

## 2. Financial boundary

- Consume immutable invoice/note and line amounts from the financial engines. Never invent VAT identities, exchange rates, timestamps or tax classifications.
- The invoice engine's subtotal already includes line discounts. Do not subtract them again or describe them as document-level allowances.
- Preserve independent issuance identity, sequence/hash-chain and evidence for each document, including rejected attempts and credit/debit notes.
- Database design for issuance metadata and artifacts must preserve tenant isolation, financial immutability and concurrency. Do not backfill historical business records with fabricated issue times.

## 3. Authority boundary

- Standard tax invoices use clearance; simplified documents use reporting. QR generation differs between those flows. A locally generated image is not automatically invalid, but it needs the correct validated invoice, stamp, certificate and authority workflow.
- Print the accepted cleared artifact for standard invoices. For simplified documents, use the validated certificate-bound EGS stamp/QR and preserve reporting evidence.
- Mocks and historical `reported`/`cleared` enum values are not authority acceptance. Show mock/unverified evidence prominently in UI and never use it to satisfy idempotency or launch gates for real submissions.
- Do not enable networking by supplying credentials alone. Keep the independent production gate closed until implementation and validation evidence are complete.

## 4. Credentials and verification

CSIDs belong to the tenant and target environment. Private keys, secrets and OTPs stay server-side; browser summaries and logs must contain none of their characters. No production secret changes or live business-data repairs without explicit owner approval.

See [ZATCA-ENV.md](ZATCA-ENV.md) for current gates, the offline SDK command, outstanding implementation and official sources. A public SDK demonstration certificate/key must never be used for a customer invoice. The supplied demonstration certificate is expired and its successful offline use is not evidence of certificate validity or authority acceptance.

## 5. Claims and release guardrails

- Do not claim ZATCA compliance, approval or certification without the corresponding verified evidence. The status-copy audit remains in the test suite.
- Keep the current print QR explicitly internal/unvalidated until it is replaced by the validated official document flow. Saved PDFs must preserve that disclosure.
- Use synthetic data in all tests. Do not copy the uploaded sample's zero VAT/IBAN placeholders into production.
- Require official SDK validation of the application output, real non-production onboarding/submission tests, immutable evidence retention, correct production configuration and post-deployment verification before launch.
