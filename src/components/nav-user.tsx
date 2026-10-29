"use client"

import {
  EllipsisVertical,
  LogOut,
  Fingerprint,
  Settings,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS } from "@/lib/redirects"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer"
            >
              <UserAvatar user={user} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
              <EllipsisVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-xl border-border/50 bg-card"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserAvatar user={user} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg">
                <Link href="/settings/security" className="flex items-center gap-2">
                  <Fingerprint className="h-4 w-4 text-muted-foreground" />
                  {t.nav.security}
                  <ChevronRight className="ms-auto h-3 w-3 text-muted-foreground rtl:rotate-180" />
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg">
                <Link href="/settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  {t.nav.settings}
                  <ChevronRight className="ms-auto h-3 w-3 text-muted-foreground rtl:rotate-180" />
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer rounded-lg text-red-600 dark:text-red-400">
              {/* Full-page navigation to the centralized sign-out route: it
                  clears the Supabase session and lands on the public landing
                  page (acceptance test F). A client <Link> would race the
                  sidebar's client-side router against cookie clearing. */}
              <a href={REDIRECTS.signOutUrl} className="flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                {t.nav.signOut}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function UserAvatar({ user }: { user: { name: string; avatar: string } }) {
  if (user.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.avatar} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
    )
  }
  const initial = user.name.trim().charAt(0).toUpperCase() || "?"
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elite-blue-600/10 text-sm font-semibold text-elite-blue-700 dark:text-elite-blue-200" aria-hidden="true">
      {initial}
    </div>
  )
}
