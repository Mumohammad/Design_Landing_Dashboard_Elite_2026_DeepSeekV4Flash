import type { Locale, TranslationStrings } from "./i18n/types"
import {
  Navigation,
  UsersRound,
  CarFront,
  CalendarClock,
  PackageSearch,
  LayoutTemplate,
  HandCoins,
  WalletCards,
  Receipt,
  FileBadge,
  Calculator,
  CreditCard,
  Wrench,
  Siren,
  Users,
  ChartLine,
  ShieldCheck,
  ClipboardCheck,
  FileSearch,
  FileCheck2,
  Fingerprint,
  Settings,
  ReceiptText,
} from "lucide-react"

export function dashboardNavigation(t: TranslationStrings, locale: Locale) {
  return [
    {
      label: t.nav.operations,
      accentColor: "#1E5A99",
      items: [
        { title: t.nav.dashboard, url: "/dashboard", icon: Navigation },
        { title: t.nav.drivers, url: "/drivers", icon: UsersRound },
        { title: t.nav.vehicles, url: "/vehicles", icon: CarFront },
        { title: t.nav.attendance, url: "/attendance", icon: CalendarClock },
        { title: t.nav.orders, url: "/orders", icon: PackageSearch },
        { title: t.nav.platforms, url: "/platforms", icon: LayoutTemplate },
      ],
    },
    {
      label: t.nav.finance,
      accentColor: "#10B981",
      items: [
        { title: t.nav.payroll, url: "/payroll", icon: HandCoins },
        { title: t.nav.expenses, url: "/expenses", icon: WalletCards },
        { title: locale === "ar" ? "مطالبات المصروفات" : "Expense claims", url: "/expenses/claims", icon: Receipt },
        { title: t.nav.invoices, url: "/invoices", icon: FileBadge },
        { title: t.nav.payments, url: "/payments", icon: CreditCard },
        { title: t.nav.accounting, url: "/accounting", icon: Calculator },
        { title: t.nav.einvoicing, url: "/accounting?tab=zatca", icon: FileCheck2 },
      ],
    },
    {
      label: t.nav.fleet,
      accentColor: "#F59E0B",
      items: [
        { title: t.nav.maintenance, url: "/maintenance", icon: Wrench },
        { title: t.nav.violations, url: "/violations", icon: Siren },
        { title: locale === "ar" ? "المخالفات المرورية" : "Traffic fines", url: "/violations/fines", icon: ReceiptText },
      ],
    },
    {
      label: t.nav.hr,
      accentColor: "#0F766E",
      items: [
        { title: t.nav.hrManagement, url: "/hr", icon: Users },
        { title: t.nav.applications, url: "/applications", icon: FileBadge },
      ],
    },
    {
      label: t.nav.analytics,
      accentColor: "#0EA5E9",
      items: [
        { title: t.nav.reports, url: "/reports", icon: ChartLine },
      ],
    },
    {
      label: t.nav.administration,
      accentColor: "#64748B",
      items: [
        { title: t.nav.users, url: "/users", icon: UsersRound },
        { title: t.nav.roles, url: "/roles", icon: ShieldCheck },
        { title: t.nav.approvals, url: "/approvals", icon: ClipboardCheck },
        { title: t.nav.auditLog, url: "/audit-log", icon: FileSearch },
        { title: t.nav.security, url: "/security", icon: Fingerprint },
        { title: t.nav.settings, url: "/settings", icon: Settings },
      ],
    },
  ]
}
