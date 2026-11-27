"use client"

import * as React from "react"
import { dashboardNavigation } from "@/lib/dashboard-navigation"
import Link from "next/link"
import { Building2 } from "lucide-react"
import { SidebarNotification } from "@/components/sidebar-notification"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import type { WorkspaceBranding } from "@/lib/branding/workspace"
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

export function AppSidebar({ branding, ...props }: React.ComponentProps<typeof Sidebar> & { branding?: WorkspaceBranding | null }) {
  const { t, locale } = useTranslation()

  const navGroups = dashboardNavigation(t, locale)

  // The signed-in company's own name/logo and the real user — never the
  // platform's brand or a placeholder address.
  const companyPrimary = (locale === "ar" ? branding?.companyNameAr : branding?.companyNameEn)
    || (locale === "ar" ? "مساحة العمل" : "Workspace")
  const companySecondary = locale === "ar" ? branding?.companyNameEn : branding?.companyNameAr
  const user = {
    name: branding?.userName || (locale === "ar" ? "حسابي" : "My account"),
    email: branding?.userEmail ?? "",
    avatar: branding?.userAvatar ?? "",
  }

  return (
    <Sidebar side={locale === "ar" ? "right" : "left"} {...props} className="sidebar-gradient text-sidebar-foreground">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                {branding?.logoUrl ? (
                  <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-md bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={branding.logoUrl} alt="" className="h-full w-full object-contain" data-testid="workspace-logo" />
                  </div>
                ) : (
                  <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-elite-blue-600 text-white">
                    <Building2 size={20} aria-hidden="true" />
                  </div>
                )}
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-semibold" data-testid="workspace-name">{companyPrimary}</span>
                  {companySecondary && companySecondary !== companyPrimary && (
                    <span className="truncate text-xs text-muted-foreground">{companySecondary}</span>
                  )}
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
