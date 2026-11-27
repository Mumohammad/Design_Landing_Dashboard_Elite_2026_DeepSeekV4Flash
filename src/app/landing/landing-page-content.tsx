'use client';

import { LandingHeader } from '@/components/landing/landing-header';
import { HeroSection } from '@/components/landing/hero-section';
import { PlatformMarquee } from '@/components/landing/platform-marquee';
import { PlatformOverview } from '@/components/landing/platform-overview';
import { Driver360Section } from '@/components/landing/driver-360';
import { PayrollShowcase } from '@/components/landing/payroll-showcase';
import { FleetSection } from '@/components/landing/fleet-section';
import { OperationsSection } from '@/components/landing/operations-section';
import { ComplianceSection } from '@/components/landing/compliance-section';
import { CostControl } from '@/components/landing/cost-control';
import { ReportingSection } from '@/components/landing/reporting-section';
import { WorkflowSection } from '@/components/landing/workflow-section';
import { TrustSection } from '@/components/landing/trust-section';
import { PricingSection } from '@/components/landing/pricing-section';
import { FaqSection } from '@/components/landing/faq-section';
import { FinalCta } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/landing-footer';
import { useTranslation } from '@/hooks/use-translation';

export default function LandingPageContent() {
  const { locale } = useTranslation()
  return (
    <div lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="min-h-svh bg-background text-foreground">
      <a href="#landing-main" className="sr-only z-[60] bg-white px-4 py-3 font-semibold text-elite-blue-950 focus:not-sr-only focus:fixed focus:start-3 focus:top-3">{locale === "ar" ? "انتقل إلى المحتوى" : "Skip to content"}</a>
      <LandingHeader />
      <main id="landing-main" tabIndex={-1}>
        <HeroSection />
        <PlatformMarquee />
        <PlatformOverview />
        <Driver360Section />
        <PayrollShowcase />
        <FleetSection />
        <OperationsSection />
        <ComplianceSection />
        <CostControl />
        <ReportingSection />
        <WorkflowSection />
        <TrustSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
