# سجل التشغيل — 2026-09-01

## تفعيل بيئة الإنتاج

- أُضيفت متغيرات Supabase الثلاثة إلى Vercel (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`، `NEXT_PUBLIC_SUPABASE_ANON_KEY` (عامة بالتصميم)، `SUPABASE_SERVICE_ROLE_KEY` (Sensitive — خادم فقط)
- هذه اللجنة تطلق بناءً جديداً يلتقطها — النشرات الجاهزة (prebuilt) لا تقبل إعادة النشر بمتغيرات جديدة
- التحقق بعد النشر: `/api/health` يجب أن تقرأ «healthy» (database: ok، auth: ok)

## تحسين لاحق محجوز

- فحص الدخان في CI يقبل «degraded» حالياً — يُضيَّق ليفشل عليه (كان سيكشف غياب متغيرات القاعدة منذ البداية)
