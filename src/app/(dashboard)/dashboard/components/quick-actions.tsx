"use client"

import Link from "next/link"
import { UserPlus, CarFront, CreditCard, BarChart3, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/hooks/use-translation"

export function QuickActions() {
  const { t } = useTranslation()

  const actions = [
    { label: t.dashboard.quickAddDriver, href: "/drivers", icon: UserPlus, color: "#1E5A99" },
    { label: t.dashboard.quickAddVehicle, href: "/vehicles", icon: CarFront, color: "#E87D3E" },
    { label: t.dashboard.quickRunPayroll, href: "/payroll", icon: CreditCard, color: "#10B981" },
    { label: t.dashboard.quickViewReports, href: "/reports", icon: BarChart3, color: "#8B5CF6" },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <Button key={action.href} variant="outline" size="sm" asChild className="group h-9 gap-2 rounded-xl">
            <Link href={action.href}>
              <span
                className="flex h-5 w-5 items-center justify-center rounded-md"
                style={{ backgroundColor: `${action.color}1a`, color: action.color }}
              >
                <Icon className="h-3 w-3" />
              </span>
              {action.label}
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Button>
        )
      })}
    </div>
  )
}
