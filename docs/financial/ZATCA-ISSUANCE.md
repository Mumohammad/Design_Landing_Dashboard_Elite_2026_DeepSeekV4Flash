# Non-production document preparation ledger

This continuation adds a database-backed preparation primitive for **sandbox and simulation only**. It is not a completed official issuance/signing/submission workflow, and the invoice print path still uses its disclosed internal QR. Production streams are rejected by both schema and server code. Existing invoices and old mock transmissions are not backfilled or rewritten.

## Stored evidence and identity

Each EGS stream belongs to a tenant/environment and starts with counter zero and the reviewed genesis PIH. A prepared artifact stores a UUID, preparation timestamp, sequence number, preceding canonical hash, its own hash, original unsigned XML, canonical bytes, immutable source document/line snapshot and actor. The timestamp describes creation of this new non-production artifact; it does not replace the financial finalization timestamp or establish a historical invoice's legal issue time.

Identity is `(tenant, environment, source type, source ID)`. Credit/debit notes use their own IDs, so multiple notes referencing one invoice no longer collide. Separate environments have separate histories. A retry returns the stored UUID/time/XML, even if proposed values or current company settings differ. The caller must use the returned artifact and its recorded stream identity, never send a newly rebuilt retry's XML.

## Transaction and trust boundaries

The trusted-server-only `record_zatca_issuance` RPC uses invoker privileges. Anonymous/authenticated API clients cannot execute it or write either table. Authorized accounting readers can read their own tenant's preparation evidence; RLS protects both tables. The server helper requires `accounting:approve` and the active user before creating an admin client. No private keys, CSID secrets or authority status are stored here.

The RPC locks the EGS stream before reading a finalized sales invoice/note and copying its source snapshot. Optimistic counter/PIH checks reject stale proposals. XML UUID, reference, type, timestamp, currency, totals, tax and line fields must match the supplied metadata and immutable source. The original/canonical XML relationship is computed by the trusted server helper, not independently canonicalized in PostgreSQL; the RPC is therefore deliberately unavailable to browser clients. The database checks the canonical-byte digest.

Inserting evidence and advancing the chain happen in one transaction. The stream can advance only to a matching retained artifact. Evidence cannot be updated/deleted; service-role grants also exclude delete/truncate. Constraint, duplicate-source or post-insert failures roll back both sides. Competing streams cannot create two artifacts for the same source/environment. A conflict requires reloading the stored artifact/current stream; no automatic transmission occurs.

`prepareZatcaDocument` is server-only and is **not** a Server Action, public endpoint, UI activation or replacement for the disabled adapter. It accepts financial/profile data from a future trusted adapter, builds and canonicalizes XML, then persists it through this fence. It must not be exposed directly as a client-supplied arbitrary XML/data endpoint.

## Verification and remaining work

`085_zatca_issuance_tests.sql` checks RLS and function/table privileges. `verify-zatca-issuance-concurrency.mjs --local-disposable` tests real competing transactions, retry identity, cross-EGS duplication, independent notes, stale/mismatched proposals, rollback after an injected post-insert failure, source immutability and tenant isolation against the disposable Supabase database. It never accepts hosted credentials or a remote target. Focused local PostgreSQL verification uses synthetic scaffold tables; full Supabase authorization remains a separate CI gate.

The UBL builder now carries the engine's explicit line discount as a line allowance before the line tax block, without deducting it again at document level. The offline SDK harness includes standard and simplified discounted invoices alongside the original six invoice/note cases. The SDK demonstration signer still supplies the signature; these tests do not validate a complete application signer.

Before production use, integrate genuine taxpayer/EGS configuration, capture the actual legal issuance identity/time in the authorized financial workflow, validate complete certificate-bound signing/QR, retain signed/cleared artifacts and append authority-attempt evidence, complete genuine onboarding/API acceptance, and verify retention/recovery and supported tax cases. This migration does not enable any production integration gate.
