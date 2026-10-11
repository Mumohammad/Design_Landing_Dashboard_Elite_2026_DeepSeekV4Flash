import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { REDIRECTS, withLocale } from '@/lib/redirects';

export const metadata: Metadata = {
  title: 'دخول الشركات | نخبة التطوير',
  robots: { index: false, follow: false },
};

// Unified sign-in: every company login goes through the main app sign-in page
// (shared Supabase browser client, MFA step-up, safe returnTo handling),
// then lands on the multi-tenant /dashboard. This page previously kept its own
// raw supabase-js client whose session was invisible to the dashboard client,
// forcing users to sign in repeatedly.
export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  redirect(lang === 'ar' || lang === 'en' ? withLocale(REDIRECTS.signInUrl, lang) : REDIRECTS.signInUrl);
}
