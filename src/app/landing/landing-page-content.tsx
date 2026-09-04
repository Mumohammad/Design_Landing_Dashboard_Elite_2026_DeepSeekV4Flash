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

export default function LandingPageContent() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingHeader />
      <main>
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
