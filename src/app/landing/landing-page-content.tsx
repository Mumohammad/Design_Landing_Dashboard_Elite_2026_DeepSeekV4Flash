'use client';

import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';
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
      {/* Platform entry banner — links the B2B platform to the landing page */}
      <div className="relative z-[60] bg-gradient-to-r from-elite-blue-600 via-elite-blue-500 to-elite-orange-500 px-4 py-2.5 text-center text-white">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-semibold sm:text-sm">
          <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" /> للشركات: مساحة عمل خاصة بشعارك وبياناتك</span>
          <Link href="/platform" className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 backdrop-blur-sm transition hover:bg-white/25">
            استكشف المنصة
          </Link>
          <Link href="/platform/register" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-elite-blue-700 transition hover:bg-white/90">
            سجّل شركتك <ArrowLeft className="h-3 w-3 rtl:-scale-x-100" />
          </Link>
        </p>
      </div>
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
