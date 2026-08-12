export type Vehicle = {
  id: string
  plateNumber: string
  make: string
  model: string
  year: number
  chassisNumber: string
  engineNumber: string
  insuranceExpiry: string
  inspectionExpiry: string
  registrationExpiry: string
  currentDriver?: string
  status: "active" | "maintenance" | "idle"
}

export const vehicles: Vehicle[] = [
  {
    id: "vehicle-011",
    plateNumber: "ح 1234 ب",
    make: "Toyota",
    model: "Hilux",
    year: 2021,
    chassisNumber: "JTEBU14R6N5001234",
    engineNumber: "2GD-FTV345678",
    insuranceExpiry: "2025-09-30",
    inspectionExpiry: "2025-06-15",
    registrationExpiry: "2025-10-18",
    currentDriver: "driver-001",
    status: "active",
  },
  {
    id: "vehicle-007",
    plateNumber: "د 5678 أ",
    make: "Nissan",
    model: "Navara",
    year: 2020,
    chassisNumber: "MLAAL22A8LA012345",
    engineNumber: "YD25DDTi87654321",
    insuranceExpiry: "2024-12-12",
    inspectionExpiry: "2025-02-10",
    registrationExpiry: "2025-01-20",
    currentDriver: "driver-002",
    status: "active",
  },
]
