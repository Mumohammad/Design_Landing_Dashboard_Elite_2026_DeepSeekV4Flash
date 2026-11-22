"use client"

import { LocalizedText } from "@/components/localized-text"
import * as React from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import { ArrowUpRight, Search } from "lucide-react"
import { dashboardNavigation } from "@/lib/dashboard-navigation"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/hooks/use-translation"
import { cn } from "@/lib/utils"

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-lg bg-card text-foreground",
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
      "flex h-14 w-full border-0 border-b border-border bg-card py-4 ps-5 pe-14 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
    className="flex h-16 items-center justify-center text-sm text-muted-foreground"
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
      "overflow-hidden px-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&:not(:first-child)]:mt-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-1.5",
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
      "group/command-item relative flex h-11 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-sm text-foreground outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-70",
      className
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const groups = dashboardNavigation(t, locale)

  const handleSelect = (url: string) => {
    router.push(url)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[600px]">
        <DialogTitle className="sr-only"><LocalizedText text="Command Search" /></DialogTitle>
        <DialogDescription className="sr-only">
          {t.common.searchPlaceholder}
        </DialogDescription>
        <Command>
          <CommandInput
            aria-label={t.common.searchPlaceholder}
            placeholder={t.common.searchPlaceholder}
            autoFocus
            className="bg-transparent"
          />
          <CommandList>
            <CommandEmpty>{t.common.noData}</CommandEmpty>
            {groups.map(({ label: group, items }) => (
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
                        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate">{item.title}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity rtl:-scale-x-100 group-data-[selected=true]/command-item:opacity-100" />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {/* Footer hints */}
        <div className="flex flex-wrap items-center gap-4 border-t border-border bg-card px-5 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">↑↓</kbd>
            {t.common.navigate}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">↵</kbd>
            {t.common.open}
          </span>
          <span className="ms-auto flex items-center gap-1.5">
            <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">esc</kbd>
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
      type="button"
      aria-label={t.common.searchPlaceholder}
      onClick={onClick}
      className="group inline-flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:min-h-11 sm:max-w-xs md:w-72 lg:w-80"
    >
      <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-start">{t.common.searchPlaceholder}</span>
      <span className="hidden items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:flex">
        <span>⌘</span>K
      </span>
    </button>
  )
}
