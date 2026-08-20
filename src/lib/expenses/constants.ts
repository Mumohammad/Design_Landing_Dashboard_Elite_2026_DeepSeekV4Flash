// Expense domain constants and shared types.
//
// Extracted from actions.ts (a "use server" file) because every export from a
// "use server" module becomes a server-action proxy when imported on the client.
// Plain constants like EXPENSE_TYPES must live in a regular module so they
// remain normal JavaScript values in client bundles.

export type ExpenseVatRecoverability = "recoverable" | "non_recoverable" | "pending_review"

export type ExpenseType = "fuel" | "advance" | "operational" | "platform_commission" | "maintenance" | "other"

export const EXPENSE_TYPES: ExpenseType[] = [
  "fuel",
  "advance",
  "operational",
  "platform_commission",
  "maintenance",
  "other",
]

export const RECOVERABILITY: ExpenseVatRecoverability[] = [
  "recoverable",
  "non_recoverable",
  "pending_review",
]
