import { LocalizedText, BilingualText } from "@/components/localized-text"
import { privacyEnglish } from "@/lib/i18n/legal-copy"
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | نخبة التطوير',
  description: 'سياسة الخصوصية لمنصة نخبة التطوير — كيف نجمع بياناتك ونستخدمها ونحميها وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية.',
  robots: { index: true, follow: true },
};

const sections = [
  {
    title: '1. مقدمة',
    body: 'توضح سياسة الخصوصية هذه كيفية جمع منصة نخبة التطوير («المنصة»، «نحن») للبيانات الشخصية واستخدامها وحمايتها عند استخدامك لنظام إدارة العمليات اللوجستية. باستخدامك المنصة فأنت توافق على الممارسات الموضحة هنا، بما يتوافق مع نظام حماية البيانات الشخصية (PDPL) في المملكة العربية السعودية.',
  },
  {
    title: '2. البيانات التي نجمعها',
    body: 'نجمع: (أ) بيانات الحساب — الاسم والبريد الإلكتروني وكلمة المرور المشفرة وبيانات الشركة (الاسم والشعار والألوان)؛ (ب) البيانات التشغيلية التي تدخلها شركتك — سجلات السائقين والمركبات والحضور والرواتب والمصروفات والمخالفات والمستندات؛ (ج) بيانات الاستخدام التقنية — عنوان IP ونوع المتصفح وسجلات الأخطاء لأغراض الأمان وتحسين الأداء.',
  },
  {
    title: '3. كيف نستخدم البيانات',
    body: 'نستخدم البيانات لتقديم الخدمة وتشغيلها (حساب الرواتب، التقارير، التنبيهات)، ولأمان الحسابات، وللتواصل المتعلق بالخدمة، وللالتزام بالمتطلبات النظامية. لا نستخدم بياناتك التشغيلية لأي غرض إعلاني، ولا نبيعها لأي طرف ثالث إطلاقًا.',
  },
  {
    title: '4. معالجة البيانات والأطراف الخارجية',
    body: 'تُستضاف المنصة على خدمات موثوقة تشمل: Supabase (قاعدة البيانات والمصادقة)، Vercel (الاستضافة)، Resend (البريد)، وSentry (مراقبة الأخطاء). تُعالج هذه الجهات البيانات بصفتها «معالِجات» نيابة عنا وضمن حدود تقديم الخدمة فقط.',
  },
  {
    title: '5. أمن البيانات',
    body: 'نستخدم سياسات Row Level Security لتقييد الوصول إلى بيانات الشركات على مستوى قاعدة البيانات، وتشفير النقل (TLS)، ووصولًا قائمًا على الدور (RBAC)، وسجل تدقيق غير قابل للتغيير للعمليات الحساسة. رغم ذلك لا يوجد نظام آمن بنسبة مطلقة، ونشجعك على استخدام كلمات مرور قوية والتحقق بخطوتين.',
  },
  {
    title: '6. حقوقك وفق نظام حماية البيانات الشخصية',
    body: 'يحق لك: الاطلاع على بياناتك الشخصية، وطلب تصحيحها أو حذفها، والاعتراض على معالجتها، وسحب موافقتك متى شئت دون تأثير رجعي. لممارسة هذه الحقوق راسلنا على support@elite-dev.com وسنرد خلال مدة معقولة.',
  },
  {
    title: '7. الاحتفاظ بالبيانات',
    body: 'نحتفظ ببيانات حسابك وبياناتك التشغيلية طوال فترة نشاط اشتراكك. تُراجع طلبات الحذف وإنهاء الحساب عبر الدعم لتحديد البيانات التي يمكن حذفها والبيانات الواجب الاحتفاظ بها. لا توفر المنصة حاليًا حذفًا تلقائيًا خلال مدة محددة.',
  },
  {
    title: '8. ملفات تعريف الارتباط والتخزين المحلي',
    body: 'نستخدم الحد الأدنى الضروري: جلسة المصادقة، وتفضيل اللغة والسمة المخزنة محليًا في متصفحك. لا نستخدم ملفات تتبع إعلانية.',
  },
  {
    title: '9. التعديلات على هذه السياسة',
    body: 'قد نحدّث هذه السياسة من وقت لآخر. سنُعلمك بالتغييرات الجوهرية عبر البريد أو إشعار داخل المنصة قبل سريانها.',
  },
  {
    title: '10. التواصل',
    body: 'لأي استفسار متعلق بالخصوصية: support@elite-dev.com — القصيم، المملكة العربية السعودية.',
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
        <Link href="/landing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <LocalizedText text="Back to home" />
        </Link>
        <div className="mt-8 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-white shadow-lg shadow-elite-blue-500/20">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight"><LocalizedText text="سياسة الخصوصية" /></h1>
            <p className="mt-1 text-sm text-muted-foreground"><LocalizedText text="Last updated: October 2026" /></p>
          </div>
        </div>
        <div className="mt-10 space-y-8">
          {sections.map((section, index) => (
            <section key={section.title} className="rounded-2xl border border-border/50 bg-card/60 p-6">
              <h2 className="text-lg font-bold text-foreground"><BilingualText ar={section.title} en={privacyEnglish[index].title} /></h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground"><BilingualText ar={section.body} en={privacyEnglish[index].body} /></p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
