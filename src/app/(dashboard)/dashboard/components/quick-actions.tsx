"use client"

import Link from "next/link"
import { UserPlus, CarFront, CreditCard, BarChart3, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/hooks/use-translation"

export function QuickActions() {
  const { t } = useTranslation()

  const actions = [
    { label: t.dashboard.quickAddDriver, href: "/drivers", icon: UserPlus },
    { label: t.dashboard.quickAddVehicle, href: "/vehicles", icon: CarFront },
    { label: t.dashboard.quickRunPayroll, href: "/payroll", icon: CreditCard },
    { label: t.dashboard.quickViewReports, href: "/reports", icon: BarChart3 },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <Button key={action.href} variant="outline" size="sm" asChild className="group h-9 gap-2">
            <Link href={action.href}>
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {action.label}
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Button>
        )
      })}
    </div>
  )
}
