'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, Upload, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    company_name: '',
    domain: '',
    email: '',
    password: '',
    logo_url: '',
    brand_colors: '#2563eb',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/platform/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/landing" className="flex items-center gap-2 font-bold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600"><Building2 className="h-5 w-5" /></span>Elite Fleet</Link>
          <Link href="/platform/login" className="text-sm text-white/75 hover:text-white">Already have an account? Log in</Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/landing" className="inline-flex items-center gap-2 text-sm text-white/65 hover:text-white mb-8"><ArrowLeft className="h-4 w-4" /> Back to landing</Link>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-8"><div className="mb-6"><h1 className="text-3xl font-bold">Create your company workspace</h1><p className="mt-2 text-white/60">Set up your multi-tenant workspace with your company branding.</p></div>
          {error && <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/25 p-4 text-sm text-red-300">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label className="block text-sm font-medium mb-2">Company Name *</label><input required type="text" value={formData.company_name} onChange={e => setFormData({...formData, company_name: e.target.value})} className="w-full rounded-lg border border-white/15 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="e.g. Acme Logistics" /></div>
            <div><label className="block text-sm font-medium mb-2">Company Domain *</label><input required type="text" value={formData.domain} onChange={e => setFormData({...formData, domain: e.target.value})} className="w-full rounded-lg border border-white/15 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="e.g. acme.com" /></div>
            <div><label className="block text-sm font-medium mb-2">Work Email *</label><input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full rounded-lg border border-white/15 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="you@company.com" /></div>
            <div><label className="block text-sm font-medium mb-2">Password *</label><input required type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full rounded-lg border border-white/15 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Min. 8 characters" minLength={8} /></div>
            <div><label className="block text-sm font-medium mb-2">Company Logo URL</label><div className="flex gap-3"><input type="url" value={formData.logo_url} onChange={e => setFormData({...formData, logo_url: e.target.value})} className="flex-1 rounded-lg border border-white/15 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="https://cdn.example.com/logo.png" /><span className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4"><Upload className="h-5 w-5 text-white/50" /></span></div><p className="mt-2 text-xs text-white/40">Upload your logo to a CDN and paste the URL here.</p></div>
            <div><label className="block text-sm font-medium mb-2">Brand Color</label><div className="flex items-center gap-3"><input type="color" value={formData.brand_colors} onChange={e => setFormData({...formData, brand_colors: e.target.value})} className="h-10 w-16 rounded border border-white/15 bg-slate-950/50" /><input type="text" value={formData.brand_colors} onChange={e => setFormData({...formData, brand_colors: e.target.value})} className="flex-1 rounded-lg border border-white/15 bg-slate-950/50 px-4 py-2 text-white focus:border-blue-500 focus:outline-none" /></div></div>
            <div className="pt-4"><button disabled={loading} type="submit" className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500 disabled:opacity-50"><span className="flex items-center justify-center gap-2">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} {loading ? 'Creating workspace...' : 'Create workspace'}</span></button></div>
            <p className="text-xs text-center text-white/40">By registering, you agree to our Terms and Privacy Policy. Your data is isolated through multi-tenant RLS.</p>
          </form>
        </div>
      </section>
    </main>
  );
}
