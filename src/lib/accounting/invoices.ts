"use server"

// Accounting Module — Phase 5: Invoice Engine.
//
// Lifecycle: draft → issued → finalized (immutable) → paid / partially_paid /
// overdue / cancelled (unpaid only) / credited (credit note issued).
//
// Actions:
// - createInvoiceDraft      invoices:create  → header + lines, totals computed
// - updateInvoiceDraft      invoices:update  → edit draft (lines replaced)
// - issueInvoice            invoices:update  → draft → issued
// - finalizeInvoice         invoices:approve → issued → finalized + event
// - cancelInvoice           invoices:update  → unpaid only → cancelled + event
// - issueCreditNote         invoices:create  → reversal vs finalized invoice
// - issueDebitNote          invoices:create  → additional charge note
// - exportInvoicesCsv       invoices:export  → BOM CSV of the invoice list
//
// Canonical math (migration 038, single source of truth):
//   line_amount = round2(quantity × unit_price) − discount   (line net)
//   line_vat    = round2(line_amount × vat_rate / 100)      (per line)
//   subtotal    = Σ line_amount   ·   vat_amount = Σ line_vat
//   total       = round2(subtotal + vat_amount)
// All money passes through 2dp integer-minor arithmetic — no float drift.
//
// Events (EVENT-MODEL.md): finalized/cancelled/credit/debit flows insert rows
// into `financial_events` with stable idempotency keys so the Accounting/VAT
// engines (Phase 9) can consume them exactly once.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import { idempotencyKey } from "@/lib/accounting/financial-events"
import { computeInvoiceTotals, round2, type InvoiceLineInput } from "@/lib/accounting/invoice-math"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { runZatcaAdapter } from "@/lib/accounting/zatca"

export type { InvoiceLineInput } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string }

export type InvoiceType = "sales" | "purchase"

export type InvoiceDraftInput = {
  invoice_type: InvoiceType
  customer_id?: string | null
  supplier_id?: string | null
  issue_date: string
  due_date: string
  currency?: string
  /** Default VAT % applied to lines that don't set their own. */
  vat_rate?: number
  notes?: string | null
  lines: InvoiceLineInput[]
}

// ── Decimal-safe helpers (2dp integer-minor arithmetic) ───────────────────

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

function mapInv(code: string): string {
  return mapFinancialError(`${code}: `)
}

/** Emit an idempotent financial event (EVENT-MODEL.md §2).
 * The idempotency key must match the spec exactly — `suffix` is the canonical
 * verb (finalized | cancelled | issued) → "invoice:{id}:finalized" etc. */
async function emitEvent(input: {
  tenantId: string
  sourceType: string
  sourceId: string
  eventType: string
  suffix: string
  eventDate: string
  payload: Record<string, unknown>
}): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from("financial_events").insert({
    tenant_id: input.tenantId,
    event_id: crypto.randomUUID(),
    idempotency_key: idempotencyKey(input.sourceType, input.sourceId, input.suffix),
    source_type: input.sourceType,
    source_id: input.sourceId,
    event_type: input.eventType,
    event_date: input.eventDate,
    payload: input.payload,
  })
  // Event persistence failures are logged, not thrown — the document change
  // already succeeded; Phase 9's consumer will reconcile on a replay.
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[financial_events] insert failed:", error.message)
    }
  }
}

/** Verify a party exists and belongs to the tenant. Returns an error string or null. */
async function verifyParty(kind: "customers" | "suppliers", id: string | null | undefined, tenantId: string): Promise<string | null> {
  if (!id) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from(kind)
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle()
  return data ? null : mapInv(kind === "customers" ? "CUS001" : "SUP001")
}

// ── Create draft ──────────────────────────────────────────────────────────

