import Link from 'next/link';
import { ArrowRight, Building2, CheckCircle2, Truck, BarChart3, Users, ShieldCheck, Sparkles } from 'lucide-react';

const features = [
  { icon: Truck, title: 'Fleet Management', desc: 'Complete control over drivers, vehicles, and operations' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time insights and business intelligence' },
  { icon: Users, title: 'Team Collaboration', desc: 'Role-based access for your entire organization' },
  { icon: ShieldCheck, title: 'Enterprise Security', desc: 'Multi-tenant isolation with RLS' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/landing" className="flex items-center gap-2 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600"><Building2 className="h-5 w-5" /></span>
            Elite Fleet
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-white/65 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <Link href="/platform" className="transition hover:text-white">Platform</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/platform/login" className="text-sm text-white/75 transition hover:text-white">Log in</Link>
            <Link href="/platform/register" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition hover:bg-blue-500">Start Free</Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,.2),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(139,92,246,.18),transparent_25%)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 text-center md:py-32">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-400/10 px-4 py-2 text-sm text-blue-200"><Sparkles className="h-4 w-4" /> Modern Multi-Tenant Fleet Platform</div>
          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight md:text-7xl">Run your fleet with <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">clarity and control.</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/65">Elite Fleet gives companies one unified workspace for drivers, vehicles, finance, reports, and teams — built for secure multi-tenant operations.</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/platform" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Explore Platform <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/platform/register" className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold transition hover:bg-white/10">Start Free Trial</Link>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center"><p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Everything in one place</p><h2 className="mt-3 text-3xl font-bold md:text-4xl">Built for modern fleet operations</h2></div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{features.map(f => <div key={f.title} className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 transition hover:-translate-y-1 hover:border-blue-400/30"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10"><f.icon className="h-5 w-5 text-blue-400" /></div><h3 className="mt-5 font-semibold">{f.title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{f.desc}</p></div>)}</div>
      </section>

      <section className="border-y border-white/10 bg-slate-900/40 py-24">
        <div className="mx-auto max-w-7xl px-6 text-center"><p className="text-sm font-semibold uppercase tracking-widest text-purple-400">Ready to start?</p><h2 className="mt-3 text-3xl font-bold md:text-4xl">Create your company workspace today</h2><p className="mt-4 text-white/60">Join with your company logo, name, and domain. Get a fully branded multi-tenant workspace.</p><Link href="/platform/register" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Register Your Company <ArrowRight className="h-4 w-4" /></Link></div>
      </section>

      <footer className="px-6 py-8 text-center text-sm text-white/40">&copy; {new Date().getFullYear()} Elite Fleet. Built for modern operations.</footer>
    </main>
  );
}
