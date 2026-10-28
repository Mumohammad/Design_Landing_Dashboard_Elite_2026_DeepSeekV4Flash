"use server"

// Financial Phase 18 — ZATCA CSID credential store.
//
// Persists the onboarding outputs (compliance CSID + production CSID) per
// tenant so the transmission transport can authenticate with the documented
// Basic auth (certificate:secret — zatca-transport.ts). The table
// (zatca_csids, migration 055) has NO RLS policies: every read/write here
// flows through the service-role admin client, and the secret is NEVER
// returned to the browser — the UI only sees a masked summary.
//
// Permission: accounting:approve for writes (same as the event dispatcher and
// the adapter), accounting:read for the masked listing.
//
// No ZATCA compliance is claimed (ZATCA-BOUNDARY.md §5).

import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"
import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { generateZatcaKeyPair, buildZatcaCsr, ZATCA_CERT_TEMPLATES, type ZatcaCsrInput } from "./zatca-crypto"
import { requestComplianceCsid, requestProductionCsid } from "./zatca-onboarding"
import { getZatcaNetworkBase, zatcaConfiguredEnvironment } from "./zatca-config"
import { certificateFromToken, certificateValidity } from "./zatca-cert"
import { runZatcaComplianceChecks, type ComplianceCheckResult } from "./zatca-compliance-checks"
import { missingNationalAddress, sellerParty, type TenantPartyRow } from "./zatca-adapter-input"

export type ZatcaCsidEnvironment = "sandbox" | "simulation" | "production"
export type ZatcaCsidKind = "compliance" | "production"

export interface SaveCsidInput {
  environment: ZatcaCsidEnvironment
  kind: ZatcaCsidKind
  /** binarySecurityToken (X.509 certificate, base64) from the onboarding step. */
  csidBase64: string
  /** CSID secret — persisted, never returned to the browser. */
  secret: string
  /** PKCS#8 PEM secp256k1 private key bound to the CSID cert (for payload signing). */
  privateKey?: string | null
  /** Compliance requestID — required for the production step, stored for reference. */
  requestId?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
}

