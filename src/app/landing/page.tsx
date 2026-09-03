import Link from 'next/link';
import { ArrowRight, Building2, CheckCircle2, Truck, BarChart3, Users, ShieldCheck, Sparkles, Globe, Palette, KeyRound, Rocket } from 'lucide-react';

const features = [
  { icon: Truck, title: 'Fleet Management', desc: 'Complete control over drivers, vehicles, and operations' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time insights and business intelligence' },
  { icon: Users, title: 'Team Collaboration', desc: 'Role-based access for your entire organization' },
  { icon: ShieldCheck, title: 'Enterprise Security', desc: 'Multi-tenant isolation with RLS' },
];

const platformFeatures = [
  { icon: Building2, title: 'Your Own Workspace', desc: 'Every company gets a secure, isolated workspace with its own data, team, and settings.' },
  { icon: Palette, title: 'White-Label Branding', desc: 'Your logo, your brand colors, your company name — a dashboard that looks like yours.' },
  { icon: Globe, title: 'Company Domain', desc: 'Register with your company domain and give your team a professional home.' },
  { icon: KeyRound, title: 'Secure Access', desc: 'Supabase authentication with Row Level Security keeps every tenant fully separated.' },
];

const included = [
  'Company registration with logo, name, and domain',
  'Tenant-isolated drivers, vehicles, invoices, and expenses',
  'Analytics, accounting, reports, and team management',
  'Role-based permissions for owners, managers, and staff',
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white selection:bg-blue-500/30">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/landing" className="flex items-center gap-2 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600"><Building2 className="h-5 w-5" /></span>
            Elite Fleet
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-white/65 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#platform" className="transition hover:text-white">Platform</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
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
            <a href="#platform" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Explore Platform <ArrowRight className="h-4 w-4" /></a>
            <Link href="/platform/register" className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold transition hover:bg-white/10">Start Free Trial</Link>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center"><p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Everything in one place</p><h2 className="mt-3 text-3xl font-bold md:text-4xl">Built for modern fleet operations</h2></div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{features.map(f => <div key={f.title} className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 transition hover:-translate-y-1 hover:border-blue-400/30"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10"><f.icon className="h-5 w-5 text-blue-400" /></div><h3 className="mt-5 font-semibold">{f.title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{f.desc}</p></div>)}</div>
      </section>

      <section id="platform" className="relative border-y border-white/10 bg-slate-900/40 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,.15),transparent_40%)]" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-purple-400/25 bg-purple-400/10 px-4 py-2 text-sm text-purple-200"><Rocket className="h-4 w-4" /> The Platform</div>
            <h2 className="text-3xl font-bold md:text-5xl">Your company, your workspace, <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">one powerful platform.</span></h2>
            <p className="mt-5 text-lg leading-8 text-white/60">Subscribe your company and get a fully branded, multi-tenant workspace. Register with your logo, name, and domain — your team signs in to the same unified dashboard, scoped to your tenant.</p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {platformFeatures.map(f => <div key={f.title} className="rounded-2xl border border-white/10 bg-slate-950/60 p-6 transition hover:border-purple-400/30"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/10"><f.icon className="h-5 w-5 text-purple-400" /></div><h3 className="mt-5 font-semibold">{f.title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{f.desc}</p></div>)}
          </div>

          <div className="mx-auto mt-14 grid max-w-5xl gap-8 rounded-2xl border border-white/10 bg-slate-950/70 p-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h3 className="text-2xl font-bold">What every company gets</h3>
              <ul className="mt-6 space-y-4 text-sm text-white/75">
                {included.map(item => <li key={item} className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />{item}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-blue-400/20 bg-blue-500/5 p-6 text-center">
              <Building2 className="mx-auto h-8 w-8 text-blue-400" />
              <h4 className="mt-4 text-xl font-semibold">Ready to subscribe?</h4>
              <p className="mt-2 text-sm text-white/60">Create your company workspace in under two minutes.</p>
              <div className="mt-6 flex flex-col gap-3">
                <Link href="/platform/register" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Register Your Company <ArrowRight className="h-4 w-4" /></Link>
                <Link href="/platform" className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold transition hover:bg-white/10">View Platform Details</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-4xl px-6 py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Simple pricing</p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">Start free. Scale when you are ready.</h2>
        <p className="mt-4 text-white/60">Every workspace starts with a free trial. Upgrade only when your fleet grows.</p>
        <Link href="/platform/register" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500">Start Free Trial <ArrowRight className="h-4 w-4" /></Link>
      </section>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-sm text-white/40">&copy; {new Date().getFullYear()} Elite Fleet. Built for modern operations.</footer>
    </main>
  );
}
