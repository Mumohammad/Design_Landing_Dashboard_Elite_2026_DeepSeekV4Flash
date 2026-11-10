// The same status transition is used by the detail page and legacy callers.
// Deduction rollback is performed by a database trigger in that transaction.
import { transitionPayrollStatus } from "./status-actions"

export async function cancelPayrollPeriod(driverPayrollId: string, reason: string): Promise<void> {
  const result = await transitionPayrollStatus({ periodId: driverPayrollId, to: "cancelled", reason })
  if (!result.success) throw new Error(result.error ?? "Payroll cancellation failed")
}
