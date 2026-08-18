# ZATCA Adapter — Boundary Document

> **Status:** The ZATCA adapter seams are **implemented** (transmission transport Phase 16; crypto + onboarding Phase 18) with sandbox defaults; production transmission stays config-only (`ZATCA_API_BASE_URL` + production CSID `ZATCA_CSID_CERT`/`ZATCA_CSID_SECRET`, see `docs/financial/ZATCA-ENV.md`) until the seams are validated against the ZATCA sandbox / official SDK with real credentials. This document defines the boundary the implementation must respect — the guardrails in §5 remain binding, and the status-copy audit (`src/lib/accounting/zatca-copy-audit.test.ts`) enforces the no-compliance-claim rule in `pnpm test`.

---

## 1. Explicitly OUT of scope (now)

- ZATCA structured e-invoice transmission (XML/UBL or other formats) — *implemented* as a sandbox transport (Phase 16); real transmission needs credentials + **sandbox-verified signing** below
- ZATCA API integration, endpoints, or credentials — *implemented* config-only behind `ZATCA_API_BASE_URL` + the production CSID cert/secret (Basic auth, see `ZATCA-ENV.md`); production use requires real credentials + onboarding certificates
- Cryptographic requirements (signing keys, certificates, hashing per ZATCA spec) — *implemented as unverified seams* (Phase 18): `zatca-crypto.ts` (secp256k1 keygen, invoice hash/PIH, ECDSA signature, CSR builder) + `zatca-onboarding.ts` (CCSID→PCSID requests). The documented constructions are unit-tested, but **none of them have been validated against the live ZATCA API or the official SDK** — the exact signature-input byte layout and XML C14N must be confirmed before any real transmission (see the SEAM notes in `zatca-crypto.ts`). Onboarding outputs persist per tenant in the `zatca_csids` table (migrations 055–056, service-role-only RLS — the secret AND the signing `private_key` never reach the browser, see `ZATCA-ENV.md` "CSID credential store")
- QR code encoding mandated by ZATCA (our QR is a verification QR for now, not a ZATCA tax QR — keep them distinct in code and docs)
- Any claim of ZATCA **compliance**, **approval**, or **certification**
- Inventing ZATCA technical requirements

**Do not fabricate ZATCA specs.** The Phase 18 seams were built from the documented algorithm (Microsoft's official onboarding guide + the ZATCA developer community + open-source SDKs), but every technical detail must still be confirmed against the official ZATCA sources / a finance owner before production use.

---

## 2. What we build NOW that prepares the seam

The following already exist or are planned — they are ZATCA-friendly without implementing ZATCA:

1. **`tax_number` (VAT registration no.)** on `tenants`, `customers`, `suppliers` — exists in 004/027; settings/company page edits tenant VAT number.
2. **Separate output/input VAT ledgers** — exists (027); ZATCA needs output tax data per invoice, never netted.
3. **Source linkage on every journal** (`source_module`, `source_entity_type`, `source_entity_id`) — exists (027); traceability back to source documents.
4. **Idempotent financial events** with stable keys — planned (`financial_events`, EVENT-MODEL.md); prevents duplicate transmissions.
5. **Immutable finalized invoices / posted journals / finalized VAT periods** — planned triggers; ZATCA requires immutable tax documents.
6. **Invoice QR payload fields documented** (seller VAT number, date/time, total, VAT amount) — the standard data set; our Phase 6 QR can carry exactly these fields so the future ZATCA QR reuses the same payload.
7. **Per-invoice VAT amounts at line level** — planned in `invoice_lines`; ZATCA e-invoices carry line-level tax info.

---

## 3. The future adapter seam (contract to design against, not to implement)

```
Invoice Engine                     VAT Engine
   │  finalized invoice                 │  finalized VAT period
   ▼                                   ▼
┌────────────────────────────────────────────────┐
│              ZATCA ADAPTER (seams built)       │
│  - transforms final invoices → ZATCA payload   │
│  - transmits via ZATCA API (production creds)  │
│  - stores ZATCA responses (UUID, status)       │
│  - crypto: secp256k1 keys, invoice hash/PIH,   │  Phase 18 — implemented,
│    ECDSA signature, CSR, CSID onboarding       │  NOT sandbox-verified
└────────────────────────────────────────────────┘
```

Requirements for a clean seam:
- Adapter consumes the **same idempotent events** the other engines use (`InvoiceFinalizedEvent`).
- Adapter reads **invoice + line + tax payloads** from the Invoice/VAT engines' tables — it never recomputes amounts.
- Adapter writes only its own tables (e.g. `zatca_transmissions`, `zatca_responses`) and status fields on the invoice; it never mutates financial totals.
- Everything the adapter needs (tax numbers, per-line VAT, immutable docs, event keys) is available from work done in Phases 1–11.

---

## 4. Data fields kept ready (no action needed now)

| Data | Where | Purpose |
|---|---|---|
| Company VAT number | `tenants.vat_number` | issuer identification |
| Customer/supplier VAT number | `customers.tax_number` / `suppliers.tax_number` | buyer identification |
| Company legal name, CR, address | `tenants` (settings/company) | issuer details |
| Invoice totals + VAT | `invoices`, `invoice_lines` (planned) | tax amounts |
| Output VAT per period | `vat_output_ledger` | return/transmission aggregate |

---

## 5. Guardrails

- No ZATCA vocabulary in UI copy that implies compliance (e.g. avoid "ZATCA-compliant" labels) until the adapter exists and is verified.
- Keep QR generation in the Invoice Engine as a **verification QR**; rename/repurpose only in Phase 15 if the ZATCA tax QR replaces it.
- Add `zatca_status` fields on invoices only when the adapter phase begins.
- All mock data in tests must be synthetic (no real VAT/CR numbers).
