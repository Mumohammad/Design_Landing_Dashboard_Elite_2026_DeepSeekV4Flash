export const kpis = [
  { label: "Total Drivers", value: 128, delta: "+6%" },
  { label: "Active Today", value: 92, delta: "+4%" },
  { label: "Total Vehicles", value: 74, delta: "+2%" },
  { label: "Vehicles in Maintenance", value: 12, delta: "-1%" },
  { label: "Monthly Revenue", value: 218000, delta: "+8%", unit: "SAR" },
  { label: "Pending Invoices", value: 18, delta: "-12%" },
  { label: "Monthly Expenses", value: 102500, delta: "+3%", unit: "SAR" },
  { label: "Net Operational Result", value: 115500, delta: "+15%", unit: "SAR" },
]

export const recentActivity = [
  { id: "1", title: "تمت إضافة سائق جديد إلى فرع الرياض", subtitle: "Driver added to Riyadh operations", time: "قبل 12 دقيقة" },
  { id: "2", title: "اعتمدت رواتب شهر يونيو", subtitle: "June payroll approved", time: "قبل ساعة" },
  { id: "3", title: "تم فتح طلب صيانة للمركبة 32", subtitle: "Vehicle 32 maintenance opened", time: "قبل 2 ساعة" },
  { id: "4", title: "تم إصدار فاتورة جديدة للعميل الرئيسي", subtitle: "New invoice issued to major client", time: "قبل 3 ساعات" },
]

export const revenueTrend = [
  { month: "يناير", revenue: 14400 },
  { month: "فبراير", revenue: 16500 },
  { month: "مارس", revenue: 17900 },
  { month: "أبريل", revenue: 19800 },
  { month: "مايو", revenue: 21000 },
  { month: "يونيو", revenue: 21800 },
]

export const attendanceTrend = [
  { date: "16", present: 88, absent: 12 },
  { date: "17", present: 90, absent: 10 },
  { date: "18", present: 87, absent: 13 },
  { date: "19", present: 91, absent: 9 },
  { date: "20", present: 92, absent: 8 },
  { date: "21", present: 94, absent: 6 },
]

export const expenseBreakdown = [
  { name: "Fuel", value: 42000 },
  { name: "Maintenance", value: 26000 },
  { name: "Salaries", value: 21500 },
  { name: "Insurance", value: 13000 },
]

export const platformDistribution = [
  { platform: "HungerStation", value: 34 },
  { platform: "Jahez", value: 27 },
  { platform: "Keeta", value: 18 },
  { platform: "Ninja", value: 21 },
]
