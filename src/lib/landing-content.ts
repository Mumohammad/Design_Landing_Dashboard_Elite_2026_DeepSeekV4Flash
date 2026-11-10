// ─────────────────────────────────────────────────────────────────────────────
// Landing page content — structured bilingual marketing data.
// All demo values are explicitly product-preview data, never real performance.
// ─────────────────────────────────────────────────────────────────────────────

export type IconKey =
  | "drivers"
  | "fleet"
  | "vehicles"
  | "orders"
  | "payroll"
  | "attendance"
  | "violations"
  | "maintenance"
  | "expenses"
  | "documents"
  | "compliance"
  | "reports"
  | "performance"
  | "cost"
  | "security"
  | "audit"
  | "rbac"
  | "bilingual"
  | "handover"
  | "wps"
  | "export"
  | "languages"
  | "calendar"
  | "alert"
  | "check"
  | "shield"
  | "scale"
  | "banknote"
  | "users"
  | "car"
  | "dashboard"

export interface LandingContent {
  nav: {
    links: { label: string; href: string }[]
    signIn: string
    getStarted: string
    applyAsDriver: string
  }
  hero: {
    badge: string
    headlineA: string
    headlineB: string
    subheadline: string
    ctaPrimary: string
    ctaSecondary: string
    demoLabel: string
    flowTitle: string
    flow: string[]
  }
  kpi: {
    drivers: string
    vehicles: string
    orders: string
    payroll: string
  }
  preview: {
    searchPlaceholder: string
    sidebar: string[]
    kpiDeltas: string[]
    chartTitle: string
    chartSubtitle: string
    chartLabels: string[]
    chartValues: number[]
    last7Days: string
    tableTitle: string
    tableHeaders: string[]
    tableRows: {
      name: string
      id: string
      orders: string
      bonus: string
      deductions: string
      net: string
      status: string
      warn: boolean
    }[]
    alertsTitle: string
    alerts: { title: string; meta: string; tone: "info" | "warn" | "danger" }[]
    note: string
  }
  modules: {
    tag: string
    title: string
    subtitle: string
    items: { icon: IconKey; title: string; desc: string }[]
  }
  platforms: {
    tag: string
    title: string
    subtitle: string
  }
  driver360: {
    tag: string
    title: string
    subtitle: string
    name: string
    id: string
    status: string
    nationalityLabel: string
    nationality: string
    contractLabel: string
    contract: string
    categoryLabel: string
    category: string
    vehicleLabel: string
    vehicle: string
    stats: { icon: IconKey; label: string; value: string; tone?: "good" | "warn" }[]
    relationsTitle: string
    relationsSubtitle: string
    relations: { icon: IconKey; label: string; desc: string }[]
    contractsTitle: string
    contractsSubtitle: string
    contractsNote: string
    contracts: { title: string; desc: string; provided: string[] }[]
    note: string
  }
  payroll: {
    tag: string
    title: string
    subtitle: string
    calcTitle: string
    calcRows: { label: string; value: string; strong?: boolean }[]
    formulaTitle: string
    formulaLines: { label: string; amount: string; kind: "plus" | "minus" | "total" }[]
    configurable: string
    note: string
  }
  fleet: {
    tag: string
    title: string
    subtitle: string
    kpis: { label: string; value: string; tone: string }[]
    vehicleTitle: string
    vehicleName: string
    vehicleId: string
    fields: { label: string; value: string }[]
    statusLabel: string
    statusValue: string
    driverLabel: string
    driverValue: string
    serviceLabel: string
    serviceValue: string
    incidentsLabel: string
    incidentsValue: string
    costLabel: string
    costValue: string
    availabilityLabel: string
    availabilityValue: string
    note: string
  }
  operations: {
    tag: string
    title: string
    subtitle: string
    kpis: { label: string; value: string; tone: string }[]
    tableTitle: string
    tableHeaders: string[]
    tableRows: { driver: string; productivity: string; attendance: string; status: string; warn: boolean }[]
    droneCaption: string
    note: string
  }
  compliance: {
    tag: string
    title: string
    subtitle: string
    features: { icon: IconKey; title: string; desc: string }[]
    note: string
  }
  cost: {
    tag: string
    title: string
    subtitle: string
    costTitle: string
    costRows: { label: string; amount: string; kind: "plus" | "total" }[]
    result: string
    cards: { icon: IconKey; title: string; desc: string }[]
    note: string
  }
  pricing: {
    tag: string
    title: string
    subtitle: string
    plans: {
      name: string
      desc: string
      price: string
      period: string
      features: string[]
      cta: string
      popular?: boolean
    }[]
    note: string
  }
  reporting: {
    tag: string
    title: string
    subtitle: string
    chartTitle: string
    chartLabels: string[]
    seriesA: number[]
    seriesB: number[]
    cards: { icon: IconKey; title: string; desc: string }[]
    exportLabel: string
    note: string
  }
  workflow: {
    tag: string
    title: string
    subtitle: string
    steps: { title: string; desc: string }[]
  }
  benefits: {
    tag: string
    title: string
    subtitle: string
    items: { icon: IconKey; title: string; desc: string }[]
  }
  trust: {
    tag: string
    title: string
    subtitle: string
    items: { icon: IconKey; title: string; desc: string }[]
  }
  faq: {
    tag: string
    title: string
    subtitle: string
    items: { q: string; a: string }[]
  }
  finalCta: {
    title: string
    subtitle: string
    ctaPrimary: string
    ctaSecondary: string
    applyAsDriver: string
    applyAsDriverDesc: string
    note: string
  }
  footer: {
    tagline: string
    columns: { title: string; links: string[] }[]
    contactTitle: string
    address: string
    copyright: string
  }
}

