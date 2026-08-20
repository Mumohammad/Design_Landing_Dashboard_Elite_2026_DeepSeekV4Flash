"use client"

import * as React from "react"
import {
  Navigation,
  UsersRound,
  CarFront,
  CalendarClock,
  PackageSearch,
  LayoutTemplate,
  HandCoins,
  WalletCards,
  FileBadge,
  Calculator,
  Wrench,
  Siren,
  Users,
  ChartLine,
  ShieldCheck,
  FileSearch,
  Fingerprint,
  Settings,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { Logo } from "@/components/logo"
import { SidebarNotification } from "@/components/sidebar-notification"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { useTranslation } from "@/hooks/use-translation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()

  const navGroups = [
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
        { title: t.nav.invoices, url: "/invoices", icon: FileBadge },
        { title: t.nav.accounting, url: "/accounting", icon: Calculator },
      ],
    },
    {
      label: t.nav.fleet,
      accentColor: "#F59E0B",
      items: [
        { title: t.nav.maintenance, url: "/maintenance", icon: Wrench },
        { title: t.nav.violations, url: "/violations", icon: Siren },
      ],
    },
    {
      label: t.nav.hr,
      accentColor: "#8B5CF6",
      items: [
        { title: t.nav.hrManagement, url: "/hr", icon: Users },
        { title: t.nav.applications, url: "/applications", icon: FileBadge },
        { title: t.nav.templates, url: "/templates", icon: LayoutTemplate },
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
        { title: t.nav.auditLog, url: "/audit-log", icon: FileSearch },
        { title: t.nav.security, url: "/security", icon: Fingerprint },
        { title: t.nav.settings, url: "/settings", icon: Settings },
      ],
    },
  ]

  const user = {
    name: t.app.companyNameArabic,
    email: "operations@elite-dev.com",
    avatar: "",
  }

  return (
    <Sidebar {...props} className="sidebar-gradient text-white border-none shadow-xl">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/30">
                  <Logo size={24} className="text-current" />
                </div>
                <div className="grid flex-1 text-right text-sm leading-tight">
                  <span className="truncate font-semibold">{t.app.companyNameArabic}</span>
                  <span className="truncate text-xs text-white/50">{t.app.companyName}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavMain
            key={group.label}
            label={group.label}
            items={group.items}
            accentColor={group.accentColor}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarNotification />
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
