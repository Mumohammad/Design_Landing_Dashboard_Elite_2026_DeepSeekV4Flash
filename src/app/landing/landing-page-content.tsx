"use client"

import { LandingHeader } from "@/components/landing/landing-header"
import { HeroSection } from "@/components/landing/hero-section"
import { PlatformMarquee } from "@/components/landing/platform-marquee"
import { PlatformOverview } from "@/components/landing/platform-overview"
import { Driver360Section } from "@/components/landing/driver-360"
import { PayrollShowcase } from "@/components/landing/payroll-showcase"
import { FleetSection } from "@/components/landing/fleet-section"
import { OperationsSection } from "@/components/landing/operations-section"
import { ComplianceSection } from "@/components/landing/compliance-section"
import { CostControl } from "@/components/landing/cost-control"
import { ReportingSection } from "@/components/landing/reporting-section"
import { WorkflowSection } from "@/components/landing/workflow-section"
import { TrustSection } from "@/components/landing/trust-section"
import { PricingSection } from "@/components/landing/pricing-section"
import { FaqSection } from "@/components/landing/faq-section"
import { FinalCta } from "@/components/landing/final-cta"
import { LandingFooter } from "@/components/landing/landing-footer"
import { ScrollReveal } from "@/components/ui/scroll-reveal"

export function LandingPageContent() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingHeader />
      <main>
        <HeroSection />
        <ScrollReveal direction="fade" duration={600}>
          <PlatformMarquee />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <PlatformOverview />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <Driver360Section />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <PayrollShowcase />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <FleetSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <OperationsSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <ComplianceSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <CostControl />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <ReportingSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <WorkflowSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <TrustSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <PricingSection />
        </ScrollReveal>
        <ScrollReveal direction="up" duration={700}>
          <FaqSection />
        </ScrollReveal>
        <ScrollReveal direction="scale" duration={700}>
          <FinalCta />
        </ScrollReveal>
      </main>
      <LandingFooter />
    </div>
  )
}
