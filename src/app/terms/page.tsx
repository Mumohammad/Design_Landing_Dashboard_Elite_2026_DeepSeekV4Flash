import { LocalizedText, BilingualText } from "@/components/localized-text"
import { termsEnglish } from "@/lib/i18n/legal-copy"
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Scale } from 'lucide-react';

export const metadata: Metadata = {
  title: 'شروط الخدمة | نخبة التطوير',
  description: 'شروط استخدام منصة نخبة التطوير لإدارة العمليات اللوجستية — الحسابات والاشتراكات والبيانات والمسؤوليات وفق الأنظمة المعمول بها في المملكة العربية السعودية.',
  robots: { index: true, follow: true },
};

const sections = [
  {
    title: '1. الموافقة على الشروط',
    body: 'بإنشاء حساب أو استخدام منصة نخبة التطوير، توافق أنت («العميل» أو «الشركة») على هذه الشروط. إذا كنت تنشئ الحساب نيابة عن شركة، فأنت تقر بأنك مخوّل لإلزامها بهذه الشروط.',
  },
  {
    title: '2. وصف الخدمة',
    body: 'المنصة نظام إدارة عمليات لوجستية يشمل: سجلات السائقين والمركبات، الحضور، الطلبات، الرواتب، المصروفات، المخالفات، المستندات، والتقارير — مقدمة كبرمجيات كخدمة (SaaS) بمساحة عمل معزولة لكل شركة.',
  },
  {
    title: '3. الحسابات والأمان',
    body: 'أنت مسؤول عن سرية بيانات دخولك وعن كل نشاط يتم تحت حسابك. يجب إبلاغنا فورًا عن أي استخدام غير مصرح. نوصي بتفعيل التحقق بخطوتين لجميع المستخدمين الإداريين.',
  },
  {
    title: '4. الاشتراك والتجربة المجانية',
    body: 'تبدأ كل مساحة عمل جديدة بتجربة مجانية لمدة 14 يومًا. بعد انتهائها يتطلب الاستمرار خطة مدفوعة. الأسعار المعروضة على صفحة الهبوط استرشادية وقد تُخصص لكل عملية باتفاق مكتوب.',
  },
  {
    title: '5. مسؤوليات العميل',
    body: 'أنت مسؤول عن: دقة البيانات التشغيلية المدخلة (الطلبات، الحضور، الخصومات)، قانونية هياكل الرواتب والعقود التي تعدّها، الحصول على موافقات سائقيك لمعالجة بياناتهم، والالتزام بالأنظمة السعودية ذات الصلة بما فيها متطلبات الفوترة الإلكترونية عند تفعيلها.',
  },
  {
    title: '6. البيانات والملكية',
    body: 'بياناتك وبيانات شركتك ملك لك وحدك. نعالجها فقط لتقديم الخدمة وفق سياسة الخصوصية. يمكنك طلب تصدير بياناتك في أي وقت. عند الإنهاء تُتاح فترة سماح للتصدير قبل الحذف النهائي.',
  },
  {
    title: '7. الاستخدام المقبول',
    body: 'يُحظر: إدخال بيانات غير قانونية، أو محاولة الوصول إلى بيانات شركة أخرى، أو إجراء هندسة عكسية للمنصة، أو إرسال محتوى ضار، أو استخدام المنصة بما يخالف الأنظمة المعمول بها في المملكة.',
  },
  {
    title: '8. الفوترة والدفع',
    body: 'تُصدر فواتير الاشتراك دوريًا وقد تخضع لضريبة القيمة المضافة وفق النظام. التأخر في السداد قد يؤدي إلى تعليق مساحة العمل بعد إشعار مسبق.',
  },
  {
    title: '9. حدود المسؤولية',
    body: 'المنصة أداة تشغيل ولا تُغني عن المراجعة المحاسبية أو القانونية المهنية. لا نتحمل مسؤولية القرارات المبنية على بيانات أدخلها العميل بشكل غير صحيح. حد مسؤوليتنا الإجمالي يعادل قيمة ما دفعته خلال الأشهر الـ12 السابقة للمطالبة.',
  },
  {
    title: '10. الإنهاء',
    body: 'يمكنك إنهاء اشتراكك في أي وقت من إعدادات مساحة العمل أو بالتواصل معنا. يجوز لنا تعليق أو إنهاء الحسابات المخالفة لهذه الشروط بعد إشعار، ما لم يكن الخرق جسيمًا فيُنهى فورًا.',
  },
  {
    title: '11. القانون الواجب التطبيق',
    body: 'تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتُحل أي نزاعات عبر الجهات المختصة فيها.',
  },
  {
    title: '12. التواصل',
    body: 'لأي استفسار قانوني أو متعلق بالشروط: support@elite-dev.com — القصيم، المملكة العربية السعودية.',
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
        <Link href="/landing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <LocalizedText text="Back to home" />
        </Link>
        <div className="mt-8 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-elite-blue-600 dark:text-elite-blue-300">
            <Scale className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight"><LocalizedText text="شروط الخدمة" /></h1>
            <p className="mt-1 text-sm text-muted-foreground"><LocalizedText text="Last updated: September 2026" /></p>
          </div>
        </div>
        <div className="mt-10 space-y-8">
          {sections.map((section, index) => (
            <section key={section.title} className="rounded-2xl border border-border/50 bg-card/60 p-6">
              <h2 className="text-lg font-bold text-foreground"><BilingualText ar={section.title} en={termsEnglish[index].title} /></h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground"><BilingualText ar={section.body} en={termsEnglish[index].body} /></p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
