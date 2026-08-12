-- 028_templates_seed.sql
-- Module 13 (Templates) — catalog of 21 document templates for the default
-- tenant. Idempotent: ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL.
--
-- Categories per the template_category enum in 025: vehicle | gear | hr | operations.

INSERT INTO document_templates (tenant_id, code, name_ar, name_en, category, description, template_fields, is_active)
VALUES
  -- ── Vehicle (5) ────────────────────────────────────────────────────
  ('00000000-0000-0000-0000-000000000001', 'VEH-001', 'نموذج تسليم مركبة', 'Vehicle Handover Form', 'vehicle',
   'توثيق تسليم المركبة لسائق مع قائمة فحص الحالة', '["driver","vehicle","condition","date","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'VEH-002', 'نموذج استلام مركبة', 'Vehicle Return Form', 'vehicle',
   'توثيق إرجاع المركبة وفحص الحالة عند الاستلام', '["driver","vehicle","condition","date","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'VEH-003', 'طلب نسخة سجل المركبة', 'Vehicle Registration Copy Request', 'vehicle',
   'طلب نسخة من رخصة السير من الإدارة', '["driver","vehicle","request_date"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'VEH-004', 'شهادة تأمين المركبة', 'Vehicle Insurance Certificate', 'vehicle',
   'شهادة سريان التأمين للمركبة', '["vehicle","insurance_policy","valid_until"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'VEH-005', 'تقرير فحص المركبة', 'Vehicle Inspection Report', 'vehicle',
   'تقرير الفحص الدوري لحالة المركبة', '["vehicle","odometer","condition","inspector"]'::jsonb, true),

  -- ── Gear (4) ───────────────────────────────────────────────────────
  ('00000000-0000-0000-0000-000000000001', 'GEAR-001', 'نموذج صرف عهدة', 'Gear Issue Form', 'gear',
   'صرف معدات وعهد للسائقين', '["driver","items","date","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'GEAR-002', 'نموذج إرجاع عهدة', 'Gear Return Form', 'gear',
   'إرجاع المعدات وتسليمها للإدارة', '["driver","items","date","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'GEAR-003', 'بلاغ تلف عهدة', 'Gear Damage Report', 'gear',
   'الإبلاغ عن تلف أو فقدان المعدات', '["driver","items","damage_description","date"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'GEAR-004', 'جرد العهد', 'Gear Inventory Sheet', 'gear',
   'جرد دوري للمعدات والعهد', '["items","warehouse","date"]'::jsonb, true),

  -- ── HR (9) ─────────────────────────────────────────────────────────
  ('00000000-0000-0000-0000-000000000001', 'HR-001', 'عقد عمل', 'Employment Contract', 'hr',
   'عقد عمل سائق بموجب نظام العمل السعودي', '["driver","salary","contract_type","start_date","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-002', 'طلب نسخة إقامة', 'Iqama Copy Request', 'hr',
   'طلب نسخة من الإقامة من إدارة الموارد البشرية', '["driver","request_date"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-003', 'طلب نسخة رخصة قيادة', 'Driving License Copy Request', 'hr',
   'طلب نسخة من رخصة القيادة', '["driver","request_date"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-004', 'طلب إجازة', 'Leave Request Form', 'hr',
   'طلب إجازة سنوية/مرضية مع الموافقات', '["driver","leave_type","from","to","approval"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-005', 'شهادة راتب', 'Salary Certificate', 'hr',
   'شهادة راتب رسمية للجهات الخارجية', '["driver","salary","period"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-006', 'إنذار خطي', 'Warning Letter', 'hr',
   'إنذار خطي لمخالفة لوائح العمل', '["driver","reason","date","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-007', 'نموذج إجراء تأديبي', 'Disciplinary Action Form', 'hr',
   'توثيق الإجراءات التأديبية', '["driver","action","reason","date"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-008', 'طلب سلفة', 'Advance Request Form', 'hr',
   'طلب سلفة من الراتب مع خطة السداد', '["driver","amount","repayment_plan","approval"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'HR-009', 'إقرار استلام قسيمة راتب', 'Payslip Acknowledgment', 'hr',
   'إقرار باستلام قسيمة الراتب الشهرية', '["driver","period","net_payroll","date","signature"]'::jsonb, true),

  -- ── Operations (3) ─────────────────────────────────────────────────
  ('00000000-0000-0000-0000-000000000001', 'OPS-001', 'نموذج تسوية تحصيل COD', 'COD Settlement Form', 'operations',
   'تسوية المبالغ المحصلة عند الاستلام مع السائق', '["driver","period","cod_collected","cash_shortfall","signature"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'OPS-002', 'نموذج تعويض مصروفات', 'Expense Reimbursement Form', 'operations',
   'تعويض مصروفات تشغيلية مع الإيصالات', '["driver","expenses","receipts","approval"]'::jsonb, true),
  ('00000000-0000-0000-0000-000000000001', 'OPS-003', 'تقرير حادث', 'Incident Report Form', 'operations',
   'توثيق الحوادث المرورية والتشغيلية', '["driver","vehicle","incident","date","police_report"]'::jsonb, true)
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING;
