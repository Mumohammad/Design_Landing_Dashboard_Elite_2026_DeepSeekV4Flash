'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Users, Car, BarChart3, Shield, Zap, Building2 } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-8 h-8 text-blue-400" />
            <span className="text-2xl font-bold text-white">Elite Dashboard</span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#features" className="text-white/80 hover:text-white transition">Features</a>
            <a href="#pricing" className="text-white/80 hover:text-white transition">Pricing</a>
            <button onClick={() => router.push('/platform/login')} className="text-white/80 hover:text-white transition">Login</button>
            <button onClick={() => router.push('/platform/register')} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg font-medium transition flex items-center gap-2">
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-24 px-6">
        <div className="container mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            Manage Your Fleet<br />
            <span className="text-blue-400">Like a Pro</span>
          </h1>
          <p className="text-xl text-white/70 max-w-3xl mx-auto mb-10">
            All-in-one platform for fleet management. Drivers, vehicles, accounting, and reports — everything in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => router.push('/platform/register')} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-semibold text-lg transition flex items-center justify-center gap-2">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => router.push('/apply')} className="bg-white/10 hover:bg-white/20 text-white px-8 py-4 rounded-xl font-semibold text-lg transition backdrop-blur-sm">
              Apply as Driver
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 bg-black/20">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Everything You Need</h2>
            <p className="text-xl text-white/60 max-w-2xl mx-auto">Powerful features built for modern fleet management</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard icon={<Users className="w-8 h-8" />} title="Driver Management" description="Track and manage all your drivers with detailed profiles and performance metrics." />
            <FeatureCard icon={<Car className="w-8 h-8" />} title="Vehicle Tracking" description="Monitor your entire fleet with real-time vehicle status and maintenance schedules." />
            <FeatureCard icon={<BarChart3 className="w-8 h-8" />} title="Accounting & Reports" description="Complete financial tracking with automated reports and analytics." />
            <FeatureCard icon={<Shield className="w-8 h-8" />} title="Multi-Tenant Security" description="Your data is completely isolated and secure with enterprise-grade RLS policies." />
            <FeatureCard icon={<Zap className="w-8 h-8" />} title="Lightning Fast" description="Built on Next.js and Supabase for blazing fast performance." />
            <FeatureCard icon={<Building2 className="w-8 h-8" />} title="White-Label Ready" description="Your branding, your colors, your logo — a dashboard that looks like yours." />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Ready to Get Started?</h2>
          <p className="text-xl text-white/60 max-w-2xl mx-auto mb-10">Join hundreds of companies managing their fleets with Elite Dashboard.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => router.push('/platform/register')} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-5 rounded-xl font-semibold text-lg transition inline-flex items-center justify-center gap-2">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => router.push('/platform/login')} className="bg-white/10 hover:bg-white/20 text-white px-10 py-5 rounded-xl font-semibold text-lg transition inline-flex items-center justify-center gap-2">
              Login to Dashboard
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-6">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-400" />
            <span className="text-lg font-semibold text-white">Elite Dashboard</span>
          </div>
          <p className="text-white/50 text-sm">&copy; 2026 Elite Dashboard. All rights reserved.</p>
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
