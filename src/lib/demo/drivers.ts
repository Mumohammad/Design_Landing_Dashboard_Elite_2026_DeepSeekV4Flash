export type Driver = {
  id: string
  name: string
  nameArabic: string
  nationality: string
  iqamaNumber: string
  iqamaExpiry: string
  passportNumber: string
  passportExpiry: string
  licenseNumber: string
  licenseExpiry: string
  phone: string
  photoUrl?: string
  hireDate: string
  contractType: string
  salary: number
  employmentStatus: "active" | "suspended" | "on_leave"
  assignedVehicle?: string
}

export const drivers: Driver[] = [
  {
    id: "driver-001",
    name: "Ahmed Alotaibi",
    nameArabic: "أحمد العتيبي",
    nationality: "Saudi",
    iqamaNumber: "2123456789",
    iqamaExpiry: "2025-11-08",
    passportNumber: "N1234567",
    passportExpiry: "2026-03-15",
    licenseNumber: "DL-4491",
    licenseExpiry: "2025-08-12",
    phone: "+966 55 123 4567",
    hireDate: "2022-05-01",
    contractType: "Permanent",
    salary: 5200,
    employmentStatus: "active",
    assignedVehicle: "vehicle-011",
  },
  {
    id: "driver-002",
    name: "Mona Alsubaie",
    nameArabic: "منى السبيعي",
    nationality: "Saudi",
    iqamaNumber: "2123456790",
    iqamaExpiry: "2026-05-02",
    passportNumber: "N2234567",
    passportExpiry: "2027-01-18",
    licenseNumber: "DL-3392",
    licenseExpiry: "2025-12-23",
    phone: "+966 55 234 6789",
    hireDate: "2023-02-12",
    contractType: "Contract",
    salary: 4800,
    employmentStatus: "active",
    assignedVehicle: "vehicle-007",
  },
]
