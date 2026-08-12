"use client"

import React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { useSidebarConfig } from "@/hooks/use-sidebar-config"
import { useTranslation } from "@/hooks/use-translation"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { config } = useSidebarConfig()
  const { locale } = useTranslation()
  const isRtl = locale === "ar"

  // The sidebar layout gap is an in-flow element, so in RTL the sidebar must be
  // rendered first in the DOM for its gap to land on the reading-start edge
  // (right in Arabic). In LTR the sidebar comes first when it sits on the left.
  const sidebarFirst = isRtl ? config.side === "right" : config.side === "left"

  const sidebar = (
    <AppSidebar
      variant={config.variant}
      collapsible={config.collapsible}
      side={config.side}
    />
  )

  const inset = (
    <SidebarInset>
      <SiteHeader />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-6 py-4">
            {children}
          </div>
        </div>
      </div>
      <SiteFooter />
    </SidebarInset>
  )

  return (
    <>
      <Toaster position={isRtl ? "top-left" : "top-right"} richColors />
      <SidebarProvider
      style={{
        "--sidebar-width": "16rem",
        "--sidebar-width-icon": "3rem",
        "--header-height": "4rem",
      } as React.CSSProperties}
      className={config.collapsible === "none" ? "sidebar-none-mode" : ""}
    >
      {sidebarFirst ? (
        <>
          {sidebar}
          {inset}
        </>
      ) : (
        <>
          {inset}
          {sidebar}
        </>
      )}
      </SidebarProvider>
    </>
  )
}