export interface ZatcaCsidSummary {
  id: string
  environment: ZatcaCsidEnvironment
  kind: ZatcaCsidKind
  status: string
  issuedAt: string | null
  expiresAt: string | null
  /** Masked secret for the UI (first 4 chars + ellipsis) — the full secret never leaves the server. */
  secretPreview: string
  updatedAt: string | null
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

/** No credential characters or length leave the server, even in audit history. */
function maskSecret(secret: string): string {
  return secret ? "••••" : ""
}

/**
 * Upsert a CSID (compliance or production) for the current tenant.
 * accounting:approve. Re-running onboarding for the same (env, kind) refreshes
 * the row — no accumulating secrets.
 */
export async function saveZatcaCsid(input: SaveCsidInput): Promise<{ success: boolean; error?: string }> {
  if (!integrationAvailable("zatca")) return { success: false, error: INTEGRATION_UNAVAILABLE }
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    if (!input.csidBase64 || !input.secret) {
      return { success: false, error: "CSID certificate and secret are required." }
    }

    const admin = createAdminClient()
    const { error } = await admin.from("zatca_csids").upsert(
      {
        tenant_id: currentUser.tenantId,
        environment: input.environment,
        kind: input.kind,
        csid_base64: input.csidBase64,
        secret: input.secret,
        private_key: input.privateKey ?? null,
        request_id: input.requestId ?? null,
        status: "issued",
        issued_at: input.issuedAt ?? new Date().toISOString(),
        expires_at: input.expiresAt ?? null,
        created_by: currentUser.authUserId,
        updated_by: currentUser.authUserId,
      },
      { onConflict: "tenant_id,environment,kind" }
    )
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "zatca_csid_saved",
      entityType: "zatca_csids",
      newValues: {
        environment: input.environment,
        kind: input.kind,
        secret: maskSecret(input.secret),
        has_request_id: Boolean(input.requestId),
      },
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * List the current tenant's CSIDs as a MASKED summary (never the secret).
 * accounting:read. Used by the accounting page ZATCA tab.
 */
export async function listZatcaCsids(): Promise<{
  success: boolean
  error?: string
  csids?: ZatcaCsidSummary[]
}> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("zatca_csids")
      .select("id,environment,kind,status,secret,issued_at,expires_at,updated_at")
      .eq("tenant_id", currentUser.tenantId)
      .order("environment", { ascending: true })
      .order("kind", { ascending: true })
    if (error) return { success: false, error: error.message }

    const csids: ZatcaCsidSummary[] = (data ?? []).map((r) => ({
      id: r.id,
      environment: r.environment as ZatcaCsidEnvironment,
      kind: r.kind as ZatcaCsidKind,
      status: r.status,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      secretPreview: maskSecret(r.secret),
      updatedAt: r.updated_at,
    }))

    return { success: true, csids }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Onboarding orchestrator ────────────────────────────────────────────────

export interface OnboardZatcaInput {
  /** Target environment — must match the configured non-production gateway. */
  environment: ZatcaCsidEnvironment
  /** One-time password from the Fatoora portal (compliance step). */
  otp: string
  /** EGS unit name (CSR OU/CN), e.g. the branch or device. */
  organizationUnit?: string
  commonName?: string
  /** EGS serial `1-<solution>|2-<model>|3-<serial>`; reused for renewals. */
  serialNumber?: string
  /** Invoice types the EGS issues: "1100" standard + simplified (default). */
  title?: string
  businessCategory?: string
}

export interface OnboardZatcaResult {
  success: boolean
  error?: string
  sandbox?: boolean
  complianceSaved?: boolean
  productionSaved?: boolean
  checks?: ComplianceCheckResult[]
  egsSerial?: string
}

const OTP_RE = /^\d{6}$/
const TITLE_RE = /^[01]{4}$/

/**
 * Onboard (or renew) the tenant's EGS unit and persist both CSIDs:
 *
 *   1. Validate the seller identity: VAT number and complete National Address
 *      (no demo/sample values are ever substituted).
 *   2. Generate a fresh secp256k1 keypair and the SDK-compatible CSR; an
 *      existing EGS stream's serial is reused so the ICV/PIH chain continues.
 *   3. Compliance CSID (OTP) → persist with its validity window.
 *   4. Gateway modes: pass the compliance checks for every document type the
 *      EGS issues, signed with the compliance certificate.
 *   5. Production CSID → persist; register the EGS issuance stream.
 *
 * accounting:approve. The private key never reaches the browser.
 */
export async function onboardZatcaCsids(input: OnboardZatcaInput): Promise<OnboardZatcaResult> {
  if (!integrationAvailable("zatca")) return { success: false, error: INTEGRATION_UNAVAILABLE }
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    if (!OTP_RE.test(input.otp ?? "")) return { success: false, error: "Enter the 6-digit OTP from the Fatoora portal." }
    if (input.environment === "production") return { success: false, error: "Production onboarding is disabled." }
    const configured = zatcaConfiguredEnvironment()
    const base = getZatcaNetworkBase()
    if (configured && input.environment !== configured) {
      return { success: false, error: `The configured ZATCA gateway is ${configured}; onboard that environment.` }
    }
    const environment = input.environment
    const title = input.title ?? "1100"
    if (!TITLE_RE.test(title) || title.startsWith("00")) return { success: false, error: "Invalid EGS invoice-type flags." }

    const admin = createAdminClient()

    // 1. Seller identity (National Address, migration 20261028131000).
    const { data: tenant } = await admin
      .from("tenants")
      .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city,region,district,building_number,additional_number,postal_code,country")
      .eq("id", currentUser.tenantId)
      .maybeSingle<TenantPartyRow>()
    if (!tenant) return { success: false, error: "Tenant not found." }
    const seller = sellerParty(tenant)
    const missing = missingNationalAddress(seller, "seller", "standard")
    if (missing.length) {
      return { success: false, error: `Complete the company tax profile before onboarding (${missing.join(", ")}).` }
    }
    const vatNumber = seller.vatNumber!
    const orgName = seller.name

    // Reuse the existing EGS identity for renewals (same ICV/PIH chain).
    const { data: stream } = await admin
      .from("zatca_issuance_streams")
      .select("id,egs_serial")
      .eq("tenant_id", currentUser.tenantId)
      .eq("environment", environment)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string; egs_serial: string }>()
    const egsSerial = stream?.egs_serial || input.serialNumber?.trim() || `1-EliteDev|2-Dashboard|3-${randomUUID()}`
    if (!/^1-[^|]{1,60}\|2-[^|]{1,60}\|3-[^|]{1,80}$/.test(egsSerial)) {
      return { success: false, error: "EGS serial must look like 1-<solution>|2-<model>|3-<serial>." }
    }

    // 2. Fresh keypair + CSR (template selected by environment).
    const keyPair = generateZatcaKeyPair()
    const unit = input.organizationUnit?.trim() || tenant.city || "Main Branch"
    const csrInput: ZatcaCsrInput = {
      country: seller.countryCode || "SA",
      organizationUnit: unit,
      organization: orgName,
      commonName: input.commonName?.trim() || `EGS-${vatNumber}`,
      serialNumber: egsSerial,
      uid: vatNumber,
      title,
      registeredAddress: [seller.buildingNumber, seller.address, seller.district, seller.city].filter(Boolean).join(" "),
      businessCategory: input.businessCategory?.trim() || "Logistics",
      certificateTemplate: ZATCA_CERT_TEMPLATES[environment],
    }
    const csr = buildZatcaCsr(csrInput, keyPair)

    // 3. Compliance CSID → persist.
    const cc = await requestComplianceCsid({ csr, otp: input.otp })
    const ccValidity = certificateValidity(cc.csidBase64)
    const complianceSaved = await saveZatcaCsidInternal(admin, currentUser, {
      environment,
      kind: "compliance",
      csidBase64: cc.csidBase64,
      secret: cc.secret,
      privateKey: keyPair.privateKeyPem,
      requestId: cc.requestId,
      issuedAt: ccValidity?.validFrom ?? null,
      expiresAt: ccValidity?.validTo ?? null,
    })
    if (!complianceSaved.success) return complianceSaved

    // 4. Compliance checks (gateway modes only — the offline mock has no API).
    let checks: ComplianceCheckResult[] | undefined
    if (base) {
      const summary = await runZatcaComplianceChecks({
        seller,
        environment,
        certificateBase64: certificateFromToken(cc.csidBase64),
        privateKeyPem: keyPair.privateKeyPem,
        credentials: { csidBase64: cc.csidBase64, secret: cc.secret },
      })
      checks = summary.results
      if (!summary.passed) {
        await writeAuditLog({
          tenantId: currentUser.tenantId, actorId: currentUser.authUserId, module: "accounting",
          action: "zatca_compliance_checks_failed", entityType: "zatca_csids",
          newValues: { environment, results: checks.map((r) => ({ kind: r.kind, docType: r.docType, status: r.status, errors: r.errors.map((e) => e.code ?? "") })) },
        })
        return { success: false, error: "ZATCA compliance checks did not pass. Review the results and the company tax profile.", complianceSaved: true, checks, egsSerial }
      }
    }

    // 5. Production CSID → persist.
    const pc = await requestProductionCsid({
      complianceRequestId: cc.requestId,
      csidBase64: cc.csidBase64,
      csidSecret: cc.secret,
    })
    const pcValidity = certificateValidity(pc.csidBase64)
    const productionSaved = await saveZatcaCsidInternal(admin, currentUser, {
      environment,
      kind: "production",
      csidBase64: pc.csidBase64,
      secret: pc.secret,
      privateKey: keyPair.privateKeyPem,
      requestId: cc.requestId,
      issuedAt: pcValidity?.validFrom ?? null,
      expiresAt: pcValidity?.validTo ?? null,
    })
    if (!productionSaved.success) return productionSaved

    // Register the EGS issuance stream (genesis PIH, counter 0) once.
    if (!stream) {
      const { error: streamError } = await admin
        .from("zatca_issuance_streams")
        .insert({ tenant_id: currentUser.tenantId, environment, egs_serial: egsSerial })
      if (streamError && streamError.code !== "23505") return { success: false, error: "Unable to register the EGS issuance stream." }
    }

    // The onboarding user becomes the tenant's ZATCA operator: the scheduled
    // backstop retries pending documents on their behalf (re-authorized on
    // every run). Failure here does not undo the issued credentials.
    const { error: automationError } = await admin.from("zatca_automation").upsert({
      tenant_id: currentUser.tenantId, operator_id: currentUser.authUserId, enabled: true, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" })
    if (automationError) console.error("[zatca] failed to register the automation operator")

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "zatca_onboarded",
      entityType: "zatca_csids",
      newValues: {
        environment,
        sandbox: Boolean(cc.sandbox && pc.sandbox),
        vat: vatNumber,
        egs_serial: egsSerial,
        renewal: Boolean(stream),
        compliance_checks: checks ? "passed" : "not_applicable_offline",
      },
    })

    return {
      success: true,
      sandbox: Boolean(cc.sandbox && pc.sandbox),
      complianceSaved: true,
      productionSaved: true,
      checks,
      egsSerial,
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Direct upsert used by the orchestrator (skips the permission re-check that
 * the public saveZatcaCsid does — this caller already holds accounting:approve).
 */
async function saveZatcaCsidInternal(
  admin: ReturnType<typeof createAdminClient>,
  currentUser: { tenantId: string; authUserId: string },
  input: SaveCsidInput
): Promise<{ success: boolean; error?: string }> {
  const { error } = await admin.from("zatca_csids").upsert(
    {
      tenant_id: currentUser.tenantId,
      environment: input.environment,
      kind: input.kind,
      csid_base64: input.csidBase64,
      secret: input.secret,
      private_key: input.privateKey ?? null,
      request_id: input.requestId ?? null,
      status: "issued",
      issued_at: input.issuedAt ?? new Date().toISOString(),
      expires_at: input.expiresAt ?? null,
      created_by: currentUser.authUserId,
      updated_by: currentUser.authUserId,
    },
    { onConflict: "tenant_id,environment,kind" }
  )
  if (error) return { success: false, error: error.message }
  return { success: true }
}
