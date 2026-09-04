import type { Metadata } from 'next';
import LandingPageContent from './landing-page-content';

const SITE_URL = 'https://app.elitedev.com.sa';

export const metadata: Metadata = {
  title: 'Elite Development | نخبة التطوير — Enterprise Logistics Operations Platform',
  description:
    'Enterprise logistics operations platform for Saudi 3PL and fleet operators: connect drivers, vehicles, orders, payroll, expenses and compliance in one operational system.',
  keywords: [
    'Enterprise Logistics Platform',
    '3PL Management',
    'Fleet Management',
    'Driver Management',
    'Payroll Management',
    'Saudi Logistics Software',
    'Logistics Operations Platform',
    'Fleet & Driver Management',
    'منصة لوجستية',
    'إدارة الأسطول',
    'إدارة السائقين',
    'نخبة التطوير',
  ],
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/landing` },
  openGraph: {
    title: 'Elite Development | Enterprise Logistics Operations Platform',
    description:
      'Connect drivers, vehicles, orders, payroll, expenses and compliance in one centralized operational system — built for Saudi logistics operations.',
    url: `${SITE_URL}/landing`,
    siteName: 'Elite Development',
    locale: 'ar_SA',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/og-cover.png`,
        width: 1200,
        height: 630,
        alt: 'Elite Development — Enterprise Logistics Operations Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Elite Development | Enterprise Logistics Operations Platform',
    description:
      'Connect drivers, vehicles, orders, payroll, expenses and compliance in one centralized operational system.',
    images: [`${SITE_URL}/og-cover.png`],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Elite Development',
      alternateName: 'نخبة التطوير',
      url: '/',
      description:
        'Enterprise logistics operations platform connecting drivers, vehicles, orders, payroll, compliance, expenses and reporting in one system.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Elite Development',
      alternateName: 'نخبة التطوير',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Enterprise logistics operations platform for managing drivers, fleet, vehicles, orders, payroll, violations, maintenance, expenses, attendance and reporting.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'SAR' },
    },
    { '@type': 'WebSite', name: 'Elite Development', url: '/', inLanguage: ['ar', 'en'] },
  ],
};

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <LandingPageContent />
    </>
  );
}
