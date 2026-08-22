"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import {
  Search,
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
  HelpCircle,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/hooks/use-translation"
import { cn } from "@/lib/utils"

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-xl bg-white/95 backdrop-blur-xl dark:bg-zinc-950/95 text-zinc-950 dark:text-zinc-50",
      className
    )}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Input
    ref={ref}
    className={cn(
      "flex h-14 w-full border-none bg-transparent px-5 py-4 text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border-b border-zinc-200/70 dark:border-zinc-800/70",
      className
    )}
    {...props}
  />
))
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[380px] overflow-y-auto overflow-x-hidden py-2", className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="flex h-16 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400"
    {...props}
  />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden px-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-400 dark:[&_[cmdk-group-heading]]:text-zinc-500 [&:not(:first-child)]:mt-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-zinc-100 dark:[&:not(:first-child)]:border-zinc-800/70 [&:not(:first-child)]:pt-1.5",
      className
    )}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex h-11 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-sm text-zinc-700 dark:text-zinc-300 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-elite-blue-500/10 data-[selected=true]:to-elite-orange-500/10 data-[selected=true]:text-zinc-900 dark:data-[selected=true]:text-zinc-50 data-[selected=true]:ring-1 data-[selected=true]:ring-elite-blue-500/20 data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

interface SearchItem {
  title: string
  url: string
  group: string
  icon?: LucideIcon
  accent?: string
}

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter()
  const commandRef = React.useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const searchItems: SearchItem[] = [
    // Operations
    { title: t.nav.dashboard, url: "/dashboard", group: t.nav.operations, icon: Navigation, accent: "#1E5A99" },
    { title: t.nav.drivers, url: "/drivers", group: t.nav.operations, icon: UsersRound, accent: "#1E5A99" },
    { title: t.nav.vehicles, url: "/vehicles", group: t.nav.operations, icon: CarFront, accent: "#1E5A99" },
    { title: t.nav.attendance, url: "/attendance", group: t.nav.operations, icon: CalendarClock, accent: "#1E5A99" },
    { title: t.nav.platforms, url: "/platforms", group: t.nav.operations, icon: LayoutTemplate, accent: "#1E5A99" },

    // Finance
    { title: t.nav.payroll, url: "/payroll", group: t.nav.finance, icon: HandCoins, accent: "#10B981" },
    { title: t.nav.expenses, url: "/expenses", group: t.nav.finance, icon: WalletCards, accent: "#10B981" },
    { title: t.nav.invoices, url: "/invoices", group: t.nav.finance, icon: FileBadge, accent: "#10B981" },
    { title: t.nav.accounting, url: "/accounting", group: t.nav.finance, icon: Calculator, accent: "#10B981" },

    // Fleet
    { title: t.nav.maintenance, url: "/maintenance", group: t.nav.fleet, icon: Wrench, accent: "#F59E0B" },
    { title: t.nav.violations, url: "/violations", group: t.nav.fleet, icon: Siren, accent: "#F59E0B" },

    // HR
    { title: t.nav.hrManagement, url: "/hr", group: t.nav.hr, icon: Users, accent: "#8B5CF6" },
    { title: t.nav.templates, url: "/templates", group: t.nav.hr, icon: LayoutTemplate, accent: "#8B5CF6" },

    // Analytics
    { title: t.nav.reports, url: "/reports", group: t.nav.analytics, icon: ChartLine, accent: "#0EA5E9" },

    // Administration
    { title: t.nav.users, url: "/users", group: t.nav.administration, icon: UsersRound, accent: "#64748B" },
    { title: t.nav.roles, url: "/roles", group: t.nav.administration, icon: ShieldCheck, accent: "#64748B" },
    { title: t.nav.auditLog, url: "/audit-log", group: t.nav.administration, icon: FileSearch, accent: "#64748B" },
    { title: t.nav.security, url: "/security", group: t.nav.administration, icon: Fingerprint, accent: "#64748B" },
    { title: t.nav.settings, url: "/settings", group: t.nav.administration, icon: Settings, accent: "#64748B" },

    // Pages
    { title: t.navExtra.faqs, url: "/faqs", group: t.pages.help, icon: HelpCircle, accent: "#0EA5E9" },
    { title: t.navExtra.pricing, url: "/pricing", group: t.pages.help, icon: HandCoins, accent: "#E87D3E" },
  ]

  const groupedItems = searchItems.reduce((acc, item) => {
    if (!acc[item.group]) {
      acc[item.group] = []
    }
    acc[item.group].push(item)
    return acc
  }, {} as Record<string, SearchItem[]>)

  const handleSelect = (url: string) => {
    router.push(url)
    onOpenChange(false)
    if (commandRef.current) {
      commandRef.current.style.transform = "scale(0.97)"
      setTimeout(() => {
        if (commandRef.current) {
          commandRef.current.style.transform = ""
        }
      }, 120)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 border-0 shadow-2xl shadow-elite-blue-950/30 max-w-[600px] rounded-2xl">
        {/* Gradient top accent */}
        <div className="h-1 w-full bg-gradient-to-r from-elite-blue-500 via-elite-blue-600 to-elite-orange-500" />
        <DialogTitle className="sr-only">Command Search</DialogTitle>
        <Command
          ref={commandRef}
          className="transition-transform duration-120 ease-out"
        >
          <CommandInput
            placeholder={t.common.searchPlaceholder}
            autoFocus
            className="bg-transparent"
          />
          <CommandList>
            <CommandEmpty>{t.common.noData}</CommandEmpty>
            {Object.entries(groupedItems).map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => {
                  const Icon = item.icon
                  return (
                    <CommandItem
                      key={item.url}
                      value={item.title}
                      onSelect={() => handleSelect(item.url)}
                    >
                      {Icon && (
                        <span
                          className="flex size-7 shrink-0 items-center justify-center rounded-md"
                          style={{ backgroundColor: `${item.accent}1a`, color: item.accent }}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                      )}
                      <span className="flex-1 truncate">{item.title}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-zinc-300 opacity-0 transition-opacity data-[selected=true]:opacity-100 dark:text-zinc-600" />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-zinc-200/70 bg-zinc-50/80 px-5 py-2.5 text-[11px] text-zinc-400 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:text-zinc-500">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">↑↓</kbd>
            {t.common.navigate}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">↵</kbd>
            {t.common.open}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">esc</kbd>
            {t.common.close}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SearchTrigger({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      className="group inline-flex h-9 w-full items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 text-sm text-muted-foreground shadow-sm transition-all hover:border-elite-blue-500/40 hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-xs md:w-72 lg:w-80"
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground/70" />
      <span className="hidden flex-1 truncate text-start sm:block">{t.common.searchPlaceholder}</span>
      <span className="flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground/80 transition-colors group-hover:border-elite-blue-500/30 group-hover:text-elite-blue-600 dark:group-hover:text-elite-blue-300">
        <span>⌘</span>K
      </span>
    </button>
  )
}
