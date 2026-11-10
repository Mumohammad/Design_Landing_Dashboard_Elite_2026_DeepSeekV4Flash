import type { Metadata } from 'next';
import LandingPageContent from './landing-page-content';

// Reads from env so previews and the future custom domain stay correct without code changes.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://elite-dashboard-blush.vercel.app';

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

const faqItems: { q: string; a: string }[] = [
  {
    q: 'ما هي نخبة التطوير؟',
    a: 'منصة تشغيل لوجستي مؤسسية تربط السائقين والمركبات والطلبات والرواتب والامتثال والمصروفات والمخالفات والصيانة والحضور والأداء في نظام تشغيلي واحد.',
  },
  {
    q: 'لمن صُممت؟',
    a: 'لمشغلي اللوجستيات وخدمات الطرف الثالث في السعودية الذين يديرون أساطيل توصيل وسائقين مكفولين أو أحرارًا ورواتب شهرية.',
  },
  {
    q: 'هل يمكنني إدارة السائقين والمركبات معًا؟',
    a: 'نعم. ملف السائق يرتبط بمركبة، وسجل المركبة يرتبط بسائقها وصيانتها وحوادثها — وهما لا يكونان منفصلين أبدًا.',
  },
  {
    q: 'كيف تعمل الرواتب؟',
    a: 'تُحسب الرواتب من بيانات تشغيلية: أهداف الطلبات وواقعها والحضور والمخالفات المعتمدة ورسوم المركبات والصيانة والسلف والتسويات.',
  },
  {
    q: 'هل يمكن تخصيص قواعد الرواتب؟',
    a: 'نعم. الأهداف ومعدلات المكافأة والعجز وأنواع الخصومات قابلة للتخصيص لكل شركة.',
  },
  {
    q: 'هل يمكن أن تؤثر المخالفات على الرواتب؟',
    a: 'يمكن للمخالفات المعتمدة أن تدخل في الرواتب كخصومات، ولكل منها موافقة وسجل تدقيق خاص.',
  },
  {
    q: 'هل يمكن ربط تكاليف الصيانة بالسائقين؟',
    a: 'نعم. يمكن ربط رسوم المركبات وتكاليف الصيانة بالسائق المعين وتنعكس في الراتب.',
  },
  {
    q: 'هل تدعم السائقين الأحرار؟',
    a: 'نعم. عقود السائقين الأحرار تستخدم قواعد حساب تحددها الشركة، منفصلة عن أنواع العقود المكفولة.',
  },
  {
    q: 'هل تدعم السائقين المكفولين؟',
    a: 'نعم. هياكل العقود المكفولة قابلة للتخصيص — مثل مركبة + بنزين + سكن، أو مركبة + سكن دون بنزين.',
  },
  {
    q: 'هل تدعم العربية والاتجاه RTL؟',
    a: 'نعم. الواجهة كاملة ثنائية اللغة — عربية RTL وإنجليزية LTR — بما فيها لوحات التحكم والنماذج والتقارير.',
  },
  {
    q: 'هل مصممة للعمليات السعودية؟',
    a: 'نعم. الريال السعودي ومستندات السائقين وتتبع الامتثال وسير العمل السعودي مدمجة في المنتج.',
  },
  {
    q: 'هل تدعم تعدد الشركات؟',
    a: 'نعم. كل شركة تحصل على مساحة عمل معزولة بشعارها وألوانها وبياناتها، مع عزل كامل للبيانات عبر Row Level Security.',
  },
  {
    q: 'هل تتكامل مع منصات خارجية؟',
    a: 'التكاملات الخارجية جزء من البنية المستقبلية — المنصة الحالية تركز أولاً على مركزية سجلاتك التشغيلية.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Elite Development',
      alternateName: 'نخبة التطوير',
      url: `${SITE_URL}/`,
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
    },
    { '@type': 'WebSite', name: 'Elite Development', url: `${SITE_URL}/`, inLanguage: ['ar', 'en'] },
    {
      '@type': 'FAQPage',
      mainEntity: faqItems.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
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
