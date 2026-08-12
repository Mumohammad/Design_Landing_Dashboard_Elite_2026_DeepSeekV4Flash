"use server"

// Module 13 — document template generators.
//
// generateDocumentAction(templateId, driverId?, vehicleId?) loads the template
// definition plus the target entity (driver/vehicle) and builds a bilingual,
// print-ready A4 HTML document. It records the document in generated_documents
// (auditable, doc_number via date+random — never COUNT+1) and returns the HTML
// so the client can open a print dialog.
//
// QR: verify_url is stored per document; rendering an actual QR image requires
// a QR library and is documented as a follow-up (payslip spec: QR-verifiable).

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { buildDocumentHtml, type DocumentEntityData } from "./document-html"

type ActionResult = { success: boolean; error?: string; html?: string; docNumber?: string; verifyUrl?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

type TemplateRow = {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  description: string | null
  category: string
}

type DriverRow = {
  driver_code: string | null
  full_name_ar: string | null
  iqama_number: string | null
  phone: string | null
  basic_salary: number | null
  iban: string | null
}

type VehicleRow = {
  vehicle_code: string | null
  plate_number: string | null
  make: string | null
  model: string | null
  year: number | null
}

/**
 * Generate a document from a template for a driver/vehicle (or the first
 * available record when none is supplied — sample generation). templates:create.
 */
export async function generateDocumentAction(
  templateId: string,
  driverId?: string,
  vehicleId?: string
): Promise<ActionResult> {
  try {
    await requirePermission("templates", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    const { data: template, error: tErr } = await admin
      .from("document_templates")
      .select("id,code,name_ar,name_en,description,category")
      .eq("id", templateId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle<TemplateRow>()
    if (tErr || !template) return { success: false, error: "Template not found." }

    const { data: tenant } = await admin
      .from("tenants")
      .select("name_ar,name_en")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{ name_ar: string; name_en: string }>()

    // Resolve driver / vehicle (includes id for the generated_documents FK)
    type DriverRowWithId = DriverRow & { id: string }
    type VehicleRowWithId = VehicleRow & { id: string }
    let driver: DriverRowWithId | null = null
    let vehicle: VehicleRowWithId | null = null

    if (driverId) {
      const { data } = await admin
        .from("drivers")
        .select("id,driver_code,full_name_ar,iqama_number,phone,basic_salary,iban")
        .eq("id", driverId)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle<DriverRowWithId>()
      driver = data ?? null
    } else {
      const { data } = await admin
        .from("drivers")
        .select("id,driver_code,full_name_ar,iqama_number,phone,basic_salary,iban")
        .eq("tenant_id", currentUser.tenantId)
        .in("status", ["active", "on_leave"])
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle<DriverRowWithId>()
      driver = data ?? null
    }

    if (vehicleId) {
      const { data } = await admin
        .from("vehicles")
        .select("id,vehicle_code,plate_number,make,model,year")
        .eq("id", vehicleId)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle<VehicleRowWithId>()
      vehicle = data ?? null
    } else if (template.category === "vehicle") {
      const { data } = await admin
        .from("vehicles")
        .select("id,vehicle_code,plate_number,make,model,year")
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle<VehicleRowWithId>()
      vehicle = data ?? null
    }

    // doc_number: DOC-YYYYMMDD-XXXX (never COUNT+1)
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const rand = Math.floor(1000 + Math.random() * 9000).toString()
    const docNumber = `DOC-${stamp}-${rand}`
    const verifyUrl = `/verify-document/${docNumber}`

    const entityData: DocumentEntityData = {
      driver,
      vehicle,
      companyNameAr: tenant?.name_ar ?? "نخبة التطوير",
      companyNameEn: tenant?.name_en ?? "EliteDev",
      docNumber,
      verifyUrl,
      generatedAt: new Date().toISOString(),
    }

    const html = buildDocumentHtml(template.name_ar, template.name_en ?? template.name_ar, template.description, entityData)

    // Record the generated document (immutable audit trail via generated_documents)
    const { data: doc, error: docErr } = await admin
      .from("generated_documents")
      .insert({
        tenant_id: currentUser.tenantId,
        doc_number: docNumber,
        template_id: template.id,
        driver_id: driver?.id ?? null,
        vehicle_id: vehicle?.id ?? null,
        generated_data: {
          driver: driver ?? null,
          vehicle: vehicle ?? null,
          html,
          template_code: template.code,
        },
        qr_code_url: null,
        verify_url: verifyUrl,
        status: "generated",
        generated_by: currentUser.id,
        generated_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (docErr) throw new Error(docErr.message)

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "templates",
      action: "document_generated",
      entityType: "generated_documents",
      entityId: doc.id,
      newValues: { template_code: template.code, doc_number: docNumber },
    })

    return { success: true, html, docNumber, verifyUrl }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
