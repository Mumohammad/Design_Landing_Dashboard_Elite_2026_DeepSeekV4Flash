"use server"

// ZATCA production rehearsal (offline dry run). accounting:read.
// Reads finalized documents and runs prepare → sign → QR → validate locally
// with a throwaway test certificate. NOTHING is sent to ZATCA and nothing is
// written to the issuance ledger, transmissions or invoices — only an audit
// log entry recording that a rehearsal ran. See zatca-dry-run-core.ts.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { loadZatcaSourceDocument } from "./zatca-source"
import { buyerParty, sellerParty, type CustomerPartyRow, type TenantPartyRow } from "./zatca-adapter-input"
import { runZatcaDryRunBatch, type DryRunDocument, type DryRunSummary } from "./zatca-dry-run-core"
import { zatcaConfiguredEnvironment, zatcaProductionAvailable } from "./zatca-config"

const EVENT_DOC: Record<string, DryRunDocument["docType"]> = {
  InvoiceFinalizedEvent: "invoice", CreditNoteIssuedEvent: "credit_note", DebitNoteIssuedEvent: "debit_note",
}

export interface ZatcaDryRunResult extends DryRunSummary {
  /** True when no finalized documents exist and built-in sample documents were rehearsed. */
  sample: boolean
  skipped: number
  chainStart: { counter: number; fromLedger: boolean }
  safety: { gatewayConfigured: boolean; productionAvailable: boolean; tenantProductionOn: boolean; autoSendOn: boolean }
}

function sampleDocuments(now: string): DryRunDocument[] {
  const line = { line_no: 1, item_name: "Delivery service", description: "Last-mile delivery (sample)", quantity: 10, unit_price: 20, discount: 0, amount: 200, vat_rate: 15, vat_amount: 30 }
  const base = { finalizedAt: now, issueDate: now.slice(0, 10), currency: "SAR", subtotal: 200, discount: 0, vatAmount: 30, total: 230, lines: [line] }
  return [
    { ...base, sourceId: "sample-simplified", docType: "invoice", docRef: "SAMPLE-B2C-1", buyer: buyerParty(null) },
    { ...base, sourceId: "sample-standard", docType: "invoice", docRef: "SAMPLE-B2B-1", buyer: { name: "Sample Buyer Co.", vatNumber: "399999999800003", address: "King Fahd Road", buildingNumber: "1111", additionalNumber: "2222", district: "Olaya", city: "Riyadh", postalCode: "12345", region: "Riyadh", countryCode: "SA" } },
  ]
}

export async function runZatcaDryRun(opts: { limit?: number } = {}): Promise<{ success: boolean; error?: string; result?: ZatcaDryRunResult }> {
  try {
    await requirePermission("accounting", "read")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }
    const tenantId = user.tenantId
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 10), 1), 25)
    const admin = createAdminClient()

    const [tenantRes, eventsRes, envRes, autoRes] = await Promise.all([
      admin.from("tenants")
        .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city,region,district,building_number,additional_number,postal_code,country")
        .eq("id", tenantId).maybeSingle<TenantPartyRow>(),
      admin.from("financial_events").select("source_id,event_type,created_at")
        .eq("tenant_id", tenantId).in("event_type", Object.keys(EVENT_DOC))
        .order("created_at", { ascending: false }).limit(limit * 3),
      admin.from("zatca_tenant_environment").select("production_enabled").eq("tenant_id", tenantId).maybeSingle<{ production_enabled: boolean }>(),
      admin.from("zatca_automation").select("enabled").eq("tenant_id", tenantId).maybeSingle<{ enabled: boolean }>(),
    ])
    if (!tenantRes.data) return { success: false, error: "Company profile not found." }
    const seller = sellerParty(tenantRes.data)

    // Unique source documents, oldest first so the rehearsal chain reads naturally.
    const seen = new Set<string>()
    const events = ((eventsRes.data ?? []) as { source_id: string; event_type: string; created_at: string }[])
      .filter((e) => !seen.has(e.source_id) && seen.add(e.source_id)).slice(0, limit).reverse()

    const documents: DryRunDocument[] = []
    let skipped = 0
    for (const ev of events) {
      const docType = EVENT_DOC[ev.event_type]
      const src = await loadZatcaSourceDocument(admin, tenantId, docType, ev.source_id)
      if (src === "skipped" || src === "failed") { skipped++; continue }
      const { data: customer } = src.customerId
        ? await admin.from("customers").select("name_ar,name_en,tax_number,address,city,district,building_number,additional_number,postal_code,country_code")
          .eq("id", src.customerId).eq("tenant_id", tenantId).maybeSingle<CustomerPartyRow>()
        : { data: null }
      documents.push({
        sourceId: ev.source_id, docType, docRef: src.docRef, issueDate: src.issueDate, finalizedAt: ev.created_at,
        currency: src.currency, subtotal: src.subtotal, discount: src.discount, vatAmount: src.vatAmount, total: src.total,
        lines: src.lines, buyer: buyerParty(customer ?? null), referenceInvoiceNumber: src.referenceInvoiceNumber, noteReason: src.noteReason,
      })
    }
    const sample = documents.length === 0
    if (sample) documents.push(...sampleDocuments(new Date().toISOString()))

    // Continue from the tenant's real ledger position (read-only) so the
    // rehearsal mirrors the next ICV/PIH; the real stream is never advanced.
    const testEnv = zatcaConfiguredEnvironment()
    const { data: stream } = await admin.from("zatca_issuance_streams").select("last_counter,last_invoice_hash")
      .eq("tenant_id", tenantId).eq("environment", envRes.data?.production_enabled ? "production" : testEnv ?? "simulation")
      .order("created_at", { ascending: true }).limit(1).maybeSingle<{ last_counter: number; last_invoice_hash: string }>()
    const chainStart = { counter: Number(stream?.last_counter ?? 0), previousHash: stream?.last_invoice_hash ?? null }

    const summary = runZatcaDryRunBatch({ seller, documents, chainStart })
    await writeAuditLog({
      tenantId, actorId: user.authUserId, module: "accounting", action: "zatca_dry_run", entityType: "zatca_dry_run",
      newValues: { documents: summary.documents.length, passed: summary.passed, failed: summary.documents.filter((d) => !d.passed).length, sample, network_calls: 0 },
    })
    return {
      success: true,
      result: {
        ...summary, sample, skipped,
        chainStart: { counter: chainStart.counter, fromLedger: !!stream },
        safety: {
          gatewayConfigured: testEnv !== null,
          productionAvailable: zatcaProductionAvailable(),
          tenantProductionOn: envRes.data?.production_enabled === true,
          autoSendOn: autoRes.data?.enabled === true,
        },
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Dry run failed." }
  }
}
