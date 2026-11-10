# Platform B2B — Elite Dashboard 2026

منصة SaaS متكاملة لإدارة شركات الفليت (B2B) مع عزل بيانات كامل، هوية بصرية ديناميكية، ونظام باقات قابل للتوسع.

## 📁 هيكل الملفات

```
src/
├── app/
│   ├── platform/
│   │   ├── page.tsx                          # Landing B2B
│   │   ├── register/page.tsx                 # تسجيل شركة جديدة
│   │   └── [slug]/
│   │       └── dashboard/page.tsx            # لوحة الشركة الرئيسية
│   └── api/
│       └── platform/
│           └── companies/route.ts            # API إنشاء شركة
└── lib/
    └── platform/
        └── types.ts                          # TypeScript types
```

## 🗄️ قاعدة البيانات (Supabase)

### الجداول الرئيسية

| الجدول | الوصف |
|--------|-------|
| `platform_companies` | بيانات الشركة (الاسم، النطاق، الشعار، الألوان، الباقة) |
| `platform_users` | مستخدمو الشركة (مرتبط بـ auth.users) |
| `platform_trials` | تجربة عكسية — سائقون تحت الاختبار |
| `platform_subscriptions` | اشتراكات الشركات (باقات، حالة، تواريخ) |

### RLS (Row Level Security)

كل جدول محمي بـ RLS يضمن أن:
- الشركة ترى **فقط** بياناتها
- المستخدم يرى **فقط** شركاته
- التجارب والاشتراكات معزولة تماماً

## 🔧 إعداد البيئة

أضف المتغيرات التالية في `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 🚀 البدء

### ١. تثبيت التبعيات

```bash
npm install lucide-react zod
```

### ٢. تطوير محلي

```bash
npm run dev
```

### ٣. اختبار المنصة

- Landing: `http://localhost:3000/platform`
- تسجيل: `http://localhost:3000/platform/register`
- Dashboard: `http://localhost:3000/platform/[slug]/dashboard`

## 💰 الباقات

| الباقة | السعر | السائقين | المركبات |
|--------|-------|----------|----------|
| Starter | $299/شهر | 10 | 10 |
| Pro | $799/شهر | 50 | 50 |
| Enterprise | $1999/شهر | غير محدود | غير محدود |

## 🔐 المصادقة

- نفس جدول `auth.users` مع عمود `user_type` (`driver` | `company_user`)
- `platform_users` يربط المستخدم بالشركة والدور (admin, manager, viewer)
- JWT يحتوي `company_id` و`role` — يُستخدم في RLS وAPI

---

**Elite Dashboard © 2026** — منصة B2B احترافية قابلة للتوسع
