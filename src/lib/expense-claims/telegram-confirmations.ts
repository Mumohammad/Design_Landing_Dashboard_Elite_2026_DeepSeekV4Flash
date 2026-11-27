import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { deliverTelegramReceiptConfirmation } from "./telegram"

type ConfirmationDetails = { claimId: string; summary: string; vatCheck: string }
type ConfirmationClaim = {
  state: "sending"
  claim_id: string
  token: string
  chat_id: number
  claim_no: string
  duplicate_status?: string
}
type ConfirmationOutcome = "empty" | "sent" | "retry" | "uncertain" | "rejected" | "suppressed" | "deferred"

function confirmationText(claim: ConfirmationClaim, details?: ConfirmationDetails) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  const duplicate = claim.duplicate_status === "possible"
    ? "\n⚠️ Possible duplicate — a reviewer will check it. / تكرار محتمل — سيتحقق منه المراجع."
    : ""
  const immediateDetails = details?.claimId === claim.claim_id ? details : undefined
  return `🧾 Receipt received — claim ${claim.claim_no} was submitted for review. Details are unverified until reviewed.\nتم استلام الإيصال — أُرسلت المطالبة ${claim.claim_no} للمراجعة. البيانات غير متحقق منها حتى تتم المراجعة.${immediateDetails?.summary ?? ""}${duplicate}${immediateDetails?.vatCheck ?? ""}${base ? `\n${base}/expenses/claims/${claim.claim_id}` : ""}`
}

export async function dispatchTelegramConfirmation(
  admin: ReturnType<typeof createAdminClient>,
  botId: number,
  receiptId: string | null,
  details?: ConfirmationDetails,
): Promise<ConfirmationOutcome> {
  const { data, error } = await admin.rpc("expense_telegram_claim_confirmation", {
    p_bot_id: botId, p_receipt_id: receiptId,
  })
  if (error) throw new Error("Unable to claim the Telegram confirmation.")
  if (data == null) return "empty"
  if (data.state === "uncertain" || data.state === "suppressed" || data.state === "deferred") return data.state
  const claim: ConfirmationClaim = data
  if (claim.state !== "sending" || typeof claim.claim_id !== "string" || typeof claim.token !== "string" ||
    !Number.isSafeInteger(claim.chat_id) || claim.chat_id <= 0 || typeof claim.claim_no !== "string") {
    throw new Error("Invalid Telegram confirmation claim.")
  }

  const result = await deliverTelegramReceiptConfirmation(claim.chat_id, confirmationText(claim, details))
  const checkpoint = await admin.rpc("expense_telegram_finish_confirmation", {
    p_claim_id: claim.claim_id, p_token: claim.token, p_state: result.state,
    p_message_id: result.state === "sent" ? result.messageId : null,
    p_retry_after: result.state === "retry" ? result.retryAfter : null,
  })
  if (checkpoint.error || checkpoint.data !== true) throw new Error("Unable to checkpoint the Telegram confirmation.")
  return result.state
}