export async function createInvoiceDraft(
  input: InvoiceDraftInput
): Promise<ActionResult & { id?: string }> {
  try {
    await requirePermission("invoices", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    if (!input.issue_date || !input.due_date) {
      return { success: false, error: mapInv("INV008") }
    }
    if (new Date(input.due_date) < new Date(input.issue_date)) {
      return { success: false, error: mapInv("INV008") }
    }
    if (input.invoice_type === "sales" && !input.customer_id) {
      return { success: false, error: mapInv("INV005") }
    }
    if (input.invoice_type === "purchase" && !input.supplier_id) {
      return { success: false, error: mapInv("INV005") }
    }

    let totals: ReturnType<typeof computeInvoiceTotals>
    try {
      totals = computeInvoiceTotals(input.lines, input.vat_rate ?? 15)
    } catch (e) {
      return { success: false, error: errorMessage(e) }
    }

    const partyErr = await verifyParty(
      input.invoice_type === "sales" ? "customers" : "suppliers",
      input.invoice_type === "sales" ? input.customer_id : input.supplier_id,
      currentUser.tenantId
    )
    if (partyErr) return { success: false, error: partyErr }

    const admin = createAdminClient()
    const { data: inv, error } = await admin
      .from("invoices")
      .insert({
        tenant_id: currentUser.tenantId,
        invoice_type: input.invoice_type,
        customer_id: input.invoice_type === "sales" ? input.customer_id : null,
        supplier_id: input.invoice_type === "purchase" ? input.supplier_id : null,
        issue_date: input.issue_date,
        due_date: input.due_date,
        currency: input.currency ?? "SAR",
        status: "draft",
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat_amount: totals.vat_amount,
        total: totals.total,
        vat_rate: input.vat_rate ?? 15,
        notes: input.notes?.trim() || null,
        created_by: currentUser.authUserId,
      })
      .select("id,invoice_number")
      .single()
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const { error: linesErr } = await admin.from("invoice_lines").insert(
      totals.lines.map((l) => ({
        tenant_id: currentUser.tenantId,
        invoice_id: inv.id,
        ...l,
        created_by: currentUser.authUserId,
      }))
    )
    if (linesErr) return { success: false, error: mapFinancialError(linesErr.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "invoice_draft_created",
      entityType: "invoices",
      entityId: inv.id,
      newValues: {
        invoice_number: inv.invoice_number,
        invoice_type: input.invoice_type,
        lines: totals.lines.length,
        total: totals.total,
      },
    })

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true, id: inv.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Update draft ───────────────────────────────────────────────────────────

export async function updateInvoiceDraft(
  input: InvoiceDraftInput & { id: string }
): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("invoices")
      .select("id,status,invoice_type")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError || !existing) return { success: false, error: mapInv("INV001") }
    if (existing.status !== "draft") {
      return { success: false, error: mapInv("INV006") }
    }
    if (existing.invoice_type !== input.invoice_type) {
      return { success: false, error: mapInv("INV006") }
    }
    if (new Date(input.due_date) < new Date(input.issue_date)) {
      return { success: false, error: mapInv("INV008") }
    }

    let totals: ReturnType<typeof computeInvoiceTotals>
    try {
      totals = computeInvoiceTotals(input.lines, input.vat_rate ?? 15)
    } catch (e) {
      return { success: false, error: errorMessage(e) }
    }

    const { error: updErr } = await admin
      .from("invoices")
      .update({
        customer_id: input.invoice_type === "sales" ? input.customer_id : null,
        supplier_id: input.invoice_type === "purchase" ? input.supplier_id : null,
        issue_date: input.issue_date,
        due_date: input.due_date,
        currency: input.currency ?? "SAR",
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat_amount: totals.vat_amount,
        total: totals.total,
        vat_rate: input.vat_rate ?? 15,
        notes: input.notes?.trim() || null,
        updated_by: currentUser.authUserId,
      })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
    if (updErr) return { success: false, error: mapFinancialError(updErr.message) }

    // Replace lines (draft only — the DB blocks this once finalized).
    const { error: delErr } = await admin
      .from("invoice_lines")
      .delete()
      .eq("invoice_id", input.id)
    if (delErr) return { success: false, error: mapFinancialError(delErr.message) }

    const { error: linesErr } = await admin.from("invoice_lines").insert(
      totals.lines.map((l) => ({
        tenant_id: currentUser.tenantId,
        invoice_id: input.id,
        ...l,
        created_by: currentUser.authUserId,
      }))
    )
    if (linesErr) return { success: false, error: mapFinancialError(linesErr.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "invoice_draft_updated",
      entityType: "invoices",
      entityId: input.id,
      newValues: { lines: totals.lines.length, total: totals.total },
    })

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Issue (draft → issued) ────────────────────────────────────────────────

export async function issueInvoice(input: { id: string }): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("invoices")
      .select("id,status,invoice_number")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError || !existing) return { success: false, error: mapInv("INV001") }
    if (existing.status !== "draft") return { success: false, error: mapInv("INV006") }

    const { error } = await admin
      .from("invoices")
      .update({ status: "issued", updated_by: currentUser.authUserId })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "invoice_issued",
      entityType: "invoices",
      entityId: input.id,
      newValues: { invoice_number: existing.invoice_number },
    })

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Finalize (issued → finalized) + event ─────────────────────────────────

