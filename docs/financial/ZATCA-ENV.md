# ZATCA — Environment Variables

Reference for the pluggable ZATCA seams:

- **Transmission transport** — `src/lib/accounting/zatca-transport.ts` (Phase 16 — ZATCA adapter).
- **Crypto seam** — `src/lib/accounting/zatca-crypto.ts` (Phase 18): ECDSA secp256k1 key generation, invoice hash / PIH chaining, digital signature, and the ZATCA CSR builder (onboarding).
- **Onboarding transport** — `src/lib/accounting/zatca-onboarding.ts` (Phase 18): two-step CSID onboarding (compliance CCSID → production PCSID).

The transmission transport has two modes selected purely by
environment configuration:

| Mode | Condition | Behavior |
|---|---|---|
| **Sandbox (default)** | `ZATCA_API_BASE_URL` **or** the production CSID credentials unset | Deterministic mock response per document (`reported`/`cleared` + stable UUID + `validationResults: PASSED` envelope). No network call, no real transmission. |
| **Production** | `ZATCA_API_BASE_URL` **and** `ZATCA_CSID_CERT` **and** `ZATCA_CSID_SECRET` all set | POSTs the UBL 2.1 payload to the ZATCA reporting/clearance endpoint with **Basic auth** `Authorization: Basic base64(<ZATCA_CSID_CERT>:<ZATCA_CSID_SECRET>)` — the documented ZATCA reporting auth (certificate + secret from the production CSID; the reporting API does **not** use a Bearer API key). |

`isSandboxTransport()` reports which mode is active; the adapter stamps the
mode into its audit log and the UI summary flash (e.g. "3 sent (sandbox)") so
a sandbox run can never be mistaken for a real one.

## Variables

| Variable | Required for production | Description |
|---|---|---|
| `ZATCA_API_BASE_URL` | Yes | Base URL of the ZATCA reporting/clearance API **without** a trailing slash, e.g. `https://sandbox.zatca.gov.sa` or your gateway's base URL. The adapter appends `/invoices/reporting/single` (standard/compliance invoices) or `/invoices/clearance/single` (clearance pipeline). |
| `ZATCA_CSID_CERT` | Yes | The **production CSID certificate** (`binarySecurityToken`) returned by the onboarding production-CSID step. Used as the username half of the Basic auth header. Never commit it — set it in the platform's secret store (Vercel env / secret manager) in production. |
| `ZATCA_CSID_SECRET` | Yes | The **production CSID secret** returned alongside the certificate. Used as the password half of the Basic auth header. Never commit it — set it in the platform's secret store. |
| `ZATCA_CSID_PRIVATE_KEY` | No | PKCS#8 PEM private key (secp256k1) bound to the CSID. When set, the transport cryptographically signs the payload before POST (`ds:SignatureValue` injection via `zatca-crypto.ts`). Without it the payload is transmitted unsigned (only acceptable for sandbox/demo). |

Setting only a subset of the production variables keeps the transport in sandbox
mode (partial config is treated as "not configured") so a half-finished setup
cannot silently start transmitting.

## Crypto + onboarding (Phase 18) — configuration & seams

- **`ZATCA_API_BASE_URL`** also gates the onboarding transport: when set,
  `requestComplianceCsid` POSTs the CSR to `{base}/compliance` (OTP header +
  `Accept-Version: V2`) and `requestProductionCsid` POSTs to
  `{base}/production/csids` (Basic auth from the compliance CSID). When unset
  (or blank), both return a deterministic **sandbox mock** so the seam is
  exercisable offline.
- **Keys/certificates are passed in, not read from env.** `generateZatcaKeyPair()`
  makes a fresh secp256k1 pair; `buildZatcaCsr()` consumes it; the CSID
  certificate + secret returned by onboarding are the inputs the production
  transport must use for Basic auth and payload signing.

## Sandbox onboarding run — `scripts/verify-zatca-phase18-sandbox.mjs`

The Phase 18 verification harness has two parts:

- **Part 1 — offline E2E (always runs):** exercises the real seam modules
  (zatca-crypto / zatca-onboarding / zatca-ubl / zatca-transport) against
  sandbox mocks. Needs no credentials.
- **Part 2 — live sandbox onboarding (runs only when `ZATCA_SANDBOX_OTP` is
  set):** POSTs the CSR to the real ZATCA sandbox
  (`https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal`): compliance
  CSID → production CSID, parses/asserts the returned X.509 CSID certs, then
  two informational probes: a compliance invoice check, and a **live
  reporting probe** that transmits the test invoice through the REAL
  transport path (Basic auth from the production CSID + ECDSA signature) to
  surface exactly where the sandbox disagrees with the documented
  constructions (reported verbatim, never masked).

| Variable | Description |
|---|---|
| `ZATCA_SANDBOX_OTP` | One-time password generated in the **sandbox portal** (`https://sandbox.zatca.gov.sa/` → register the EGS solution → generate OTP). **Human step — no value can be fabricated**; the sandbox rejects fake OTPs (`400 Invalid Request`). **Valid for 1 hour** — run the harness immediately after generating it. |
| `ZATCA_SANDBOX_VAT` | VAT number for the CSR UID. Defaults to the documented sandbox dummy `399999999900003`. |
| `ZATCA_SANDBOX_BASE_URL` | Sandbox API gateway base. Defaults to `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal`. |
| `ZATCA_SANDBOX_PERSIST` | When `1`, also **saves the real onboarded CSIDs to the demo tenant's `zatca_csids` table** (service role) — the exact rows `saveZatcaCsidInternal` writes (env `sandbox`, kinds compliance + production, with the signing `private_key`). This replaces the manual UI Onboard step, so the live run leaves the tenant fully onboarded. Requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (already in `.env.local`). Default unset → validation only, no DB writes. |
| `ZATCA_SANDBOX_TENANT` | Tenant id to persist to. Defaults to the demo tenant `00000000-0000-0000-0000-000000000001`. |

