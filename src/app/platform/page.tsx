// =====================================================
// Platform B2B — Landing Page
// Path: src/app/platform/page.tsx
// =====================================================

import Link from 'next/link';
import { PRICING_PLANS } from '@/lib/platform/types';
import { Check, Building2, Users, Zap, Shield, ArrowRight, Star } from 'lucide-react';

export default function PlatformLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-400" />
            <span className="text-2xl font-bold text-white">Elite Platform</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/platform#pricing" className="text-white/80 hover:text-white transition">
              Pricing
            </Link>
            <Link href="/platform#features" className="text-white/80 hover:text-white transition">
              Features
            </Link>
            <Link href="/platform/login" className="text-white/80 hover:text-white transition">
              Login
            </Link>
            <Link
              href="/platform/register"
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg font-medium transition flex items-center gap-2"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-24 px-6">
        <div className="container mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full mb-6">
            <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            <span className="text-white/90 text-sm font-medium">Trusted by 500+ companies worldwide</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            Build Your Fleet<br />
            <span className="text-blue-400">Management Empire</span>
          </h1>
          <p className="text-xl text-white/70 max-w-3xl mx-auto mb-10">
            All-in-one platform for fleet companies. Manage drivers, vehicles, trials, and billing
            with a fully branded dashboard that looks like yours.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/platform/register"
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-semibold text-lg transition flex items-center justify-center gap-2"
            >
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/platform#pricing"
              className="bg-white/10 hover:bg-white/20 text-white px-8 py-4 rounded-xl font-semibold text-lg transition backdrop-blur-sm"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 bg-black/20">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Everything You Need
            </h2>
            <p className="text-xl text-white/60 max-w-2xl mx-auto">
              Powerful features built for modern fleet management companies
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <FeatureCard
              icon={<Users className="w-8 h-8" />}
              title="Driver Management"
              description="Add, track, and manage unlimited drivers with detailed profiles and performance metrics."
            />
            <FeatureCard
              icon={<Building2 className="w-8 h-8" />}
              title="Vehicle Tracking"
              description="Monitor your entire fleet with real-time vehicle status, maintenance schedules, and costs."
            />
            <FeatureCard
              icon={<Zap className="w-8 h-8" />}
              title="Reverse Trials"
              description="Test drivers before hiring. Convert top performers to your team with one click."
            />
            <FeatureCard
              icon={<Shield className="w-8 h-8" />}
              title="White-Label Branding"
              description="Your logo, your colors, your domain. A dashboard that looks 100% like yours."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-white/60 max-w-2xl mx-auto">
              Choose the plan that fits your business. All plans include a 14-day free trial.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {PRICING_PLANS.map((plan) => (
              <PricingCard key={plan.tier} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 bg-black/20">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Ready to Transform Your Fleet?
          </h2>
          <p className="text-xl text-white/60 max-w-2xl mx-auto mb-10">
            Join hundreds of companies managing their fleets with Elite Platform.
          </p>
          <Link
            href="/platform/register"
            className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-5 rounded-xl font-semibold text-lg transition inline-flex items-center gap-2"
          >
            Start Your Free Trial <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-6">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6 text-blue-400" />
            <span className="text-lg font-semibold text-white">Elite Platform</span>
          </div>
          <p className="text-white/50 text-sm">
            © 2026 Elite Dashboard. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition">
      <div className="text-blue-400 mb-4">{icon}</div>
      <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
      <p className="text-white/60">{description}</p>
    </div>
  );
}

function PricingCard({ plan }: { plan: (typeof PRICING_PLANS)[0] }) {
  return (
    <div
      className={`relative bg-white/5 backdrop-blur-sm border rounded-2xl p-8 flex flex-col ${
        plan.popular ? 'border-blue-500 shadow-2xl shadow-blue-500/20' : 'border-white/10'
      }`}
    >
      {plan.popular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-medium">
          Most Popular
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white">${plan.price}</span>
          <span className="text-white/60">/{plan.period}</span>
        </div>
      </div>
      <ul className="space-y-4 mb-8 flex-1">
        <li className="flex items-start gap-3 text-white/80">
          <Check className="w-5 h-5 text-green-400 mt-0.5" />
          <span>{plan.drivers_limit < 1000 ? `Up to ${plan.drivers_limit} drivers` : 'Unlimited drivers'}</span>
        </li>
        <li className="flex items-start gap-3 text-white/80">
          <Check className="w-5 h-5 text-green-400 mt-0.5" />
          <span>{plan.vehicles_limit < 1000 ? `Up to ${plan.vehicles_limit} vehicles` : 'Unlimited vehicles'}</span>
        </li>
        {plan.features.map((feature, i) => (
          <li key={i} className="flex items-start gap-3 text-white/80">
            <Check className="w-5 h-5 text-green-400 mt-0.5" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/platform/register"
        className={`w-full py-3 rounded-lg font-semibold transition text-center ${
          plan.popular
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : 'bg-white/10 hover:bg-white/20 text-white'
        }`}
      >
        Get Started
      </Link>
    </div>
  );
}
