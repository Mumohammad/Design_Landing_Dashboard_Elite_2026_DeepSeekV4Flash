"use client"

import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"
import {
  Building2,
  Shield,
  ShieldCheck,
  CreditCard,
  KeyRound,
  FileText,
  Users,
  Globe,
  ArrowRight,
  BellRing,
  Wallet,
} from "lucide-react"

interface SettingCard {
  title: string
  description: string
  href: string
  icon: typeof Building2
}

export default function SettingsPage() {
  const { t } = useTranslation()

  const cards: SettingCard[] = [
    {
      title: t.settings.companyProfile,
      description: t.common.status === "الحالة" ? "معلومات الشركة، السجل التجاري، الرقم الضريبي" : "Company info, CR, VAT number",
      href: "/settings/company",
      icon: Building2,
    },
    {
      title: t.settings.securitySettings,
      description: t.common.status === "الحالة" ? "كلمة المرور، التحقق الثنائي، الجلسات" : "Password, 2FA, sessions",
      href: "/settings/security",
      icon: Shield,
    },
    {
      title: t.nav.users,
      description: t.common.status === "الحالة" ? "إدارة المستخدمين والدعوات" : "User management and invites",
      href: "/settings/users",
      icon: Users,
    },
    {
      title: t.settings.language,
      description: t.common.status === "الحالة" ? "اللغة، المنطقة الزمنية، صيغة التاريخ" : "Language, timezone, date format",
      href: "/settings/language",
      icon: Globe,
    },
    {
      title: t.settings.payrollDefaults,
      description: t.common.status === "الحالة" ? "الحد الأدنى للراتب، GOSI، البدلات" : "Minimum wage, GOSI, allowances",
      href: "/settings/payroll-defaults",
      icon: CreditCard,
    },
    {
      title: t.nav.auditLog,
      description: t.common.status === "الحالة" ? "سجل التدقيق غير القابل للتغيير" : "Immutable audit trail",
      href: "/audit-log",
      icon: FileText,
    },
    {
      title: t.common.status === "الحالة" ? "التحقق الثنائي (MFA)" : "Two-Factor Auth",
      description: t.common.status === "الحالة" ? "تطبيق المصادقة، QR، إدارة العوامل" : "Authenticator app, QR, factor management",
      href: "/settings/mfa",
      icon: ShieldCheck,
    },
    {
      title: t.common.status === "الحالة" ? "الإشعارات والتنبيهات" : "Notifications",
      description: t.common.status === "الحالة" ? "ملخص بريدي دوري للإدارة بانتهاء الوثائق والفواتير المتأخرة" : "Periodic email digest of expiring documents and overdue invoices",
      href: "/settings/notifications",
      icon: BellRing,
    },
    {
      title: t.common.status === "الحالة" ? "الفوترة والاشتراك" : "Billing & subscription",
      description: t.common.status === "الحالة" ? "فواتير الاشتراك والدفع بمدى وفيزا وApple Pay" : "Subscription invoices, pay by mada, Visa or Apple Pay",
      href: "/settings/billing",
      icon: Wallet,
    },
  ]

  return (
    <div className="space-y-6 py-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t.nav.settings}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t.common.status === "الحالة" ? "إدارة إعدادات النظام والشركة والأمان" : "Manage system, company, and security settings"}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.href}
                href={card.href}
                className="group rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:last:col-span-2"
              >
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <h2 className="text-base font-medium text-foreground">{card.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground">
                  <span>{t.common.status === "الحالة" ? "الإعدادات" : "Settings"}</span>
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </div>
              </Link>
            )
          })}
        </div>
    </div>
  )
}
