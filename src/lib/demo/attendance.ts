export type AttendanceRecord = {
  id: string
  driverId: string
  driverName: string
  date: string
  status: "present" | "absent" | "on_leave"
  approved: boolean
}

export const attendanceRecords: AttendanceRecord[] = [
  { id: "att-001", driverId: "driver-001", driverName: "Ahmed Alotaibi", date: "2026-07-10", status: "present", approved: true },
  { id: "att-002", driverId: "driver-002", driverName: "Mona Alsubaie", date: "2026-07-10", status: "present", approved: true },
  { id: "att-003", driverId: "driver-001", driverName: "Ahmed Alotaibi", date: "2026-07-09", status: "on_leave", approved: true },
  { id: "att-004", driverId: "driver-002", driverName: "Mona Alsubaie", date: "2026-07-09", status: "present", approved: true },
]
