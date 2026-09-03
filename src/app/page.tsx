import Link from 'next/link';
import { ArrowRight, Building2, CheckCircle2, ShieldCheck, Truck, Users, BarChart3, Sparkles } from 'lucide-react';

const features = [
  { icon: Truck, title: 'Fleet operations', text: 'Manage drivers, vehicles, maintenance, and assignments in one secure workspace.' },
  { icon: BarChart3, title: 'Live business insights', text: 'Track income, expenses, fleet utilization, and operational performance.' },
  { icon: Users, title: 'Team collaboration', text: 'Give every manager and team member the right access for their role.' },
  { icon: ShieldCheck, title: 'Tenant-secure data', text: 'Your company data stays isolated through a multi-tenant architecture and RLS.' },
];

const plans = [
  { name: 'Starter', price: 'Free', description: 'For new fleet teams', items: ['Up to 5 drivers', 'Vehicle tracking', 'Core reports'] },
  { name: 'Professional', price: 'Contact us', description: 'For growing operations', items: ['Unlimited drivers', 'Financial dashboard', 'Team permissions', 'Priority support'], featured: true },
  { name: 'Enterprise', price: 'Custom', description: 'For large organizations', items: ['White-label branding', 'Advanced audit controls', 'Custom integrations'] },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white selection:bg-blue-500/30">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600"><Truck className="h-5 w-5" /></span>
            Elite Fleet
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-white/65 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <Link href="/platform" className="transition hover:text-white">Platform</Link>
            <Link href="/driver-registration" className="transition hover:text-white">Drivers</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/platform/login" className="hidden text-sm text-white/75 transition hover:text-white sm:block">Log in</Link>
            <Link href="/platform" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition hover:bg-blue-500">View Platform</Link>
          </div>
        </div>
      </header>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,.2),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(139,92,246,.18),transparent_25%)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 text-center md:py-32">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-400/10 px-4 py-2 text-sm text-blue-200"><Sparkles className="h-4 w-4" /> Modern multi-tenant fleet management</div>
          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight md:text-7xl">Run your fleet with <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">clarity and control.</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/65">Elite Fleet gives companies one unified workspace for drivers, vehicles, finance, reports, and teams — built for secure multi-tenant operations.</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/platform" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Explore the Platform <ArrowRight className="h-4 w-4" /></Link><Link href="/platform/register" className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold transition hover:bg-white/10">Start Free Trial</Link></div>
          <p className="mt-4 text-sm text-white/40">Looking to join as a driver? <Link href="/driver-registration" className="text-blue-300 hover:text-blue-200">Apply here</Link>.</p>
        </div>
      </section>
      <section id="features" className="mx-auto max-w-7xl px-6 py-24"><div className="mx-auto max-w-2xl text-center"><p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Everything in one place</p><h2 className="mt-3 text-3xl font-bold md:text-4xl">Built for fleet teams that need to move faster</h2></div><div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{features.map((feature) => <div key={feature.title} className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 transition hover:-translate-y-1 hover:border-blue-400/30"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10"><feature.icon className="h-5 w-5 text-blue-400" /></div><h3 className="mt-5 font-semibold">{feature.title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{feature.text}</p></div>)}</div></section>
      <section id="pricing" className="border-y border-white/10 bg-slate-900/40 py-24"><div className="mx-auto max-w-7xl px-6"><div className="mx-auto max-w-2xl text-center"><p className="text-sm font-semibold uppercase tracking-widest text-purple-400">Flexible plans</p><h2 className="mt-3 text-3xl font-bold md:text-4xl">Start simply. Scale confidently.</h2></div><div className="mt-12 grid gap-5 md:grid-cols-3">{plans.map((plan) => <div key={plan.name} className={`rounded-2xl border p-6 ${plan.featured ? 'border-blue-400/60 bg-blue-500/10 shadow-2xl shadow-blue-950/40' : 'border-white/10 bg-slate-950/50'}`}><h3 className="font-semibold">{plan.name}</h3><p className="mt-2 text-2xl font-bold">{plan.price}</p><p className="mt-2 text-sm text-white/55">{plan.description}</p><ul className="my-6 space-y-3 text-sm text-white/70">{plan.items.map(item => <li key={item} className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-blue-400" />{item}</li>)}</ul><Link href="/platform/register" className={`block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition ${plan.featured ? 'bg-blue-600 hover:bg-blue-500' : 'bg-white/10 hover:bg-white/15'}`}>Get started</Link></div>)}</div></div></section>
      <section className="mx-auto max-w-4xl px-6 py-24 text-center"><Building2 className="mx-auto h-8 w-8 text-blue-400" /><h2 className="mt-5 text-3xl font-bold">Ready to see your company dashboard?</h2><p className="mt-3 text-white/60">Explore the platform first, then create a workspace when you are ready.</p><Link href="/platform" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Visit Platform <ArrowRight className="h-4 w-4" /></Link></section>
      <footer className="border-t border-white/10 px-6 py-8 text-center text-sm text-white/40">© {new Date().getFullYear()} Elite Fleet. Built for modern operations.</footer>
    </main>
  );
}