export async function finalizeInvoice(input: { id: string }): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data: inv, error: fetchError } = await admin
      .from("invoices")
      .select("id,tenant_id,invoice_number,invoice_type,customer_id,supplier_id,issue_date,due_date,currency,status,subtotal,discount,vat_amount,total,vat_rate")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError || !inv) return { success: false, error: mapInv("INV001") }
    if (inv.status !== "issued") return { success: false, error: mapInv("INV006") }

    const { data: lines, error: linesErr } = await admin
      .from("invoice_lines")
      .select("line_no,description,quantity,unit_price,discount,amount,vat_rate,vat_amount")
      .eq("invoice_id", input.id)
      .order("line_no", { ascending: true })
    if (linesErr) return { success: false, error: mapFinancialError(linesErr.message) }

    // Recompute server-side and reconcile with the stored header (INV004 guard).
    const totals = computeInvoiceTotals(
      (lines ?? []).map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        discount: Number(l.discount),
        vat_rate: Number(l.vat_rate),
      })),
      Number(inv.vat_rate ?? 15)
    )
    const storedTotal = Number(inv.total)
    if (Math.abs(totals.total - storedTotal) > 0.01) {
      return { success: false, error: mapInv("INV004") }
    }

    const isPurchase = inv.invoice_type === "purchase"

    // Phase 7 — purchase invoice approval: create the payable BEFORE the
    // status flip so a failed AP insert aborts the finalize cleanly.
    if (isPurchase) {
      const { error: payErr } = await admin.from("payables").insert({
        tenant_id: currentUser.tenantId,
        supplier_id: inv.supplier_id,
        invoice_ref: inv.invoice_number,
        invoice_date: inv.issue_date,
        due_date: inv.due_date ?? inv.issue_date,
        amount: totals.subtotal,
        vat_amount: totals.vat_amount,
        total_amount: totals.total,
        paid_amount: 0,
        status: "open",
        source_entity_type: "purchase_invoice",
        source_entity_id: input.id,
        notes: `Purchase invoice ${inv.invoice_number} approval`,
        created_by: currentUser.authUserId,
      })
      if (payErr) return { success: false, error: mapFinancialError(payErr.message) }
    }

    const { error } = await admin
      .from("invoices")
      .update({
        status: "finalized",
        finalized_at: new Date().toISOString(),
        finalized_by: currentUser.authUserId,
        updated_by: currentUser.authUserId,
      })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
    if (error) {
      // Roll back the AP row if the status flip failed.
      if (isPurchase) {
        await admin
          .from("payables")
          .update({ deleted_at: new Date().toISOString() })
          .eq("source_entity_type", "purchase_invoice")
          .eq("source_entity_id", input.id)
      }
      return { success: false, error: mapFinancialError(error.message) }
    }

    if (isPurchase) {
      await emitEvent({
        tenantId: currentUser.tenantId,
        sourceType: "purchase_invoice",
        sourceId: input.id,
        eventType: "PurchaseInvoiceApprovedEvent",
        suffix: "approved",
        eventDate: inv.issue_date,
        payload: {
          supplier_id: inv.supplier_id,
          invoice_ref: inv.invoice_number,
          subtotal: totals.subtotal,
          vat_amount: totals.vat_amount,
          total: totals.total,
          currency: inv.currency,
          period_year: new Date(inv.issue_date).getUTCFullYear(),
          period_month: new Date(inv.issue_date).getUTCMonth() + 1,
        },
      })
      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "invoices",
        action: "purchase_invoice_approved",
        entityType: "invoices",
        entityId: input.id,
        newValues: {
          invoice_number: inv.invoice_number,
          payable_total: totals.total,
          vat_amount: totals.vat_amount,
        },
      })
    } else {
      await emitEvent({
        tenantId: currentUser.tenantId,
        sourceType: "invoice",
        sourceId: input.id,
        eventType: "InvoiceFinalizedEvent",
        suffix: "finalized",
        eventDate: inv.issue_date,
        payload: {
          invoice_number: inv.invoice_number,
          customer_id: inv.customer_id,
          supplier_id: inv.supplier_id,
          lines: totals.lines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          vat_amount: totals.vat_amount,
          total: totals.total,
          currency: inv.currency,
          period_year: new Date(inv.issue_date).getUTCFullYear(),
          period_month: new Date(inv.issue_date).getUTCMonth() + 1,
        },
      })
      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "invoices",
        action: "invoice_finalized",
        entityType: "invoices",
        entityId: input.id,
        newValues: {
          invoice_number: inv.invoice_number,
          subtotal: totals.subtotal,
          vat_amount: totals.vat_amount,
          total: totals.total,
        },
      })
    }

    // Phase 9 — dispatch the event now: journal + VAT + AR/AP effects land
    // immediately. runEventDispatcher never throws (returns a summary), so a
    // dispatch problem can never poison the finalize result.
    await runEventDispatcher()

    // Phase 15 — ZATCA adapter: transmit finalized SALES documents to ZATCA
    // (sandbox mock by default). Same never-throw contract as the dispatcher;
    // a transmission problem can never poison the finalize result.
    if (!isPurchase) {
      await runZatcaAdapter()
    }

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Cancel (unpaid only) + event ──────────────────────────────────────────

