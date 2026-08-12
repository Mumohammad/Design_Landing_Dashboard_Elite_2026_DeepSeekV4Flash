"use client"

import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"
import {
  Building2, Shield, Bell, Palette, CreditCard, KeyRound,
  FileText, Users, Globe, Database, Clock, Lock
} from "lucide-react"

interface SettingCard {
  title: string
  description: string
  href: string
  icon: typeof Building2
  color: string
}

export default function SettingsPage() {
  const { t } = useTranslation()

  const cards: SettingCard[] = [
    {
      title: t.settings.companyProfile,
      description: t.common.status === "الحالة" ? "معلومات الشركة، السجل التجاري، الرقم الضريبي" : "Company info, CR, VAT number",
      href: "/settings/company",
      icon: Building2,
      color: "#1E5A99",
    },
    {
      title: t.settings.securitySettings,
      description: t.common.status === "الحالة" ? "كلمة المرور، التحقق الثنائي، الجلسات" : "Password, 2FA, sessions",
      href: "/settings/security",
      icon: Shield,
      color: "#EF4444",
    },
    {
      title: t.nav.users,
      description: t.common.status === "الحالة" ? "إدارة المستخدمين والدعوات" : "User management and invites",
      href: "/settings/users",
      icon: Users,
      color: "#8B5CF6",
    },
    {
      title: t.settings.language,
      description: t.common.status === "الحالة" ? "اللغة، المنطقة الزمنية، صيغة التاريخ" : "Language, timezone, date format",
      href: "/settings/language",
      icon: Globe,
      color: "#0EA5E9",
    },
    {
      title: t.settings.payrollDefaults,
      description: t.common.status === "الحالة" ? "الحد الأدنى للراتب، GOSI، البدلات" : "Minimum wage, GOSI, allowances",
      href: "/settings/payroll-defaults",
      icon: CreditCard,
      color: "#10B981",
    },
    {
      title: t.nav.auditLog,
      description: t.common.status === "الحالة" ? "سجل التدقيق غير القابل للتغيير" : "Immutable audit trail",
      href: "/audit-log",
      icon: FileText,
      color: "#F59E0B",
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.nav.settings}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.common.status === "الحالة" ? "إدارة إعدادات النظام والشركة والأمان" : "Manage system, company, and security settings"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-5 shadow-sm hover:shadow-md transition-all hover-lift"
            >
              <div
                className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.06]"
                style={{ backgroundColor: card.color, transform: "translate(30%, -30%)" }}
              />
              <div className="relative">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl mb-3"
                  style={{ backgroundColor: card.color + "15" }}
                >
                  <Icon className="h-5 w-5" style={{ color: card.color }} />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{card.title}</h3>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
