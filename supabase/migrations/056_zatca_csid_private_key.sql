-- ============================================================================
-- 056 — ZATCA CSID private key column (Phase 18 production prep)
--
-- The transport signs payloads with the CSID-bound secp256k1 private key.
-- That key is generated during onboarding (the CSR proves possession of it),
-- so it must be persisted alongside the cert + secret in the same
-- service-role-only table — same security model as 055: the key never
-- reaches the browser, and only the app server actions touch the row.
-- ============================================================================

ALTER TABLE zatca_csids
  ADD COLUMN private_key TEXT;  -- PKCS#8 PEM, secp256k1 — bound to the CSID cert