export async function cancelInvoice(input: {
  id: string
  reason: string
}): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const reason = input.reason.trim()
    if (!reason) return { success: false, error: "A cancellation reason is required." }

    const admin = createAdminClient()
    const { data: inv, error: fetchError } = await admin
      .from("invoices")
      .select("id,tenant_id,invoice_number,invoice_type,status,issue_date")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError || !inv) return { success: false, error: mapInv("INV001") }
    if (inv.status === "cancelled" || inv.status === "credited") {
      return { success: false, error: mapInv("INV006") }
    }

    // Only unpaid finalized invoices can be cancelled. The Accounting engine
    // (Phase 9) creates receivables for finalized invoices; until then none
    // exist, so every finalized invoice is considered unpaid.
    if (inv.status === "finalized") {
      const { data: ar } = await admin
        .from("receivables")
        .select("id,paid_amount")
        .eq("tenant_id", currentUser.tenantId)
        .eq("source_entity_type", "invoice")
        .eq("source_entity_id", input.id)
        .limit(5)
      const paid = (ar ?? []).some((r) => Number(r.paid_amount) > 0)
      if (paid) return { success: false, error: mapInv("INV007") }
    }

    const { error } = await admin
      .from("invoices")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: currentUser.authUserId,
        updated_by: currentUser.authUserId,
      })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
    if (error) return { success: false, error: mapFinancialError(error.message) }

    // Phase 7 — cancelling a purchase invoice voids its payable.
    if (inv.invoice_type === "purchase") {
      await admin
        .from("payables")
        .update({ deleted_at: new Date().toISOString(), updated_by: currentUser.authUserId })
        .eq("source_entity_type", "purchase_invoice")
        .eq("source_entity_id", input.id)
    }

    await emitEvent({
      tenantId: currentUser.tenantId,
      sourceType: "invoice",
      sourceId: input.id,
      eventType: "InvoiceCancelledEvent",
      suffix: "cancelled",
      eventDate: inv.issue_date,
      payload: { invoice_number: inv.invoice_number, cancel_reason: reason },
    })

    // Phase 9 — reverse the finalized effect immediately (reversal journal +
    // VAT adjustment; the AR is voided, the payable was voided above).
    await runEventDispatcher()

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "invoice_cancelled",
      entityType: "invoices",
      entityId: input.id,
      newValues: { invoice_number: inv.invoice_number, cancel_reason: reason },
    })

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Credit note (reversal vs finalized invoice) + event ───────────────────

