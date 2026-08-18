-- =====================================================================
-- 053 — Financial security hardening (IMPLEMENTATION-PLAN Phase 13):
--       financial_events becomes append-only for authenticated users.
--
-- The event ledger is consumed by the event dispatcher; every application
-- write path emits events through the service-role admin client
-- (src/lib/accounting/invoices.ts, payments.ts, expenses/actions.ts), and
-- the dispatcher RPCs are REVOKE'd from PUBLIC/authenticated/anon (042).
-- The authenticated INSERT policy from 038 was therefore unnecessary
-- surface: any tenant user could inject arbitrary own-tenant events into
-- the processing queue, polluting the domain trail and forcing the
-- dispatcher to attempt (and fail) fabricated payloads.
--
-- Fix: drop the authenticated INSERT policy, leaving SELECT-only for
-- authenticated users. Service role (the app + dispatcher) is unaffected.
-- =====================================================================

DROP POLICY IF EXISTS ins_financial_events_tenant ON financial_events;
