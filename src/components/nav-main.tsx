"use client"

import { ChevronRight, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { activeNavigationUrl } from "@/lib/navigation-active"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

type NavMainProps = {
  label: string
  accentColor?: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
    disabled?: boolean
    items?: {
      title: string
      url: string
      isActive?: boolean
    }[]
  }[]
}

export function NavMain(props: NavMainProps) {
  const pathname = usePathname()
  return <Suspense fallback={<NavigationItems {...props} pathname={pathname} query="" />}>
    <QueryNavigation {...props} pathname={pathname} />
  </Suspense>
}

function QueryNavigation(props: NavMainProps & { pathname: string }) {
  const query = useSearchParams()
  return <NavigationItems {...props} query={query.toString()} />
}

function NavigationItems({ label, items, pathname, query }: NavMainProps & { pathname: string; query: string }) {
  const urls = items.flatMap(item => item.items?.length ? item.items.map(child => child.url) : item.disabled ? [] : [item.url])
  const selected = activeNavigationUrl(pathname, query, urls)
  const isActiveItem = (url: string) => selected === url
  const shouldBeOpen = (item: typeof items[0]) =>
    !!item.isActive || !!item.items?.some((subItem) => isActiveItem(subItem.url))
  const currentLocation = (url: string) => isActiveItem(url) ? (pathname === new URL(url, "https://navigation.invalid").pathname ? "page" : "location") : undefined

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible key={`${item.title}:${shouldBeOpen(item)}`} asChild defaultOpen={shouldBeOpen(item)} className="group/collapsible">
            <SidebarMenuItem>
              {item.items?.length ? (
                <>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title} isActive={shouldBeOpen(item)} className="h-9 cursor-pointer max-sm:min-h-11">
                      {item.icon && <item.icon aria-hidden="true" />}
                      <span>{item.title}</span>
                      <ChevronRight aria-hidden="true" className="ms-auto transition-transform duration-200 rtl:-scale-x-100 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild className="min-h-9 cursor-pointer max-sm:min-h-11" isActive={isActiveItem(subItem.url)}>
                            <Link
                              href={subItem.url}
                              aria-current={currentLocation(subItem.url)}
                              target={(item.title === "Auth Pages" || item.title === "Errors") ? "_blank" : undefined}
                              rel={(item.title === "Auth Pages" || item.title === "Errors") ? "noopener noreferrer" : undefined}
                            >
                              <span>{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </>
              ) : item.disabled ? (
                <SidebarMenuButton tooltip={item.title} disabled aria-disabled="true" className="h-9 cursor-not-allowed opacity-70 max-sm:min-h-11">
                  {item.icon && <item.icon aria-hidden="true" />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild tooltip={item.title} className="h-9 cursor-pointer max-sm:min-h-11" isActive={isActiveItem(item.url)}>
                  <Link href={item.url} aria-current={currentLocation(item.url)}>
                    {item.icon && <item.icon aria-hidden="true" />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
