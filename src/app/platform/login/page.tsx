import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { REDIRECTS, safeReturnPath, withLocale } from '@/lib/redirects';

export const metadata: Metadata = {
  title: 'دخول الشركات | نخبة التطوير',
  robots: { index: false, follow: false },
};

// Unified sign-in: every company login goes through the main app sign-in page
// (shared Supabase browser client, MFA step-up, safe returnTo handling),
// then lands on the multi-tenant /dashboard. This page previously kept its own
// raw supabase-js client whose session was invisible to the dashboard client,
// forcing users to sign in repeatedly.
export default async function PlatformLoginPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string; lang?: string }>
}) {
  const params = await searchParams;
  let target: string = REDIRECTS.signInUrl;
  if (params.returnTo) target += `?returnTo=${encodeURIComponent(safeReturnPath(params.returnTo))}`;
  if (params.lang === 'ar' || params.lang === 'en') target = withLocale(target, params.lang);
  redirect(target);
}
