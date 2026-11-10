export type AdminUser = {
  id: string
  name: string
  email: string
  role: string
  status: "active" | "inactive"
  lastLogin: string
}

export const adminUsers: AdminUser[] = [
  { id: "user-001", name: "Rami Al-Farhan", email: "rami@elite-dev.com", role: "System Administrator", status: "active", lastLogin: "2026-07-13" },
  { id: "user-002", name: "Layla Al-Hassan", email: "layla@elite-dev.com", role: "Operations Manager", status: "active", lastLogin: "2026-07-13" },
  { id: "user-003", name: "Saad Al-Mutairi", email: "saad@elite-dev.com", role: "HR Specialist", status: "inactive", lastLogin: "2026-07-09" },
]