const en: LandingContent = {
  nav: {
    links: [
      { label: "Platform", href: "#platform" },
      { label: "Drivers 360", href: "#driver360" },
      { label: "Payroll", href: "#payroll" },
      { label: "Fleet", href: "#fleet" },
      { label: "Operations", href: "#operations" },
      { label: "Compliance", href: "#compliance" },
      { label: "Reports", href: "#reports" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
    signIn: "Sign In",
    getStarted: "Get Started",
    applyAsDriver: "Apply as a Driver",
  },
  hero: {
    badge: "Enterprise Logistics Operations",
    headlineA: "Run Your Entire Logistics Operation",
    headlineB: "From One Command Center",
    subheadline:
      "Connect drivers, vehicles, orders, payroll, expenses and compliance in one centralized operational system — built for Saudi logistics operations.",
    ctaPrimary: "Explore the Platform",
    ctaSecondary: "Sign In",
    demoLabel: "Product preview",
    flowTitle: "One platform. Every operational record connected.",
    flow: ["Drivers", "Vehicles", "Orders", "Payroll", "Costs", "Reporting"],
  },
  kpi: {
    drivers: "Active drivers",
    vehicles: "Vehicles",
    orders: "Monthly orders",
    payroll: "Monthly payroll",
  },
  preview: {
    searchPlaceholder: "Search drivers, vehicles, orders…",
    sidebar: [
      "Dashboard",
      "Drivers",
      "Vehicles",
      "Attendance",
      "Payroll",
      "Expenses",
      "Maintenance",
      "Violations",
      "Reports",
    ],
    kpiDeltas: ["+4.2%", "+1.1%", "+8.7%", "−2.3%"],
    chartTitle: "Orders — last 7 days",
    chartSubtitle: "Completed orders per day",
    chartLabels: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
    chartValues: [2410, 2680, 2540, 2930, 2720, 3140, 2860],
    last7Days: "7 days",
    tableTitle: "Drivers — payroll impact",
    tableHeaders: ["Driver", "Orders", "Bonus", "Deductions", "Net", "Status"],
    tableRows: [
      { name: "Ahmed Al-Qahtani", id: "DRV-1024", orders: "478 / 450", bonus: "+252 SAR", deductions: "180 SAR", net: "2,072 SAR", status: "Active", warn: false },
      { name: "Mohammed Al-Otaibi", id: "DRV-1031", orders: "431 / 450", bonus: "—", deductions: "265 SAR", net: "1,735 SAR", status: "Active", warn: false },
      { name: "Khalid Al-Harbi", id: "DRV-1047", orders: "402 / 450", bonus: "−336 SAR", deductions: "—", net: "1,664 SAR", status: "Shortage", warn: true },
      { name: "Fahad Al-Dossari", id: "DRV-1052", orders: "489 / 450", bonus: "+351 SAR", deductions: "90 SAR", net: "2,261 SAR", status: "Active", warn: false },
      { name: "Saleh Al-Zahrani", id: "DRV-1068", orders: "396 / 450", bonus: "−378 SAR", deductions: "145 SAR", net: "1,477 SAR", status: "Shortage", warn: true },
    ],
    alertsTitle: "Operational alerts",
    alerts: [
      { title: "3 driver licenses expiring this month", meta: "Compliance", tone: "info" },
      { title: "2 vehicles due for maintenance", meta: "Fleet", tone: "warn" },
      { title: "1 payroll review pending approval", meta: "Payroll", tone: "danger" },
    ],
    note: "Preview data shown for demonstration only.",
  },
  platforms: {
    tag: "Delivery platforms",
    title: "Built to Connect With Every Delivery Platform",
    subtitle:
      "Drivers, orders and revenue tracked across the platforms your fleet delivers for — no spreadsheets, no double entry.",
  },
  modules: {
    tag: "Platform modules",
    title: "Everything Your Operation Needs. Connected.",
    subtitle:
      "Twelve operational modules, one source of truth. Each module feeds the others — a driver record, a vehicle, an order and a payroll line are never separate.",
    items: [
      { icon: "drivers", title: "Drivers", desc: "One 360° profile for identity, contracts, vehicles, performance, compliance, violations and payroll impact." },
      { icon: "fleet", title: "Fleet", desc: "Track vehicles, assignments, maintenance, incidents, costs and driver responsibility." },
      { icon: "vehicles", title: "Vehicles", desc: "Vehicle records with plates, documents, odometer logs, insurance and service dates." },
      { icon: "orders", title: "Orders", desc: "Order targets and actuals, multi-order batches and revenue variance per driver and platform." },
      { icon: "payroll", title: "Payroll", desc: "Earnings, bonuses, shortages, deductions and adjustments calculated from operational data." },
      { icon: "attendance", title: "Attendance", desc: "Schedules, grace periods, late policies, leave balances and working-day value." },
      { icon: "violations", title: "Violations", desc: "Sequenced references, dispute windows and a reversible deduction ledger." },
      { icon: "maintenance", title: "Maintenance", desc: "Service schedules, structured handover forms and vehicle-condition checklists." },
      { icon: "expenses", title: "Expenses", desc: "Fuel, advances, commissions and operational expenses with approval and deduction tracking." },
      { icon: "documents", title: "Documents", desc: "Driver and vehicle documents with expiry thresholds and readiness alerts." },
      { icon: "compliance", title: "Compliance", desc: "Monitor expirations, requirements and operational readiness in one place." },
      { icon: "reports", title: "Reports", desc: "Driver performance, payroll, fleet costs, violations and operational KPIs." },
    ],
  },
  driver360: {
    tag: "Driver 360°",
    title: "Know Every Driver. Not Just Their Name.",
    subtitle:
      "Every driver profile connects identity, vehicle, orders, attendance, violations, documents and payroll — one view tells the full story.",
    name: "Ahmed Al-Qahtani",
    id: "DRV-1024",
    status: "Active",
    nationalityLabel: "Nationality",
    nationality: "Saudi",
    contractLabel: "Contract",
    contract: "Sponsored — Type 1",
    categoryLabel: "Category",
    category: "Delivery driver",
    vehicleLabel: "Current vehicle",
    vehicle: "Hyundai Accent · ABC-1234",
    stats: [
      { icon: "orders", label: "Orders", value: "478 / 450", tone: "good" },
      { icon: "attendance", label: "Attendance", value: "26 / 26 days" },
      { icon: "performance", label: "Performance", value: "97%" },
      { icon: "payroll", label: "Net payroll", value: "2,072 SAR" },
      { icon: "violations", label: "Open violations", value: "0" },
      { icon: "documents", label: "Compliance items", value: "2", tone: "warn" },
    ],
    relationsTitle: "Every record is connected",
    relationsSubtitle:
      "The driver is the center of the operation — and every module links back to one profile.",
    contractsTitle: "Configurable contract models",
    contractsSubtitle:
      "Sponsored and freelancer structures are business models you define — not fixed legal classifications.",
    contractsNote: "Contract rules are configurable per company.",
    contracts: [
      {
        title: "Sponsored — Type 1",
        desc: "Company provides vehicle, petrol and accommodation.",
        provided: ["Vehicle", "Petrol", "Accommodation"],
      },
      {
        title: "Sponsored — Type 2",
        desc: "Company provides vehicle and accommodation, without petrol.",
        provided: ["Vehicle", "Accommodation"],
      },
      {
        title: "Freelancer",
        desc: "Company-defined calculation rules for freelance drivers.",
        provided: ["Company-defined rules"],
      },
    ],
    relations: [
      { icon: "orders", label: "Orders", desc: "Targets, actuals and revenue variance" },
      { icon: "attendance", label: "Attendance", desc: "Working days and late policies" },
      { icon: "vehicles", label: "Vehicle", desc: "Assignment and responsibility" },
      { icon: "maintenance", label: "Maintenance", desc: "Charges and condition checks" },
      { icon: "violations", label: "Violations", desc: "Sequenced, disputable, reversible" },
      { icon: "payroll", label: "Payroll", desc: "Bonuses, deductions and net" },
    ],
    note: "Preview driver profile — not a real record.",
  },
  payroll: {
    tag: "Payroll",
    title: "Payroll That Understands the Operation",
    subtitle:
      "Earnings and deductions are calculated from real operational data — order targets, shortages, approved violations, maintenance charges and adjustments.",
    calcTitle: "Example monthly calculation",
    calcRows: [
      { label: "Order target", value: "450 orders" },
      { label: "Working period", value: "26 days" },
      { label: "Base salary", value: "2,000 SAR" },
      { label: "Actual orders", value: "478" },
      { label: "Bonus (28 × 9 SAR)", value: "+252 SAR", strong: true },
      { label: "Operational deductions", value: "−180 SAR", strong: true },
      { label: "Net salary", value: "2,072 SAR", strong: true },
    ],
    formulaTitle: "Where the money goes",
    formulaLines: [
      { label: "Orders", amount: "Base + bonus", kind: "plus" },
      { label: "Performance & bonuses", amount: "+ 252 SAR", kind: "plus" },
      { label: "Approved violations", amount: "− 0 SAR", kind: "minus" },
      { label: "Vehicle charges", amount: "− 120 SAR", kind: "minus" },
      { label: "Maintenance charges", amount: "− 60 SAR", kind: "minus" },
      { label: "Advances & adjustments", amount: "− 0 SAR", kind: "minus" },
      { label: "Net payroll", amount: "2,072 SAR", kind: "total" },
    ],
    configurable:
      "Rules are configurable per company — targets, bonus and shortage rates, and deduction types are all your choice.",
    note: "Example rule set only — not a universal or legal standard.",
  },
  fleet: {
    tag: "Fleet & vehicles",
    title: "Every Vehicle, Driver and Cost Connected",
    subtitle:
      "Vehicle records link the assigned driver, maintenance history, incidents, documents and the payroll impact of every charge.",
    kpis: [
      { label: "Available", value: "214", tone: "good" },
      { label: "Assigned", value: "150", tone: "info" },
      { label: "In maintenance", value: "22", tone: "warn" },
    ],
    vehicleTitle: "Vehicle record",
    vehicleName: "Hyundai Accent 2023",
    vehicleId: "VHC-0182 · ABC-1234",
    fields: [
      { label: "Assigned driver", value: "Ahmed Al-Qahtani" },
      { label: "Next service", value: "in 12 days" },
      { label: "Incidents", value: "0 this month" },
      { label: "Costs this month", value: "1,240 SAR" },
    ],
    statusLabel: "Status",
    statusValue: "On road",
    driverLabel: "Assigned driver",
    driverValue: "Ahmed Al-Qahtani",
    serviceLabel: "Next service",
    serviceValue: "in 12 days",
    incidentsLabel: "Incidents",
    incidentsValue: "0",
    costLabel: "Costs this month",
    costValue: "1,240 SAR",
    availabilityLabel: "Operational availability",
    availabilityValue: "96%",
    note: "Preview fleet data — for demonstration only.",
  },
  operations: {
    tag: "Operations",
    title: "A Command Center for Daily Operations",
    subtitle:
      "Drivers, attendance, vehicles and alerts in one operational view — with the data clearly labeled as preview.",
    kpis: [
      { label: "Drivers on duty", value: "386", tone: "info" },
      { label: "Attendance rate", value: "96%", tone: "good" },
      { label: "Vehicles on road", value: "214", tone: "good" },
      { label: "Maintenance due", value: "22", tone: "warn" },
    ],
    tableTitle: "Driver productivity",
    tableHeaders: ["Driver", "Productivity", "Attendance", "Status"],
    tableRows: [
      { driver: "Ahmed Al-Qahtani", productivity: "97%", attendance: "26/26", status: "On target", warn: false },
      { driver: "Fahad Al-Dossari", productivity: "99%", attendance: "26/26", status: "On target", warn: false },
      { driver: "Khalid Al-Harbi", productivity: "84%", attendance: "24/26", status: "Below target", warn: true },
      { driver: "Saleh Al-Zahrani", productivity: "82%", attendance: "23/26", status: "Below target", warn: true },
    ],
    droneCaption: "Drone view — monitoring the operation from above",
    note: "Preview operational data.",
  },
  compliance: {
    tag: "Compliance",
    title: "Built for the Realities of Saudi Logistics Operations",
    subtitle:
      "Centralized document and expiry management keeps your operation ready for review — without claiming integrations we don't have.",
    features: [
      { icon: "documents", title: "Driver documents", desc: "Iqama, license and insurance with expiry thresholds and readiness alerts." },
      { icon: "vehicles", title: "Vehicle documents", desc: "Registration, inspection and insurance tracked per vehicle." },
      { icon: "audit", title: "Audit-ready records", desc: "Immutable audit trail across operations, payroll and financial records." },
      { icon: "payroll", title: "Traceable payroll", desc: "Every bonus and deduction links back to an operational record." },
    ],
    note: "Compliance-ready design for Saudi operations — centralized management, no external API claims.",
  },
  cost: {
    tag: "Cost control",
    title: "Turn Operational Activity Into Financial Visibility",
    subtitle:
      "Understand what each driver really costs each month — salary, bonuses, fuel, platform commissions, vehicle charges and violations in one view.",
    costTitle: "Cost per driver — monthly",
    costRows: [
      { label: "Base salary", amount: "2,000 SAR", kind: "plus" },
      { label: "Bonus", amount: "+252 SAR", kind: "plus" },
      { label: "Fuel", amount: "1,150 SAR", kind: "plus" },
      { label: "Platform commission", amount: "840 SAR", kind: "plus" },
      { label: "Vehicle & maintenance charges", amount: "180 SAR", kind: "plus" },
      { label: "Approved violations", amount: "0 SAR", kind: "plus" },
      { label: "True monthly cost", amount: "4,422 SAR", kind: "total" },
    ],
    result: "True cost",
    cards: [
      { icon: "cost", title: "True operational cost", desc: "See what each driver, vehicle and platform actually costs per month." },
      { icon: "banknote", title: "Deduction traceability", desc: "Every deduction has an approval trail — nothing is silent." },
      { icon: "reports", title: "Driver financial impact", desc: "Understand how violations and maintenance charges shape net payroll." },
    ],
    note: "The platform connects orders, drivers, vehicles, maintenance, violations, expenses and payroll into one financial view.",
  },
  pricing: {
    tag: "Pricing",
    title: "Simple Plans for Any Fleet Size",
    subtitle:
      "Start with the essentials and grow as your operation grows. Plans shown are illustrative — final pricing is configured per operation.",
    plans: [
      {
        name: "Starter",
        desc: "For small fleets getting organized",
        price: "299",
        period: "SAR / month",
        features: [
          "Up to 25 drivers",
          "Drivers & vehicles records",
          "Attendance tracking",
          "Monthly payroll",
          "Standard reports",
        ],
        cta: "Get Started",
      },
      {
        name: "Growth",
        desc: "For growing operations",
        price: "799",
        period: "SAR / month",
        features: [
          "Up to 100 drivers",
          "All 12 platform modules",
          "Payroll rules & deductions",
          "Advanced reports & export",
          "Priority support",
        ],
        cta: "Get Started",
        popular: true,
      },
      {
        name: "Enterprise",
        desc: "For multi-branch operations",
        price: "Custom",
        period: "per operation",
        features: [
          "Unlimited drivers & vehicles",
          "Multi-company ready",
          "Custom payroll rules",
          "Dedicated onboarding",
          "SLA & account manager",
        ],
        cta: "Request Access",
      },
    ],
    note: "Plans shown for illustration — pricing and limits are configured per operation on request.",
  },
  reporting: {
    tag: "Reporting",
    title: "Reports That Answer Real Questions",
    subtitle:
      "Driver performance, payroll, fleet costs, violations, attendance and operational KPIs — exportable to PDF and Excel.",
    chartTitle: "Driver performance trend",
    chartLabels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    seriesA: [72, 78, 81, 84, 88, 92],
    seriesB: [60, 64, 66, 70, 74, 79],
    cards: [
      { icon: "performance", title: "Driver performance", desc: "Orders, targets and productivity per driver." },
      { icon: "cost", title: "Fleet costs", desc: "Maintenance, incidents and charges per vehicle." },
      { icon: "payroll", title: "Payroll summary", desc: "Bonuses, deductions and net across the fleet." },
    ],
    exportLabel: "Export · Print · PDF · Excel",
    note: "Export-ready reports built from operational records.",
  },
  workflow: {
    tag: "Connected workflow",
    title: "From Hiring to Payroll in One Connected Flow",
    subtitle:
      "Ten steps. Every one feeds the next — so nothing has to be re-entered twice.",
    steps: [
      { title: "Add driver", desc: "Identity, iqama, license and contact details" },
      { title: "Assign contract", desc: "Sponsored or freelancer — configurable rules" },
      { title: "Assign vehicle", desc: "Handover form and condition checklist" },
      { title: "Track orders", desc: "Daily targets and actuals per driver" },
      { title: "Track attendance", desc: "Working days, grace and late policies" },
      { title: "Capture violations & costs", desc: "Approved deductions with audit trail" },
      { title: "Calculate payroll", desc: "Bonuses, shortages and adjustments" },
      { title: "Review", desc: "Every line traceable to its source" },
      { title: "Approve", desc: "Locked records, immutable history" },
      { title: "Export & print", desc: "PDF and Excel for review and records" },
    ],
  },
  benefits: {
    tag: "Business benefits",
    title: "Built to Save Time and Money Every Month",
    subtitle:
      "The platform reduces manual work and gives management a clear operational picture.",
    items: [
      { icon: "check", title: "Reduce manual work", desc: "One entry feeds orders, attendance, payroll and reports." },
      { icon: "payroll", title: "Improve payroll accuracy", desc: "Calculations come from operational records, not spreadsheets." },
      { icon: "banknote", title: "Control operational deductions", desc: "Approved, traceable, reversible." },
      { icon: "cost", title: "Understand vehicle costs", desc: "Maintenance and incidents per vehicle, per month." },
      { icon: "performance", title: "Track driver performance", desc: "Orders, productivity and attendance in one view." },
      { icon: "documents", title: "Prevent document expiry", desc: "Thresholds and alerts before documents lapse." },
      { icon: "compliance", title: "Centralize records", desc: "A single source of truth for the whole operation." },
      { icon: "reports", title: "Improve management visibility", desc: "KPIs that answer real operational questions." },
    ],
  },
  trust: {
    tag: "Trust & security",
    title: "Enterprise-Grade by Design",
    subtitle:
      "Role-based access, audit history and financial traceability are part of the platform — not an afterthought.",
    items: [
      { icon: "security", title: "Secure architecture", desc: "Tenant-isolated records with a secure backend foundation." },
      { icon: "rbac", title: "Role-based access", desc: "Every user sees only what their role allows." },
      { icon: "audit", title: "Audit history", desc: "Immutable records across operations and finance." },
      { icon: "documents", title: "Document management", desc: "Controlled access to driver and vehicle documents." },
      { icon: "payroll", title: "Financial traceability", desc: "Every calculation links back to its operational source." },
      { icon: "bilingual", title: "Bilingual by design", desc: "Arabic RTL and English LTR, equally polished." },
      { icon: "languages", title: "Saudi-ready workflows", desc: "SAR, driver documentation and local operational patterns." },
      { icon: "scale", title: "Future multi-tenant architecture", desc: "Designed to support multiple companies per installation." },
    ],
  },
  faq: {
    tag: "FAQ",
    title: "Frequently Asked Questions",
    subtitle: "Short answers about the platform and how it works.",
    items: [
      {
        q: "What is Elite Development?",
        a: "An enterprise logistics operations platform that connects drivers, vehicles, orders, payroll, compliance, expenses, violations, maintenance, attendance and performance in one operational system.",
      },
      {
        q: "Who is it designed for?",
        a: "Logistics and 3PL operators in Saudi Arabia who manage delivery fleets, sponsored or freelance drivers, and monthly payroll.",
      },
      {
        q: "Can I manage drivers and vehicles together?",
        a: "Yes. A driver profile links to a vehicle, and a vehicle record links to its driver, maintenance and incidents — they are never separate.",
      },
      {
        q: "How does payroll work?",
        a: "Payroll is calculated from operational data: order targets and actuals, attendance, approved violations, vehicle and maintenance charges, advances and adjustments.",
      },
      {
        q: "Can payroll rules be customized?",
        a: "Yes. Targets, bonus rates, shortage rates and deduction types are configurable per company.",
      },
      {
        q: "Can violations affect payroll?",
        a: "Approved violations can flow into payroll as deductions, each with its own approval and audit trail.",
      },
      {
        q: "Can maintenance costs be associated with drivers?",
        a: "Yes. Vehicle charges and maintenance costs can be linked to the assigned driver and reflected in payroll.",
      },
      {
        q: "Does it support freelancers?",
        a: "Yes. Freelancer contracts use company-defined calculation rules, separate from sponsored contract types.",
      },
      {
        q: "Does it support sponsored drivers?",
        a: "Yes. Sponsored contract structures are configurable — for example vehicle + petrol + accommodation, or vehicle + accommodation without petrol.",
      },
      {
        q: "Does it support Arabic and RTL?",
        a: "Yes. The full interface is bilingual — Arabic RTL and English LTR — including dashboards, forms and reports.",
      },
      {
        q: "Is it designed for Saudi operations?",
        a: "Yes. SAR, driver documentation, compliance tracking and Saudi operational workflows are built into the product.",
      },
      {
        q: "Does it support future multi-company architecture?",
        a: "Yes. The architecture is designed to support multiple companies per installation in a future phase.",
      },
      {
        q: "Does it integrate with external platforms?",
        a: "External integrations are part of the future architecture — the current platform centralizes your operational records first.",
      },
    ],
  },
  finalCta: {
    title: "Your Operation Is Complex. Your Control Center Shouldn't Be.",
    subtitle:
      "Bring drivers, fleet, payroll, operations and financial visibility together in one platform.",
    ctaPrimary: "Explore the Platform",
    ctaSecondary: "View Dashboard",
    applyAsDriver: "Apply as a Driver",
    applyAsDriverDesc: "Join our delivery team — complete your driver application in minutes, no account needed.",
    note: "Sign in to open the platform.",
  },
  footer: {
    tagline: "The operating system for the logistics operation.",
    columns: [
      { title: "Platform", links: ["Drivers", "Fleet", "Payroll", "Operations", "Reports"] },
      { title: "Company", links: ["About", "Contact", "Careers"] },
      { title: "Resources", links: ["Documentation", "Help", "FAQ"] },
      { title: "Legal", links: ["Privacy", "Terms"] },
    ],
    contactTitle: "Contact",
    address: "Al-Qassim, Saudi Arabia",
    copyright: "© {year} Elite Development",
  },
}

const ar: LandingContent = {
  nav: {
    links: [
      { label: "المنصة", href: "#platform" },
      { label: "ملف السائق", href: "#driver360" },
      { label: "الرواتب", href: "#payroll" },
      { label: "الأسطول", href: "#fleet" },
      { label: "العمليات", href: "#operations" },
      { label: "الامتثال", href: "#compliance" },
      { label: "التقارير", href: "#reports" },
      { label: "الأسعار", href: "#pricing" },
      { label: "الأسئلة", href: "#faq" },
    ],
    signIn: "تسجيل الدخول",
    getStarted: "ابدأ الآن",
    applyAsDriver: "سجّل كسائق",
  },
  hero: {
    badge: "عمليات لوجستية مؤسسية",
    headlineA: "شغّل عمليتك اللوجستية بالكامل",
    headlineB: "من مركز قيادة واحد",
    subheadline:
      "اربط السائقين والمركبات والطلبات والرواتب والمصروفات والامتثال في نظام تشغيلي مركزي واحد — مصمم لعمليات اللوجستيات السعودية.",
    ctaPrimary: "استكشف المنصة",
    ctaSecondary: "تسجيل الدخول",
    demoLabel: "معاينة المنتج",
    flowTitle: "منصة واحدة. كل السجلات التشغيلية مترابطة.",
    flow: ["السائقون", "المركبات", "الطلبات", "الرواتب", "التكاليف", "التقارير"],
  },
  kpi: {
    drivers: "سائق نشط",
    vehicles: "مركبة",
    orders: "طلب شهريًا",
    payroll: "الرواتب الشهرية",
  },
  preview: {
    searchPlaceholder: "ابحث عن سائق أو مركبة أو طلب…",
    sidebar: [
      "لوحة التحكم",
      "السائقون",
      "المركبات",
      "الحضور",
      "الرواتب",
      "المصروفات",
      "الصيانة",
      "المخالفات",
      "التقارير",
    ],
    kpiDeltas: ["+4.2%", "+1.1%", "+8.7%", "−2.3%"],
    chartTitle: "الطلبات — آخر 7 أيام",
    chartSubtitle: "الطلبات المكتملة يوميًا",
    chartLabels: ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"],
    chartValues: [2410, 2680, 2540, 2930, 2720, 3140, 2860],
    last7Days: "٧ أيام",
    tableTitle: "السائقون — أثر الرواتب",
    tableHeaders: ["السائق", "الطلبات", "المكافأة", "الخصومات", "الصافي", "الحالة"],
    tableRows: [
      { name: "أحمد القحطاني", id: "DRV-1024", orders: "478 / 450", bonus: "+252 ر.س", deductions: "180 ر.س", net: "2,072 ر.س", status: "نشط", warn: false },
      { name: "محمد العتيبي", id: "DRV-1031", orders: "431 / 450", bonus: "—", deductions: "265 ر.س", net: "1,735 ر.س", status: "نشط", warn: false },
      { name: "خالد الحربي", id: "DRV-1047", orders: "402 / 450", bonus: "−336 ر.س", deductions: "—", net: "1,664 ر.س", status: "عجز", warn: true },
      { name: "فهد الدوسري", id: "DRV-1052", orders: "489 / 450", bonus: "+351 ر.س", deductions: "90 ر.س", net: "2,261 ر.س", status: "نشط", warn: false },
      { name: "صالح الزهراني", id: "DRV-1068", orders: "396 / 450", bonus: "−378 ر.س", deductions: "145 ر.س", net: "1,477 ر.س", status: "عجز", warn: true },
    ],
    alertsTitle: "تنبيهات تشغيلية",
    alerts: [
      { title: "3 رخص سائق تنتهي هذا الشهر", meta: "الامتثال", tone: "info" },
      { title: "مركبتان تحتاجان صيانة", meta: "الأسطول", tone: "warn" },
      { title: "مراجعة راتب بانتظار الاعتماد", meta: "الرواتب", tone: "danger" },
    ],
    note: "بيانات معاينة لأغراض العرض فقط.",
  },
  platforms: {
    tag: "منصات التوصيل",
    title: "مصممة للعمل مع كل منصات التوصيل",
    subtitle:
      "السائقون والطلبات والإيرادات متتبعة عبر المنصات التي يعمل عليها أسطولك — دون جداول أو إدخال مزدوج.",
  },
  modules: {
    tag: "وحدات المنصة",
    title: "كل ما تحتاجه عمليتك. مترابط.",
    subtitle:
      "اثنتا عشرة وحدة تشغيلية، مصدر حقيقة واحد. كل وحدة تغذي الأخرى — سجل السائق والمركبة والطلب وبند الراتب ليست أبدًا منفصلة.",
    items: [
      { icon: "drivers", title: "السائقون", desc: "ملف 360° للهوية والعقود والمركبات والأداء والامتثال والمخالفات وأثر الرواتب." },
      { icon: "fleet", title: "الأسطول", desc: "تتبع المركبات والتعيينات والصيانة والحوادث والتكاليف ومسؤولية السائق." },
      { icon: "vehicles", title: "المركبات", desc: "سجلات المركبات مع اللوحات والمستندات وسجل العداد والتأمين وتواريخ الخدمة." },
      { icon: "orders", title: "الطلبات", desc: "أهداف الطلبات والفعلي والدفعات المتعددة وتباين الإيراد لكل سائق ومنصة." },
      { icon: "payroll", title: "الرواتب", desc: "الاستحقاقات والمكافآت والعجز والخصومات والتسويات محسوبة من البيانات التشغيلية." },
      { icon: "attendance", title: "الحضور", desc: "الجداول وفترات السماح وسياسات التأخير وأرصدة الإجازات وقيمة يوم العمل." },
      { icon: "violations", title: "المخالفات", desc: "مراجع متسلسلة ونوافذ الاعتراض وسجل خصم قابل للتراجع." },
      { icon: "maintenance", title: "الصيانة", desc: "جداول الخدمة ونماذج التسليم المنظمة وقوائم فحص حالة المركبة." },
      { icon: "expenses", title: "المصروفات", desc: "الوقود والسلف والعمولات والمصروفات التشغيلية مع الموافقة وتتبع الخصم." },
      { icon: "documents", title: "المستندات", desc: "مستندات السائقين والمركبات مع عتبات الانتهاء وتنبيهات الجاهزية." },
      { icon: "compliance", title: "الامتثال", desc: "راقب الانتهاءات والمتطلبات والجاهزية التشغيلية في مكان واحد." },
      { icon: "reports", title: "التقارير", desc: "أداء السائقين والرواتب وتكاليف الأسطول والمخالفات ومؤشرات التشغيل." },
    ],
  },
  driver360: {
    tag: "ملف السائق 360°",
    title: "اعرف كل سائق. ليس اسمه فقط.",
    subtitle:
      "يربط ملف كل سائق بين الهوية والمركبة والطلبات والحضور والمخالفات والمستندات والرواتب — عرض واحد يحكي القصة كاملة.",
    name: "أحمد القحطاني",
    id: "DRV-1024",
    status: "نشط",
    nationalityLabel: "الجنسية",
    nationality: "سعودي",
    contractLabel: "العقد",
    contract: "مكفول — النوع 1",
    categoryLabel: "الفئة",
    category: "سائق توصيل",
    vehicleLabel: "المركبة الحالية",
    vehicle: "هيونداي أكسنت · أ ب ج 1234",
    stats: [
      { icon: "orders", label: "الطلبات", value: "478 / 450", tone: "good" },
      { icon: "attendance", label: "الحضور", value: "26 / 26 يوم" },
      { icon: "performance", label: "الأداء", value: "97%" },
      { icon: "payroll", label: "صافي الراتب", value: "2,072 ر.س" },
      { icon: "violations", label: "مخالفات مفتوحة", value: "0" },
      { icon: "documents", label: "بنود الامتثال", value: "2", tone: "warn" },
    ],
    relationsTitle: "كل سجل مرتبط بالآخر",
    relationsSubtitle: "السائق هو مركز العملية — وكل وحدة تعود إلى ملف واحد.",
    contractsTitle: "نماذج عقود قابلة للتخصيص",
    contractsSubtitle:
      "هياكل المكفول والحر نماذج أعمال تحددها أنت — وليست تصنيفات قانونية ثابتة.",
    contractsNote: "قواعد العقود قابلة للتخصيص لكل شركة.",
    contracts: [
      {
        title: "مكفول — النوع 1",
        desc: "توفر الشركة المركبة والبنزين والسكن.",
        provided: ["المركبة", "البنزين", "السكن"],
      },
      {
        title: "مكفول — النوع 2",
        desc: "توفر الشركة المركبة والسكن دون البنزين.",
        provided: ["المركبة", "السكن"],
      },
      {
        title: "سائق حر",
        desc: "قواعد حساب تحددها الشركة للسائقين الأحرار.",
        provided: ["قواعد تحددها الشركة"],
      },
    ],
    relations: [
      { icon: "orders", label: "الطلبات", desc: "الأهداف والفعلي وتباين الإيراد" },
      { icon: "attendance", label: "الحضور", desc: "أيام العمل وسياسات التأخير" },
      { icon: "vehicles", label: "المركبة", desc: "التعيين والمسؤولية" },
      { icon: "maintenance", label: "الصيانة", desc: "الرسوم وفحوصات الحالة" },
      { icon: "violations", label: "المخالفات", desc: "متسلسلة وقابلة للاعتراض والتراجع" },
      { icon: "payroll", label: "الرواتب", desc: "المكافآت والخصومات والصافي" },
    ],
    note: "ملف سائق تجريبي — وليس سجلًا حقيقيًا.",
  },
  payroll: {
    tag: "الرواتب",
    title: "رواتب تفهم العملية التشغيلية",
    subtitle:
      "تُحسب الاستحقاقات والخصومات من بيانات تشغيلية حقيقية — أهداف الطلبات والعجز والمخالفات المعتمدة ورسوم الصيانة والتسويات.",
    calcTitle: "مثال على حساب شهري",
    calcRows: [
      { label: "هدف الطلبات", value: "450 طلبًا" },
      { label: "فترة العمل", value: "26 يومًا" },
      { label: "الراتب الأساسي", value: "2,000 ر.س" },
      { label: "الطلبات الفعلية", value: "478" },
      { label: "المكافأة (28 × 9 ر.س)", value: "+252 ر.س", strong: true },
      { label: "الخصومات التشغيلية", value: "−180 ر.س", strong: true },
      { label: "صافي الراتب", value: "2,072 ر.س", strong: true },
    ],
    formulaTitle: "أين تذهب الأموال",
    formulaLines: [
      { label: "الطلبات", amount: "أساس + مكافأة", kind: "plus" },
      { label: "الأداء والمكافآت", amount: "+ 252 ر.س", kind: "plus" },
      { label: "المخالفات المعتمدة", amount: "− 0 ر.س", kind: "minus" },
      { label: "رسوم المركبات", amount: "− 120 ر.س", kind: "minus" },
      { label: "رسوم الصيانة", amount: "− 60 ر.س", kind: "minus" },
      { label: "السلف والتسويات", amount: "− 0 ر.س", kind: "minus" },
      { label: "صافي الراتب", amount: "2,072 ر.س", kind: "total" },
    ],
    configurable:
      "القواعد قابلة للتخصيص لكل شركة — الأهداف ومعدلات المكافأة والعجز وأنواع الخصومات خيارك.",
    note: "مثال على قواعد قابلة للتخصيص فقط — وليس معيارًا عامًا أو قانونيًا.",
  },
  fleet: {
    tag: "الأسطول والمركبات",
    title: "كل مركبة وسائق وتكلفة مترابطة",
    subtitle:
      "تربط سجلات المركبات السائق المعين وتاريخ الصيانة والحوادث والمستندات والأثر على الرواتب لكل رسوم.",
    kpis: [
      { label: "متاحة", value: "214", tone: "good" },
      { label: "معينة", value: "150", tone: "info" },
      { label: "تحت الصيانة", value: "22", tone: "warn" },
    ],
    vehicleTitle: "سجل المركبة",
    vehicleName: "هيونداي أكسنت 2023",
    vehicleId: "VHC-0182 · أ ب ج 1234",
    fields: [
      { label: "السائق المعين", value: "أحمد القحطاني" },
      { label: "الخدمة القادمة", value: "بعد 12 يومًا" },
      { label: "الحوادث", value: "0 هذا الشهر" },
      { label: "التكاليف هذا الشهر", value: "1,240 ر.س" },
    ],
    statusLabel: "الحالة",
    statusValue: "على الطريق",
    driverLabel: "السائق المعين",
    driverValue: "أحمد القحطاني",
    serviceLabel: "الخدمة القادمة",
    serviceValue: "بعد 12 يومًا",
    incidentsLabel: "الحوادث",
    incidentsValue: "0",
    costLabel: "التكاليف هذا الشهر",
    costValue: "1,240 ر.س",
    availabilityLabel: "الجاهزية التشغيلية",
    availabilityValue: "96%",
    note: "بيانات أسطول تجريبية — لأغراض العرض فقط.",
  },
  operations: {
    tag: "العمليات",
    title: "مركز قيادة للعمليات اليومية",
    subtitle:
      "السائقون والحضور والمركبات والتنبيهات في عرض تشغيلي واحد — مع بيانات معلمة بوضوح على أنها معاينة.",
    kpis: [
      { label: "سائقون على المناوبة", value: "386", tone: "info" },
      { label: "نسبة الحضور", value: "96%", tone: "good" },
      { label: "مركبات على الطريق", value: "214", tone: "good" },
      { label: "صيانة مستحقة", value: "22", tone: "warn" },
    ],
    tableTitle: "إنتاجية السائقين",
    tableHeaders: ["السائق", "الإنتاجية", "الحضور", "الحالة"],
    tableRows: [
      { driver: "أحمد القحطاني", productivity: "97%", attendance: "26/26", status: "على الهدف", warn: false },
      { driver: "فهد الدوسري", productivity: "99%", attendance: "26/26", status: "على الهدف", warn: false },
      { driver: "خالد الحربي", productivity: "84%", attendance: "24/26", status: "دون الهدف", warn: true },
      { driver: "صالح الزهراني", productivity: "82%", attendance: "23/26", status: "دون الهدف", warn: true },
    ],
    droneCaption: "منظار جوي — مراقبة العملية من الأعلى",
    note: "بيانات تشغيلية تجريبية.",
  },
  compliance: {
    tag: "الامتثال",
    title: "مصمم لواقع عمليات اللوجستيات السعودية",
    subtitle:
      "إدارة مركزية للمستندات والانتهاءات تُبقي عمليتك جاهزة للمراجعة — دون ادعاء تكاملات غير موجودة.",
    features: [
      { icon: "documents", title: "مستندات السائقين", desc: "الإقامة والرخصة والتأمين مع عتبات الانتهاء وتنبيهات الجاهزية." },
      { icon: "vehicles", title: "مستندات المركبات", desc: "التسجيل والفحص والتأمين متتبع لكل مركبة." },
      { icon: "audit", title: "سجلات جاهزة للتدقيق", desc: "سجل تدقيق غير قابل للتغيير عبر العمليات والرواتب والسجلات المالية." },
      { icon: "payroll", title: "رواتب قابلة للتتبع", desc: "كل مكافأة وخصم يعود إلى سجل تشغيلي." },
    ],
    note: "تصميم جاهز للامتثال للعمليات السعودية — إدارة مركزية دون ادعاء تكاملات خارجية.",
  },
  cost: {
    tag: "التحكم في التكاليف",
    title: "حوّل النشاط التشغيلي إلى رؤية مالية",
    subtitle:
      "افهم كم يكلف كل سائق فعليًا كل شهر — الراتب والمكافآت والوقود وعمولات المنصات ورسوم المركبات والمخالفات في عرض واحد.",
    costTitle: "تكلفة السائق — شهريًا",
    costRows: [
      { label: "الراتب الأساسي", amount: "2,000 ر.س", kind: "plus" },
      { label: "المكافأة", amount: "+252 ر.س", kind: "plus" },
      { label: "الوقود", amount: "1,150 ر.س", kind: "plus" },
      { label: "عمولة المنصة", amount: "840 ر.س", kind: "plus" },
      { label: "رسوم المركبة والصيانة", amount: "180 ر.س", kind: "plus" },
      { label: "المخالفات المعتمدة", amount: "0 ر.س", kind: "plus" },
      { label: "التكلفة الشهرية الحقيقية", amount: "4,422 ر.س", kind: "total" },
    ],
    result: "التكلفة الحقيقية",
    cards: [
      { icon: "cost", title: "التكلفة التشغيلية الحقيقية", desc: "اعرف كم يكلف كل سائق ومركبة ومنصة شهريًا." },
      { icon: "banknote", title: "تتبع الخصومات", desc: "كل خصم له سجل موافقة — لا شيء صامت." },
      { icon: "reports", title: "الأثر المالي للسائق", desc: "افهم كيف تشكل المخالفات ورسوم الصيانة صافي الراتب." },
    ],
    note: "تربط المنصة الطلبات والسائقين والمركبات والصيانة والمخالفات والمصروفات والرواتب في رؤية مالية واحدة.",
  },
  pricing: {
    tag: "الأسعار",
    title: "خطط بسيطة لأي حجم أسطول",
    subtitle:
      "ابدأ بالأساسيات وانمُ مع نمو عمليتك. الخطط المعروضة استرشادية — السعر النهائي يُحدد لكل عملية.",
    plans: [
      {
        name: "البداية",
        desc: "للأساطيل الصغيرة التي تنظم عملها",
        price: "299",
        period: "ر.س / شهريًا",
        features: [
          "حتى 25 سائقًا",
          "سجلات السائقين والمركبات",
          "تتبع الحضور",
          "الرواتب الشهرية",
          "تقارير قياسية",
        ],
        cta: "ابدأ الآن",
      },
      {
        name: "النمو",
        desc: "للعمليات المتنامية",
        price: "799",
        period: "ر.س / شهريًا",
        features: [
          "حتى 100 سائق",
          "جميع وحدات المنصة الـ12",
          "قواعد الرواتب والخصومات",
          "تقارير متقدمة وتصدير",
          "دعم أولوية",
        ],
        cta: "ابدأ الآن",
        popular: true,
      },
      {
        name: "المؤسسات",
        desc: "للعمليات متعددة الفروع",
        price: "حسب الطلب",
        period: "لكل عملية",
        features: [
          "سائقون ومركبات بلا حدود",
          "جاهزة لعدة جهات",
          "قواعد رواتب مخصصة",
          "إعداد مخصص",
          "اتفاقية مستوى خدمة ومدير حساب",
        ],
        cta: "اطلب الوصول",
      },
    ],
    note: "الخطط استرشادية — السعر والحدود يُحددان لكل عملية عند الطلب.",
  },
  reporting: {
    tag: "التقارير",
    title: "تقارير تجيب عن أسئلة حقيقية",
    subtitle:
      "أداء السائقين والرواتب وتكاليف الأسطول والمخالفات والحضور ومؤشرات التشغيل — قابلة للتصدير PDF و Excel.",
    chartTitle: "اتجاه أداء السائقين",
    chartLabels: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو"],
    seriesA: [72, 78, 81, 84, 88, 92],
    seriesB: [60, 64, 66, 70, 74, 79],
    cards: [
      { icon: "performance", title: "أداء السائقين", desc: "الطلبات والأهداف والإنتاجية لكل سائق." },
      { icon: "cost", title: "تكاليف الأسطول", desc: "الصيانة والحوادث والرسوم لكل مركبة." },
      { icon: "payroll", title: "ملخص الرواتب", desc: "المكافآت والخصومات والصافي عبر الأسطول." },
    ],
    exportLabel: "تصدير · طباعة · PDF · Excel",
    note: "تقارير جاهزة للتصدير مبنية من السجلات التشغيلية.",
  },
  workflow: {
    tag: "سير عمل مترابط",
    title: "من التوظيف إلى الرواتب في تدفق واحد مترابط",
    subtitle: "عشر خطوات. كل خطوة تغذي التالية — فلا يُدخل أي شيء مرتين.",
    steps: [
      { title: "أضف سائقًا", desc: "الهوية والإقامة والرخصة وبيانات التواصل" },
      { title: "عيّن عقدًا", desc: "مكفول أو حر — قواعد قابلة للتخصيص" },
      { title: "عيّن مركبة", desc: "نموذج تسليم وقائمة فحص الحالة" },
      { title: "تابع الطلبات", desc: "الأهداف اليومية والفعلي لكل سائق" },
      { title: "تابع الحضور", desc: "أيام العمل وفترات السماح وسياسات التأخير" },
      { title: "سجّل المخالفات والتكاليف", desc: "خصومات معتمدة مع سجل تدقيق" },
      { title: "احسب الرواتب", desc: "المكافآت والعجز والتسويات" },
      { title: "راجع", desc: "كل بند يعود إلى مصدره" },
      { title: "اعتمد", desc: "سجلات مقفلة وتاريخ غير قابل للتغيير" },
      { title: "صدّر واطبع", desc: "PDF و Excel للمراجعة والسجلات" },
    ],
  },
  benefits: {
    tag: "فوائد الأعمال",
    title: "مصممة لتوفير الوقت والمال كل شهر",
    subtitle: "تقلل المنصة العمل اليدوي وتعطي الإدارة صورة تشغيلية واضحة.",
    items: [
      { icon: "check", title: "قلل العمل اليدوي", desc: "إدخال واحد يغذي الطلبات والحضور والرواتب والتقارير." },
      { icon: "payroll", title: "حسّن دقة الرواتب", desc: "الحسابات تأتي من السجلات التشغيلية لا من الجداول." },
      { icon: "banknote", title: "تحكم بالخصومات التشغيلية", desc: "معتمدة وقابلة للتتبع والتراجع." },
      { icon: "cost", title: "افهم تكاليف المركبات", desc: "الصيانة والحوادث لكل مركبة شهريًا." },
      { icon: "performance", title: "تابع أداء السائقين", desc: "الطلبات والإنتاجية والحضور في عرض واحد." },
      { icon: "documents", title: "امنع انتهاء المستندات", desc: "عتبات وتنبيهات قبل انتهاء المستندات." },
      { icon: "compliance", title: "مركزية السجلات", desc: "مصدر حقيقة واحد للعملية كلها." },
      { icon: "reports", title: "حسّن رؤية الإدارة", desc: "مؤشرات تجيب عن أسئلة تشغيلية حقيقية." },
    ],
  },
  trust: {
    tag: "الثقة والأمان",
    title: "بجودة المؤسسات بحكم التصميم",
    subtitle: "الوصول القائم على الدور وسجل التدقيق وقابلية التتبع المالي جزء من المنصة — وليس فكرة لاحقة.",
    items: [
      { icon: "security", title: "بنية آمنة", desc: "سجلات معزولة لكل جهة مع أساس خلفي آمن." },
      { icon: "rbac", title: "وصول قائم على الدور", desc: "كل مستخدم يرى فقط ما يسمح به دوره." },
      { icon: "audit", title: "سجل تدقيق", desc: "سجلات غير قابلة للتغيير عبر العمليات والمالية." },
      { icon: "documents", title: "إدارة المستندات", desc: "وصول متحكم فيه لمستندات السائقين والمركبات." },
      { icon: "payroll", title: "قابلية التتبع المالي", desc: "كل حساب يعود إلى مصدره التشغيلي." },
      { icon: "bilingual", title: "ثنائية اللغة بحكم التصميم", desc: "عربية RTL وإنجليزية LTR بنفس الجودة." },
      { icon: "languages", title: "سير عمل سعودي", desc: "الريال السعودي ومستندات السائقين وأنماط التشغيل المحلية." },
      { icon: "scale", title: "بنية متعددة الجهات مستقبلاً", desc: "مصممة لدعم أكثر من شركة في التثبيت الواحد." },
    ],
  },
  faq: {
    tag: "الأسئلة الشائعة",
    title: "أسئلة متكررة",
    subtitle: "إجابات مختصرة عن المنصة وكيف تعمل.",
    items: [
      {
        q: "ما هي نخبة التطوير؟",
        a: "منصة تشغيل لوجستي مؤسسية تربط السائقين والمركبات والطلبات والرواتب والامتثال والمصروفات والمخالفات والصيانة والحضور والأداء في نظام تشغيلي واحد.",
      },
      {
        q: "لمن صُممت؟",
        a: "لمشغلي اللوجستيات وخدمات الطرف الثالث في السعودية الذين يديرون أساطيل توصيل وسائقين مكفولين أو أحرارًا ورواتب شهرية.",
      },
      {
        q: "هل يمكنني إدارة السائقين والمركبات معًا؟",
        a: "نعم. ملف السائق يرتبط بمركبة، وسجل المركبة يرتبط بسائقها وصيانتها وحوادثها — وهما لا يكونان منفصلين أبدًا.",
      },
      {
        q: "كيف تعمل الرواتب؟",
        a: "تُحسب الرواتب من بيانات تشغيلية: أهداف الطلبات وواقعها والحضور والمخالفات المعتمدة ورسوم المركبات والصيانة والسلف والتسويات.",
      },
      {
        q: "هل يمكن تخصيص قواعد الرواتب؟",
        a: "نعم. الأهداف ومعدلات المكافأة والعجز وأنواع الخصومات قابلة للتخصيص لكل شركة.",
      },
      {
        q: "هل يمكن أن تؤثر المخالفات على الرواتب؟",
        a: "يمكن للمخالفات المعتمدة أن تدخل في الرواتب كخصومات، ولكل منها موافقة وسجل تدقيق خاص.",
      },
      {
        q: "هل يمكن ربط تكاليف الصيانة بالسائقين؟",
        a: "نعم. يمكن ربط رسوم المركبات وتكاليف الصيانة بالسائق المعين وتنعكس في الراتب.",
      },
      {
        q: "هل تدعم السائقين الأحرار؟",
        a: "نعم. عقود السائقين الأحرار تستخدم قواعد حساب تحددها الشركة، منفصلة عن أنواع العقود المكفولة.",
      },
      {
        q: "هل تدعم السائقين المكفولين؟",
        a: "نعم. هياكل العقود المكفولة قابلة للتخصيص — مثل مركبة + بنزين + سكن، أو مركبة + سكن دون بنزين.",
      },
      {
        q: "هل تدعم العربية والاتجاه RTL؟",
        a: "نعم. الواجهة كاملة ثنائية اللغة — عربية RTL وإنجليزية LTR — بما فيها لوحات التحكم والنماذج والتقارير.",
      },
      {
        q: "هل مصممة للعمليات السعودية؟",
        a: "نعم. الريال السعودي ومستندات السائقين وتتبع الامتثال وسير العمل السعودي مدمجة في المنتج.",
      },
      {
        q: "هل تدعم بنية متعددة الجهات مستقبلاً؟",
        a: "نعم. البنية مصممة لدعم أكثر من شركة لكل تثبيت في مرحلة لاحقة.",
      },
      {
        q: "هل تتكامل مع منصات خارجية؟",
        a: "التكاملات الخارجية جزء من البنية المستقبلية — المنصة الحالية تركز أولاً على مركزية سجلاتك التشغيلية.",
      },
    ],
  },
  finalCta: {
    title: "عمليتك معقدة. مركز التحكم لا يجب أن يكون كذلك.",
    subtitle: "اجمع السائقين والأسطول والرواتب والعمليات والرؤية المالية في منصة واحدة.",
    ctaPrimary: "استكشف المنصة",
    ctaSecondary: "عرض لوحة التحكم",
    applyAsDriver: "سجّل كسائق",
    applyAsDriverDesc: "انضم إلى فريق التوصيل — أكمل طلب السائق في دقائق دون الحاجة إلى حساب.",
    note: "سجّل الدخول لفتح المنصة.",
  },
  footer: {
    tagline: "نظام التشغيل للعملية اللوجستية.",
    columns: [
      { title: "المنصة", links: ["السائقون", "الأسطول", "الرواتب", "العمليات", "التقارير"] },
      { title: "الشركة", links: ["من نحن", "تواصل معنا", "الوظائف"] },
      { title: "الموارد", links: ["التوثيق", "المساعدة", "الأسئلة"] },
      { title: "قانوني", links: ["الخصوصية", "الشروط"] },
    ],
    contactTitle: "تواصل معنا",
    address: "القصيم، المملكة العربية السعودية",
    copyright: "© {year} نخبة التطوير",
  },
}

export const landingContent: Record<"en" | "ar", LandingContent> = { en, ar }
