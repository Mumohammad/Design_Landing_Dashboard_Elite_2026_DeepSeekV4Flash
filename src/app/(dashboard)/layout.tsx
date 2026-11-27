import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { AppTopbar } from "@/components/dashboard/app-topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getWorkspaceBranding } from "@/lib/branding/workspace"

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const branding = await getWorkspaceBranding()
  return (
    <SidebarProvider defaultOpen>
      <AppSidebar collapsible="offcanvas" branding={branding} />
      <SidebarInset className="min-h-svh min-w-0 bg-background">
        <AppTopbar />
        <main id="main-content" className="workspace-canvas min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
