"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function ChartCard({
  title,
  icon: Icon,
  description,
  action,
  children,
  className,
}: {
  title: string
  icon?: LucideIcon
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("rounded-lg border-border bg-card shadow-none", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">{Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
