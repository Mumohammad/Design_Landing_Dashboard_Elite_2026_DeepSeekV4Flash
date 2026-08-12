export type ExpenseRecord = {
  id: string
  category: string
  amount: number
  status: "submitted" | "approved" | "paid"
  createdAt: string
  vendor: string
}

export const expenses: ExpenseRecord[] = [
  { id: "exp-001", category: "Fuel", amount: 5400, status: "approved", createdAt: "2026-07-05", vendor: "STC Fuel" },
  { id: "exp-002", category: "Maintenance", amount: 3200, status: "submitted", createdAt: "2026-07-08", vendor: "Elite Garage" },
]
