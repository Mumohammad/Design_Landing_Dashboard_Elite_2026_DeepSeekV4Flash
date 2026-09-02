'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Mail, Lock, User, Globe, ArrowLeft, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { PRICING_PLANS, PlanTier } from '@/lib/platform/types';

export default function PlatformRegister() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>('pro');
  const [formData, setFormData] = useState({
    name: '',
    legal_name: '',
    domain: '',
    slug: '',
    email: '',
    password: '',
    plan_tier: 'pro' as PlanTier,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/platform/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Registration failed');
      }

      router.push(`/platform/${formData.slug}/dashboard`);
    } catch (error) {
      console.error('Registration error:', error);
      alert(error instanceof Error ? error.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 py-12 px-6">
      <div className="max-w-4xl mx-auto">
        <Link href="/platform" className="inline-flex items-center gap-2 text-white/70 hover:text-white mb-8 transition">
          <ArrowLeft className="w-4 h-4" /> Back to Platform
        </Link>

        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 bg-white/10 backdrop-blur-sm px-5 py-2.5 rounded-full mb-4">
            <Building2 className="w-5 h-5 text-blue-400" />
            <span className="text-white font-medium">Create Your Company</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">Start Your 14-Day Free Trial</h1>
          <p className="text-white/60 text-lg">No credit card required. Full access to all features.</p>
        </div>

        <form onSubmit={handleSubmit} className="grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Company Information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Company Name (Short) *</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                      placeholder="e.g., Acme Corp"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Legal Name (Full) *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      type="text"
                      required
                      value={formData.legal_name}
                      onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                      placeholder="e.g., Acme Corporation LLC"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white/80 text-sm font-medium mb-2">Domain *</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                      <input
                        type="text"
                        required
                        value={formData.domain}
                        onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                        placeholder="acme.elitedev.com.sa"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-white/80 text-sm font-medium mb-2">Slug (URL) *</label>
                    <input
                      type="text"
                      required
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                      placeholder="acme"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Admin Account</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Email Address *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                      placeholder="admin@acme.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Password *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      type="password"
                      required
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition"
                      placeholder="Min. 8 characters"
                      minLength={8}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Choose Your Plan</h2>
              <div className="space-y-3">
                {PRICING_PLANS.map((plan) => (
                  <button
                    key={plan.tier}
                    type="button"
                    onClick={() => {
                      setSelectedPlan(plan.tier);
                      setFormData({ ...formData, plan_tier: plan.tier });
                    }}
                    className={`w-full p-4 rounded-xl border text-left transition flex items-center justify-between ${
                      selectedPlan === plan.tier
                        ? 'bg-blue-600/20 border-blue-500'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{plan.name}</span>
                        {plan.popular && (
                          <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">Popular</span>
                        )}
                      </div>
                      <div className="text-white/60 text-sm mt-1">${plan.price}/{plan.period}</div>
                    </div>
                    {selectedPlan === plan.tier && <Check className="w-5 h-5 text-blue-400" />}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white py-4 rounded-xl font-semibold text-lg transition flex items-center justify-center gap-2"
            >
              {loading ? (<><Loader2 className="w-5 h-5 animate-spin" /> Creating Account...</>) : ('Start Free Trial')}
            </button>

            <p className="text-white/50 text-sm text-center">
              By registering, you agree to our <Link href="/platform/terms" className="text-blue-400 hover:underline">Terms</Link> and <Link href="/platform/privacy" className="text-blue-400 hover:underline">Privacy</Link>.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