export async function issueCreditNote(input: {
  reference_invoice_id: string
  reason: string
  issue_date?: string
  lines?: InvoiceLineInput[]
}): Promise<ActionResult & { id?: string }> {
  try {
    await requirePermission("invoices", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const reason = input.reason.trim()
    if (!reason) return { success: false, error: "A credit note reason is required." }

    const admin = createAdminClient()
    const { data: inv, error: fetchError } = await admin
      .from("invoices")
      .select("id,tenant_id,invoice_number,status,customer_id,issue_date,currency,subtotal,discount,vat_amount,total,vat_rate")
      .eq("id", input.reference_invoice_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError || !inv) return { success: false, error: mapInv("INV001") }
    if (inv.status !== "finalized") return { success: false, error: mapInv("INV011") }

    const { data: existingNote } = await admin
      .from("credit_notes")
      .select("id")
      .eq("tenant_id", currentUser.tenantId)
      .eq("reference_invoice_id", input.reference_invoice_id)
      .limit(1)
    if ((existingNote ?? []).length > 0) return { success: false, error: mapInv("INV009") }

    // Line snapshot: caller lines, or the full reversal of the invoice.
    let totals: ReturnType<typeof computeInvoiceTotals>
    let snapshot: ReturnType<typeof computeInvoiceTotals>["lines"]
    if (input.lines && input.lines.length > 0) {
      try {
        totals = computeInvoiceTotals(input.lines, Number(inv.vat_rate ?? 15))
        snapshot = totals.lines
      } catch (e) {
        return { success: false, error: errorMessage(e) }
      }
    } else {
      const { data: lines, error: linesErr } = await admin
        .from("invoice_lines")
        .select("line_no,description,quantity,unit_price,discount,amount,vat_rate,vat_amount")
        .eq("invoice_id", inv.id)
        .order("line_no", { ascending: true })
      if (linesErr) return { success: false, error: mapFinancialError(linesErr.message) }
      snapshot = (lines ?? []).map((l) => ({
        line_no: l.line_no,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        discount: Number(l.discount),
        amount: Number(l.amount),
        vat_rate: Number(l.vat_rate),
        vat_amount: Number(l.vat_amount),
      }))
      // For a full reversal the header amounts mirror the reference invoice.
      totals = {
        lines: snapshot,
        subtotal: Number(inv.subtotal),
        discount: Number(inv.discount),
        vat_amount: Number(inv.vat_amount),
        total: Number(inv.total),
      }
    }

    const { data: note, error } = await admin
      .from("credit_notes")
      .insert({
        tenant_id: currentUser.tenantId,
        reference_invoice_id: inv.id,
        customer_id: inv.customer_id,
        issue_date: input.issue_date ?? new Date().toISOString().slice(0, 10),
        currency: inv.currency,
        status: "finalized",
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat_amount: totals.vat_amount,
        total: totals.total,
        vat_rate: Number(inv.vat_rate ?? 15),
        reason,
        lines: snapshot,
        created_by: currentUser.authUserId,
      })
      .select("id,credit_note_number")
      .single()
    if (error) return { success: false, error: mapFinancialError(error.message) }

    // Reference invoice becomes credited.
    await admin
      .from("invoices")
      .update({ status: "credited", updated_by: currentUser.authUserId })
      .eq("id", inv.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)

    await emitEvent({
      tenantId: currentUser.tenantId,
      sourceType: "credit_note",
      sourceId: note.id,
      eventType: "CreditNoteIssuedEvent",
      suffix: "issued",
      eventDate: new Date().toISOString().slice(0, 10),
      payload: {
        credit_note_number: note.credit_note_number,
        reference_invoice_id: inv.id,
        subtotal: totals.subtotal,
        vat_amount: totals.vat_amount,
        total: totals.total,
        reason,
      },
    })

    // Phase 9 — reversal journal + output-VAT adjustment + AR reduction.
    await runEventDispatcher()

    // Phase 15 — transmit the credit note document to ZATCA (sandbox mock).
    await runZatcaAdapter()

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "credit_note_issued",
      entityType: "credit_notes",
      entityId: note.id,
      newValues: {
        credit_note_number: note.credit_note_number,
        reference_invoice_id: inv.id,
        reference_number: inv.invoice_number,
        total: totals.total,
        reason,
      },
    })

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true, id: note.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Debit note (additional charge) + event ────────────────────────────────

export async function issueDebitNote(input: {
  reference_invoice_id: string
  reason: string
  amount: number
  vat_rate?: number
  issue_date?: string
  description?: string
}): Promise<ActionResult & { id?: string }> {
  try {
    await requirePermission("invoices", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const reason = input.reason.trim()
    if (!reason) return { success: false, error: "A debit note reason is required." }
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: mapInv("INV012") }
    }

    const admin = createAdminClient()
    const { data: inv, error: fetchError } = await admin
      .from("invoices")
      .select("id,tenant_id,invoice_number,status,customer_id,issue_date,currency,subtotal,discount,vat_amount,total,vat_rate")
      .eq("id", input.reference_invoice_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError || !inv) return { success: false, error: mapInv("INV001") }
    if (inv.status !== "finalized") return { success: false, error: mapInv("INV011") }

    const vatRate = Number(input.vat_rate ?? 15)
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return { success: false, error: mapInv("INV002") }
    }
    const subtotal = round2(amount)
    const vatAmount = round2((subtotal * vatRate) / 100)

    const { data: note, error } = await admin
      .from("debit_notes")
      .insert({
        tenant_id: currentUser.tenantId,
        reference_invoice_id: inv.id,
        customer_id: inv.customer_id,
        issue_date: input.issue_date ?? new Date().toISOString().slice(0, 10),
        currency: inv.currency,
        status: "finalized",
        subtotal,
        discount: 0,
        vat_amount: vatAmount,
        total: round2(subtotal + vatAmount),
        vat_rate: vatRate,
        reason,
        lines: [
          {
            line_no: 1,
            description: input.description?.trim() || reason,
            quantity: 1,
            unit_price: subtotal,
            discount: 0,
            amount: subtotal,
            vat_rate: vatRate,
            vat_amount: vatAmount,
          },
        ],
        created_by: currentUser.authUserId,
      })
      .select("id,debit_note_number")
      .single()
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await emitEvent({
      tenantId: currentUser.tenantId,
      sourceType: "debit_note",
      sourceId: note.id,
      eventType: "DebitNoteIssuedEvent",
      suffix: "issued",
      eventDate: new Date().toISOString().slice(0, 10),
      payload: {
        debit_note_number: note.debit_note_number,
        reference_invoice_id: inv.id,
        subtotal,
        vat_amount: vatAmount,
        total: round2(subtotal + vatAmount),
        reason,
      },
    })

    // Phase 9 — additional-AR journal + output-VAT adjustment + receivable.
    await runEventDispatcher()

    // Phase 15 — transmit the debit note document to ZATCA (sandbox mock).
    await runZatcaAdapter()

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "debit_note_issued",
      entityType: "debit_notes",
      entityId: note.id,
      newValues: {
        debit_note_number: note.debit_note_number,
        reference_invoice_id: inv.id,
        reference_number: inv.invoice_number,
        total: round2(subtotal + vatAmount),
        reason,
      },
    })

    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true, id: note.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── CSV export (BOM-prefixed so Excel renders Arabic) ─────────────────────

