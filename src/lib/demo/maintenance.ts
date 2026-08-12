export type MaintenanceRequest = {
  id: string
  vehicleId: string
  title: string
  status: "open" | "in_progress" | "completed"
  priority: "low" | "medium" | "high"
  createdAt: string
}

export const maintenanceRequests: MaintenanceRequest[] = [
  { id: "maint-001", vehicleId: "vehicle-011", title: "Oil change and brake check", status: "open", priority: "high", createdAt: "2026-07-05" },
  { id: "maint-002", vehicleId: "vehicle-007", title: "Inspection and tire replacement", status: "in_progress", priority: "medium", createdAt: "2026-06-30" },
]
