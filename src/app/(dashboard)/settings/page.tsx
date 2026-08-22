"use client"

import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"
import {
  Building2, Shield, ShieldCheck, Bell, Palette, CreditCard, KeyRound,
  FileText, Users, Globe, Database, Clock, Lock, ArrowLeft
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollReveal, StaggerContainer } from "@/components/ui/scroll-reveal"

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
    {
      title: t.common.status === "الحالة" ? "التحقق الثنائي (MFA)" : "Two-Factor Auth",
      description: t.common.status === "الحالة" ? "تطبيق المصادقة، QR، إدارة العوامل" : "Authenticator app, QR, factor management",
      href: "/settings/mfa",
      icon: ShieldCheck,
      color: "#10B981",
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6 page-enter">
      <ScrollReveal direction="fade" duration={400}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-muted/50 to-muted/30 border border-border/50 backdrop-blur-sm">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.nav.settings}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t.common.status === "الحالة" ? "إدارة إعدادات النظام والشركة والأمان" : "Manage system, company, and security settings"}
            </p>
          </div>
        </div>
      </ScrollReveal>

      <StaggerContainer staggerDelay={60} direction="up">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.href}
                href={card.href}
                className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 shadow-sm hover:shadow-lg hover:shadow-black/[0.04] transition-all duration-300 hover:-translate-y-0.5 hover:border-border/80"
              >
                {/* Animated gradient accent top line */}
                <div
                  className="absolute inset-x-0 top-0 h-[2px] opacity-0 group-hover:opacity-60 transition-opacity duration-300"
                  style={{ background: `linear-gradient(90deg, transparent, ${card.color}, transparent)` }}
                />
                {/* Soft glow behind icon */}
                <div
                  className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-[0.04] group-hover:opacity-[0.08] transition-opacity duration-500 blur-xl"
                  style={{ backgroundColor: card.color }}
                />
                <div className="relative">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl mb-4 transition-transform duration-300 group-hover:scale-110"
                    style={{ backgroundColor: `${card.color}12` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: card.color }} />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-1 group-hover:text-foreground transition-colors">{card.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ color: card.color }}>
                    <span>{t.common.status === "الحالة" ? "الإعدادات" : "Settings"}</span>
                    <ArrowLeft className="h-3 w-3 rtl:rotate-180" />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </StaggerContainer>
    </div>
  )
}
