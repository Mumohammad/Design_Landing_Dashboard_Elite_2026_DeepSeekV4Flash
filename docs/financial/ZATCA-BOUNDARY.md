# ZATCA Adapter — Boundary Document

> **Status:** Boundary definition only. **Do NOT implement the ZATCA Adapter now.**
> The ZATCA Adapter is a future, independent integration layer. This document defines the seam so Accounting, Invoice, and VAT engines can be built **now** without a rewrite later.

---

## 1. Explicitly OUT of scope (now)

- ZATCA structured e-invoice transmission (XML/UBL or other formats)
- ZATCA API integration, endpoints, or credentials
- Cryptographic requirements (signing keys, certificates, hashing per ZATCA spec)
- QR code encoding mandated by ZATCA (our QR is a verification QR for now, not a ZATCA tax QR — keep them distinct in code and docs)
- Any claim of ZATCA **compliance**, **approval**, or **certification**
- Inventing ZATCA technical requirements

**Do not fabricate ZATCA specs.** When the adapter phase arrives, requirements must come from the official ZATCA sources / a finance owner, not from memory.

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
│              ZATCA ADAPTER (future)            │
│  - transforms final invoices → ZATCA payload   │
│  - transmits via ZATCA API (production creds)  │
│  - stores ZATCA responses (UUID, status)       │
│  - cryptographic signing (Phase 15)            │
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