export async function exportInvoicesCsv(): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("invoices", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    // Cursor-based pagination: fetch in batches of 500 using id > cursor
    // to avoid OFFSET degradation on large datasets.
    const allRows: (string | number | boolean | null)[][] = []
    let cursor: string | null = null
    const PAGE_SIZE = 500
    const MAX_ROWS = 10_000 // Safety cap for CSV export

    type InvoiceRow = {
      id: string
      invoice_number: string
      invoice_type: string
      issue_date: string
      due_date: string
      status: string
      subtotal: number
      discount: number
      vat_amount: number
      total: number
      currency: string
      customers?: { name_ar: string | null } | null
      suppliers?: { name_ar: string | null } | null
    }

    while (allRows.length < MAX_ROWS) {
      let query = admin
        .from("invoices")
        .select("id,invoice_number,invoice_type,issue_date,due_date,status,subtotal,discount,vat_amount,total,currency,customers(name_ar),suppliers(name_ar)")
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("issue_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE + 1)

      if (cursor) {
        query = query.lt("id", cursor)
      }

      const { data, error } = await query
      if (error) return { success: false, error: error.message }
      if (!data || data.length === 0) break

      const hasMore = data.length > PAGE_SIZE
      const batch = hasMore ? data.slice(0, PAGE_SIZE) : data
      cursor = String(batch[batch.length - 1].id)

      for (const r of batch) {
        const row = r as unknown as InvoiceRow
        allRows.push([
          row.invoice_number,
          row.invoice_type,
          row.issue_date,
          row.due_date,
          row.status,
          row.subtotal,
          row.discount,
          row.vat_amount,
          row.total,
          row.currency,
          row.customers?.name_ar ?? row.suppliers?.name_ar ?? "",
        ])
      }

      if (!hasMore) break
    }

    const csv = "\uFEFF" + toCsv(
      ["invoice_number", "invoice_type", "issue_date", "due_date", "status", "subtotal", "discount", "vat_amount", "total", "currency", "party"],
      allRows
    )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "invoices_list_exported",
      entityType: "invoices",
      newValues: { rows: allRows.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Paginated invoice list ───────────────────────────────────────────────────

export type InvoiceListResult = {
  success: boolean
  error?: string
  data?: InvoiceRow[]
  nextCursor?: string | null
  totalEstimate?: number
  hasMore?: boolean
}

type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_type: string
  issue_date: string
  due_date: string
  status: string
  subtotal: number
  discount: number
  vat_amount: number
  total: number
  currency: string
  customer_name: string | null
  supplier_name: string | null
}

/**
 * Paginated invoice list using cursor-based pagination.
 * Pass `cursor` from the previous page's `nextCursor` for the next page.
 * First page: omit cursor.
 */
export async function listInvoices(input: {
  cursor?: string | null
  pageSize?: number
}): Promise<InvoiceListResult> {
  try {
    await requirePermission("invoices", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const pageSize = Math.min(Math.max(1, input.pageSize ?? 25), 100)
    const admin = createAdminClient()

    let query = admin
      .from("invoices")
      .select("id,invoice_number,invoice_type,issue_date,due_date,status,subtotal,discount,vat_amount,total,currency,customers(name_ar),suppliers(name_ar)")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1)

    if (input.cursor) {
      query = query.lt("id", input.cursor)
    }

    const { data, error } = await query
    if (error) return { success: false, error: error.message }
    if (!data) return { success: true, data: [], nextCursor: null, totalEstimate: 0, hasMore: false }

    const hasMore = data.length > pageSize
    const rows = (hasMore ? data.slice(0, pageSize) : data).map((r) => {
      const row = r as unknown as {
        id: string; invoice_number: string; invoice_type: string
        issue_date: string; due_date: string; status: string
        subtotal: number; discount: number; vat_amount: number; total: number
        currency: string
        customers?: { name_ar: string | null } | null
        suppliers?: { name_ar: string | null } | null
      }
      return {
        id: row.id,
        invoice_number: row.invoice_number,
        invoice_type: row.invoice_type,
        issue_date: row.issue_date,
        due_date: row.due_date,
        status: row.status,
        subtotal: Number(row.subtotal),
        discount: Number(row.discount),
        vat_amount: Number(row.vat_amount),
        total: Number(row.total),
        currency: row.currency,
        customer_name: row.customers?.name_ar ?? null,
        supplier_name: row.suppliers?.name_ar ?? null,
      }
    })

    const nextCursor = hasMore ? String(rows[rows.length - 1].id) : null

    // Approximate total count (cached from the count query)
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)

    return {
      success: true,
      data: rows,
      nextCursor,
      totalEstimate: count ?? rows.length,
      hasMore,
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
