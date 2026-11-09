"use server"

// Server Action: sign and submit a prepared ZATCA issuance for the signed-in
// user (accounting:approve). Implementation: zatca-submission-core.ts.
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { submitPreparedZatcaDocumentAs, type ZatcaSubmissionResult } from "./zatca-submission-core"

export type { ZatcaSubmissionResult } from "./zatca-submission-core"

export async function submitPreparedZatcaDocument(
  issuanceId: string,
  mode: "compliance" | "submit" = "submit"
): Promise<ZatcaSubmissionResult> {
  try {
    await requirePermission("accounting", "approve")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }
    return await submitPreparedZatcaDocumentAs(user, issuanceId, mode)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Unexpected error." }
  }
}