These are read from the environment or `.env.local`, same convention as the
other verify scripts. Run:

```bash
node scripts/verify-zatca-phase18-sandbox.mjs   # Part 1 only (no OTP)
ZATCA_SANDBOX_OTP=<otp> node scripts/verify-zatca-phase18-sandbox.mjs  # Parts 1 + 2

# One-command live run: validate onboarding AND persist the real CSIDs to the
# demo tenant (replaces the manual UI Onboard step):
ZATCA_SANDBOX_OTP=<otp> ZATCA_SANDBOX_PERSIST=1 \
  node scripts/verify-zatca-phase18-sandbox.mjs
```

After a successful persisted run, the ZATCA tab's **Stored CSID credentials**
card shows the real sandbox CSIDs, and the transport can authenticate with
Basic auth from the stored production CSID. Note: the adapter's reporting
path only engages when `ZATCA_API_BASE_URL` points at the gateway — a
subsequent adapter run against the sandbox reporting endpoint is the final
live check (see the P2.6 informational probe output for the first signal).

## CSID credential store (`zatca_csids`, migrations 055–056)

Onboarding outputs are persisted **per tenant** in the `zatca_csids` table
(`src/lib/accounting/zatca-csid.ts`, `zatca_csids` migrations 055–056), not in env
vars — each tenant is an EGS with its own VAT number, so CSIDs cannot be
process-global.

- **Schema:** one row per `(tenant_id, environment, kind)`, where `kind` is
  `compliance` or `production`; columns hold the `binarySecurityToken`
  (certificate, base64) + the CSID secret + the PKCS#8 PEM secp256k1
  `private_key` (migration 056 — bound to the CSID cert, used for payload
  signing via `zatca-transport.ts`) + the compliance `request_id` and
  issue/expiry timestamps.
- **Security:** the table has **no RLS policies** — every read/write flows
  through the service-role admin client; the secret **and the private key** are
  **never returned to the browser** (the accounting page ZATCA tab only sees a
  masked `secretPreview`; `listZatcaCsids` never selects `private_key`). The
  full credential — cert + secret + `private_key` — is read server-side only
  via `getZatcaCsidCredential()` and passed straight to the transport.
  Writes require `accounting:approve` (same as the adapter/dispatcher); the
  masked listing requires `accounting:read`.
- **Signing:** when the stored row has a `private_key`, the transport signs the
  payload before POST (XAdES-B-B style, `ds:SignatureValue` injection — see
  the SEAM notes in `zatca-crypto.ts`/`zatca-transport.ts`). Without one, the
  payload is transmitted unsigned (sandbox/demo only).
- **Precedence:** the adapter prefers a stored `(production, production)` CSID
  for the tenant; when absent it falls back to `ZATCA_CSID_CERT`/
  `ZATCA_CSID_SECRET` env config, then to the sandbox mock.
- **No ZATCA-specific env vars are required today.** The seams default to
  sandbox and cannot transmit or onboard anywhere real without
  `ZATCA_API_BASE_URL` pointing at ZATCA's environment **and** real
  credentials.

## What the production path does (and does not) do

- **Does:** `fetch(`${ZATCA_API_BASE_URL}/invoices/reporting/single`, { method: "POST", headers: { "Content-Type": "application/xml", Authorization: Basic base64(<CSID cert>:<CSID secret>) }, body: <UBL 2.1 XML> })`, parses the JSON response, and maps `uuid`/`reportedInvoiceUuid` + pipeline → `reported`/`cleared`.
- **Does not yet:** sign the payload cryptographically, attach onboarding certificates, or handle ZATCA's compliance/clearance signing flow **end-to-end**. The Phase 18 seams now implement the documented primitives (secp256k1 keygen, invoice hash/PIH, ECDSA signature, CSR, CCSID→PCSID requests) with unit coverage, but they are **unverified against the live ZATCA API** and the UBL builder's signature block is scaffolding (ZATCA-BOUNDARY.md §1). Until the seams are validated against the ZATCA sandbox and official SDK, production mode must **not** be pointed at the live ZATCA environment with real credentials.
- **Error handling:** non-2xx responses throw `ZATCA transport error <status>: <body>` (transmission) or `ZATCA onboarding error <status>: <body>` (onboarding); `runZatcaAdapter()` catches per-document failures, records `error_message` on the transmission row, and retries on the next run.

## Status vocabulary

`reported`, `cleared`, `rejected` are **ZATCA response statuses**, recorded
factually in `zatca_transmissions` / `invoices.zatca_status`. They are not a
claim of ZATCA compliance, approval, or certification — the UI copy and this
repository deliberately carry no such language (ZATCA-BOUNDARY.md §5, enforced
by `src/lib/accounting/zatca-copy-audit.test.ts`).
