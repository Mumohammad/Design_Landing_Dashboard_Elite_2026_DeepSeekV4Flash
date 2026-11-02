-- Expense & receipt capture (employee expense claims).
--
-- Separate from the ledger `expenses` table (which posts to the GL). Claims
-- are submitted by employees (web or Telegram), carry receipt evidence as
-- SUPPORTING DOCUMENTS ONLY (never ZATCA e-invoices), and move through
-- draft → submitted → needs_info / approved / rejected → exported / reimbursed.
-- Recorded VAT is what the document shows; it is NOT treated as recoverable
-- input VAT. Reads use RLS; every write goes through a SECURITY DEFINER RPC
-- that checks permission, ownership and the workflow, and appends to
-- expense_claim_events (the claim audit trail).
BEGIN;

CREATE SCHEMA IF NOT EXISTS expense_claims_private;
REVOKE ALL ON SCHEMA expense_claims_private FROM PUBLIC, anon, authenticated;

-- ═══ Permissions (module expense_claims) ═══
INSERT INTO public.permissions (module, action, description) VALUES
  ('expense_claims', 'create',  'Submit own expense claims and receipts'),
  ('expense_claims', 'read',    'View all expense claims and the expense dashboard'),
  ('expense_claims', 'approve', 'Review expense claims (approve, reject, request info, reimburse)'),
  ('expense_claims', 'export',  'Export expense claims to Excel'),
  ('expense_claims', 'manage',  'Configure expense claim settings, checklist and Telegram bot')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION expense_claims_private.default_actions(p_role text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_role
    WHEN 'admin' THEN ARRAY['create','read','approve','export','manage']
    WHEN 'accountant' THEN ARRAY['create','read','approve','export']
    WHEN 'readonly_auditor' THEN ARRAY['read']
    WHEN 'general_manager' THEN ARRAY['create','read','approve','export','manage']
    ELSE ARRAY['create'] END;
$$;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r JOIN public.permissions p ON p.module = 'expense_claims'
WHERE r.deleted_at IS NULL AND p.action = ANY (expense_claims_private.default_actions(r.name::text))
ON CONFLICT DO NOTHING;

-- Future tenants: grant the defaults when a role is created.
CREATE OR REPLACE FUNCTION expense_claims_private.grant_role_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id FROM public.permissions p
  WHERE p.module = 'expense_claims' AND p.action = ANY (expense_claims_private.default_actions(NEW.name::text))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_roles_expense_claims_defaults ON public.roles;
CREATE TRIGGER trg_roles_expense_claims_defaults AFTER INSERT ON public.roles
  FOR EACH ROW EXECUTE FUNCTION expense_claims_private.grant_role_defaults();

-- Permission check for a given auth user (service-role paths such as the
-- Telegram webhook, where there is no JWT).
CREATE OR REPLACE FUNCTION expense_claims_private.user_can(p_uid uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.tenants t ON t.id = u.tenant_id AND t.status = 'active'::public.tenant_status AND t.deleted_at IS NULL
    WHERE u.auth_user_id = p_uid AND u.status = 'active'::public.user_status AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (u.role = 'general_manager'::public.user_role OR EXISTS (
        SELECT 1 FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE r.tenant_id = u.tenant_id AND r.name = u.role AND r.deleted_at IS NULL
          AND p.module = 'expense_claims' AND p.action = p_action)));
$$;

CREATE OR REPLACE FUNCTION expense_claims_private.tenant_of(p_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = p_uid AND u.deleted_at IS NULL LIMIT 1;
$$;

-- ═══ Tables ═══
CREATE TABLE IF NOT EXISTS public.expense_claim_settings (
  tenant_id                  uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  export_language            text NOT NULL DEFAULT 'both' CHECK (export_language IN ('en', 'ar', 'both')),
  amount_locale              text NOT NULL DEFAULT 'en-US' CHECK (amount_locale IN ('en-US', 'ar-SA')),
  default_currency           text NOT NULL DEFAULT 'SAR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  allow_self_approval        boolean NOT NULL DEFAULT false,
  categories                 jsonb NOT NULL DEFAULT '["fuel","meals","transport","accommodation","vehicle_maintenance","parking_tolls","office_supplies","telecom","government_fees","other"]'::jsonb
                               CHECK (jsonb_typeof(categories) = 'array' AND jsonb_array_length(categories) BETWEEN 1 AND 60),
  checklist                  jsonb NOT NULL DEFAULT '[
    {"key":"supplier_name","en":"Supplier name shown","ar":"اسم المورد ظاهر","enabled":true},
    {"key":"supplier_vat","en":"Supplier VAT number shown","ar":"الرقم الضريبي للمورد ظاهر","enabled":true},
    {"key":"invoice_number","en":"Invoice / receipt number shown","ar":"رقم الفاتورة أو الإيصال ظاهر","enabled":true},
    {"key":"issue_date","en":"Issue date shown","ar":"تاريخ الإصدار ظاهر","enabled":true},
    {"key":"vat_shown","en":"VAT amount shown separately","ar":"مبلغ الضريبة ظاهر بشكل منفصل","enabled":true},
    {"key":"total_shown","en":"Total including VAT shown","ar":"الإجمالي شامل الضريبة ظاهر","enabled":true},
    {"key":"buyer_details","en":"Buyer (company) name / VAT shown where required","ar":"اسم المشتري ورقمه الضريبي ظاهران عند الحاجة","enabled":true},
    {"key":"qr_code","en":"QR code present on the document","ar":"رمز QR موجود على المستند","enabled":true},
    {"key":"structured_einvoice","en":"Structured e-invoice file received from supplier","ar":"تم استلام ملف فاتورة إلكترونية منظمة من المورد","enabled":true}
  ]'::jsonb CHECK (jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 40),
  checklist_confirmed_by     uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  checklist_confirmed_at     timestamptz,
  checklist_confirmation_note text CHECK (checklist_confirmation_note IS NULL OR length(checklist_confirmation_note) <= 1000),
  telegram_enabled           boolean NOT NULL DEFAULT false,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.expense_claims (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants (id),
  claim_no                text NOT NULL,
  submitter_id            uuid NOT NULL REFERENCES auth.users (id),
  department              text CHECK (department IS NULL OR length(department) <= 120),
  expense_date            date,
  submitted_at            timestamptz,
  supplier_name           text CHECK (supplier_name IS NULL OR length(supplier_name) <= 200),
  supplier_vat_number     text CHECK (supplier_vat_number IS NULL OR length(supplier_vat_number) <= 30),
  receipt_number          text CHECK (receipt_number IS NULL OR length(receipt_number) <= 100),
  category                text CHECK (category IS NULL OR length(category) <= 60),
  business_purpose        text CHECK (business_purpose IS NULL OR length(business_purpose) <= 1000),
  currency                text NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  amount_before_vat       numeric(14, 2) CHECK (amount_before_vat IS NULL OR amount_before_vat BETWEEN 0 AND 100000000),
  vat_rate                numeric(5, 2) CHECK (vat_rate IS NULL OR vat_rate BETWEEN 0 AND 100),
  vat_amount              numeric(14, 2) CHECK (vat_amount IS NULL OR vat_amount BETWEEN 0 AND 100000000),
  total_amount            numeric(14, 2) CHECK (total_amount IS NULL OR total_amount BETWEEN 0 AND 100000000),
  payment_method          text CHECK (payment_method IS NULL OR payment_method IN ('cash', 'company_card', 'personal_card', 'bank_transfer', 'petty_cash', 'other')),
  project                 text CHECK (project IS NULL OR length(project) <= 120),
  cost_center             text CHECK (cost_center IS NULL OR length(cost_center) <= 120),
  customer                text CHECK (customer IS NULL OR length(customer) <= 200),
  notes                   text CHECK (notes IS NULL OR length(notes) <= 2000),
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'needs_info', 'approved', 'rejected', 'exported', 'reimbursed')),
  source                  text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram')),
  -- Fields suggested by OCR / Telegram caption; unverified until a person confirms them.
  ocr_suggestions         jsonb NOT NULL DEFAULT '{}'::jsonb,
  unverified_fields       text[] NOT NULL DEFAULT '{}',
  submitter_confirmed_at  timestamptz,
  verified_by             uuid REFERENCES auth.users (id),
  verified_at             timestamptz,
  reviewer_id             uuid REFERENCES auth.users (id),
  reviewed_at             timestamptz,
  reviewer_comment        text CHECK (reviewer_comment IS NULL OR length(reviewer_comment) <= 2000),
  review_checklist        jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_status        text NOT NULL DEFAULT 'none' CHECK (duplicate_status IN ('none', 'possible', 'not_duplicate', 'duplicate')),
  duplicate_of            uuid[] NOT NULL DEFAULT '{}',
  duplicate_reasons       text[] NOT NULL DEFAULT '{}',
  exported_at             timestamptz,
  exported_by             uuid REFERENCES auth.users (id),
  reimbursed_at           timestamptz,
  reimbursed_by           uuid REFERENCES auth.users (id),
  reimbursement_ref       text CHECK (reimbursement_ref IS NULL OR length(reimbursement_ref) <= 120),
  telegram_media_group    text,
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users (id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES auth.users (id),
  deleted_at              timestamptz,
  UNIQUE (tenant_id, claim_no)
);
CREATE INDEX IF NOT EXISTS idx_expense_claims_tenant ON public.expense_claims (tenant_id, status, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_claims_submitter ON public.expense_claims (tenant_id, submitter_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_claims_dup ON public.expense_claims (tenant_id, lower(btrim(supplier_name)), receipt_number) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.expense_claim_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants (id),
  claim_id          uuid NOT NULL REFERENCES public.expense_claims (id),
  storage_path      text NOT NULL UNIQUE CHECK (length(storage_path) <= 300),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
  mime_type         text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/xml')),
  size_bytes        integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Supporting document only: a photo or scan is never a structured e-invoice.
  doc_kind          text NOT NULL CHECK (doc_kind IN ('photo', 'scanned_pdf', 'digital_pdf', 'structured_einvoice')),
  source            text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram')),
  uploaded_by       uuid NOT NULL REFERENCES auth.users (id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_claim_attachments_claim ON public.expense_claim_attachments (claim_id);
CREATE INDEX IF NOT EXISTS idx_expense_claim_attachments_hash ON public.expense_claim_attachments (tenant_id, sha256);

CREATE TABLE IF NOT EXISTS public.expense_claim_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id),
  claim_id    uuid NOT NULL REFERENCES public.expense_claims (id),
  actor_id    uuid REFERENCES auth.users (id),
  action      text NOT NULL CHECK (action IN ('created', 'edited', 'attachment_added', 'submitted', 'needs_info', 'approved', 'rejected', 'exported', 'reimbursed', 'duplicate_resolved', 'deleted', 'checklist_saved')),
  from_status text,
  to_status   text,
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment     text CHECK (comment IS NULL OR length(comment) <= 2000),
  source      text NOT NULL DEFAULT 'web',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_claim_events_claim ON public.expense_claim_events (claim_id, created_at);

CREATE TABLE IF NOT EXISTS public.expense_telegram_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants (id),
  user_id           uuid NOT NULL REFERENCES auth.users (id),
  telegram_user_id  bigint NOT NULL,
  telegram_chat_id  bigint NOT NULL,
  telegram_username text CHECK (telegram_username IS NULL OR length(telegram_username) <= 64),
  linked_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_telegram_active_tg ON public.expense_telegram_links (telegram_user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_telegram_active_user ON public.expense_telegram_links (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.expense_telegram_link_codes (
  code_hash  text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  tenant_id  uuid NOT NULL REFERENCES public.tenants (id),
  user_id    uuid NOT NULL REFERENCES auth.users (id),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_telegram_codes_user ON public.expense_telegram_link_codes (user_id, created_at DESC);

-- ═══ RLS (reads only; writes via RPCs) ═══
ALTER TABLE public.expense_claim_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claim_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_telegram_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_claim_settings, public.expense_claims, public.expense_claim_attachments, public.expense_claim_events,
  public.expense_telegram_links, public.expense_telegram_link_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.expense_claim_settings, public.expense_claims, public.expense_claim_attachments, public.expense_claim_events,
  public.expense_telegram_links TO authenticated;
GRANT ALL ON public.expense_claim_settings, public.expense_claims, public.expense_claim_attachments, public.expense_claim_events,
  public.expense_telegram_links, public.expense_telegram_link_codes TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA expense_claims_private FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS expense_claim_settings_sel ON public.expense_claim_settings;
CREATE POLICY expense_claim_settings_sel ON public.expense_claim_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND (public.user_has_permission('expense_claims', 'create')
    OR public.user_has_permission('expense_claims', 'read') OR public.user_has_permission('expense_claims', 'manage')));
DROP POLICY IF EXISTS expense_claims_sel ON public.expense_claims;
CREATE POLICY expense_claims_sel ON public.expense_claims FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (tenant_id = public.get_my_tenant_id() AND ((submitter_id = auth.uid() AND public.user_has_permission('expense_claims', 'create')) OR public.user_has_permission('expense_claims', 'read') OR public.user_has_permission('expense_claims', 'approve'))));
DROP POLICY IF EXISTS expense_claim_attachments_sel ON public.expense_claim_attachments;
CREATE POLICY expense_claim_attachments_sel ON public.expense_claim_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id AND c.deleted_at IS NULL AND (c.tenant_id = public.get_my_tenant_id() AND ((c.submitter_id = auth.uid() AND public.user_has_permission('expense_claims', 'create')) OR public.user_has_permission('expense_claims', 'read') OR public.user_has_permission('expense_claims', 'approve')))));
DROP POLICY IF EXISTS expense_claim_events_sel ON public.expense_claim_events;
CREATE POLICY expense_claim_events_sel ON public.expense_claim_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expense_claims c WHERE c.id = claim_id AND (c.tenant_id = public.get_my_tenant_id() AND ((c.submitter_id = auth.uid() AND public.user_has_permission('expense_claims', 'create')) OR public.user_has_permission('expense_claims', 'read') OR public.user_has_permission('expense_claims', 'approve')))));
DROP POLICY IF EXISTS expense_telegram_links_sel ON public.expense_telegram_links;
CREATE POLICY expense_telegram_links_sel ON public.expense_telegram_links FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND (user_id = auth.uid() OR public.user_has_permission('expense_claims', 'manage')));

-- Private receipts bucket. Clients may only upload into their tenant folder;
-- reading is server-side only (short-lived signed URLs after an access check).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('expense-receipts', 'expense-receipts', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/xml', 'text/xml'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS storage_expense_receipts_insert ON storage.objects;
CREATE POLICY storage_expense_receipts_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('expense_claims', 'create'));

-- ═══ Helpers ═══
CREATE OR REPLACE FUNCTION expense_claims_private.settings(p_tenant uuid)
RETURNS public.expense_claim_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.expense_claim_settings;
BEGIN
  SELECT * INTO s FROM public.expense_claim_settings WHERE tenant_id = p_tenant;
  IF s.tenant_id IS NULL THEN
    INSERT INTO public.expense_claim_settings (tenant_id) VALUES (p_tenant) ON CONFLICT (tenant_id) DO NOTHING;
    SELECT * INTO s FROM public.expense_claim_settings WHERE tenant_id = p_tenant;
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION expense_claims_private.log(p_claim public.expense_claims, p_actor uuid, p_action text, p_from text, p_to text, p_changes jsonb DEFAULT '{}'::jsonb, p_comment text DEFAULT NULL, p_source text DEFAULT 'web')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.expense_claim_events (tenant_id, claim_id, actor_id, action, from_status, to_status, changes, comment, source)
  VALUES (p_claim.tenant_id, p_claim.id, p_actor, p_action, p_from, p_to, coalesce(p_changes, '{}'::jsonb), p_comment, coalesce(p_source, 'web'));
$$;

-- Possible duplicates: identical file, same supplier + receipt number, or
-- same supplier + date + total + currency. Reviewer resolutions stick.
CREATE OR REPLACE FUNCTION expense_claims_private.refresh_duplicates(p_claim_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.expense_claims; ids uuid[] := '{}'; reasons text[] := '{}'; x uuid[];
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = p_claim_id;
  IF c.id IS NULL OR c.duplicate_status IN ('not_duplicate', 'duplicate') THEN RETURN; END IF;
  SELECT coalesce(array_agg(DISTINCT b.claim_id), '{}') INTO x FROM public.expense_claim_attachments a
    JOIN public.expense_claim_attachments b ON b.tenant_id = a.tenant_id AND b.sha256 = a.sha256 AND b.claim_id <> a.claim_id
    JOIN public.expense_claims bc ON bc.id = b.claim_id AND bc.deleted_at IS NULL
    WHERE a.claim_id = c.id;
  IF cardinality(x) > 0 THEN ids := ids || x; reasons := array_append(reasons, 'same_file'); END IF;
  IF nullif(btrim(c.receipt_number), '') IS NOT NULL AND nullif(btrim(c.supplier_name), '') IS NOT NULL THEN
    SELECT coalesce(array_agg(o.id), '{}') INTO x FROM public.expense_claims o
      WHERE o.tenant_id = c.tenant_id AND o.id <> c.id AND o.deleted_at IS NULL
        AND lower(btrim(o.supplier_name)) = lower(btrim(c.supplier_name)) AND lower(btrim(o.receipt_number)) = lower(btrim(c.receipt_number));
    IF cardinality(x) > 0 THEN ids := ids || x; reasons := array_append(reasons, 'same_receipt_number'); END IF;
  END IF;
  IF c.total_amount IS NOT NULL AND c.expense_date IS NOT NULL AND nullif(btrim(c.supplier_name), '') IS NOT NULL THEN
    SELECT coalesce(array_agg(o.id), '{}') INTO x FROM public.expense_claims o
      WHERE o.tenant_id = c.tenant_id AND o.id <> c.id AND o.deleted_at IS NULL AND o.currency = c.currency
        AND o.total_amount = c.total_amount AND o.expense_date = c.expense_date AND lower(btrim(o.supplier_name)) = lower(btrim(c.supplier_name));
    IF cardinality(x) > 0 THEN ids := ids || x; reasons := array_append(reasons, 'same_supplier_date_total'); END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT i), '{}') INTO ids FROM unnest(ids) i;
  UPDATE public.expense_claims SET duplicate_of = ids, duplicate_reasons = reasons,
    duplicate_status = CASE WHEN cardinality(ids) > 0 THEN 'possible' ELSE 'none' END
  WHERE id = c.id;
  -- Flag the counterpart claims too (unless a reviewer already resolved them).
  UPDATE public.expense_claims o SET
    duplicate_of = ARRAY(SELECT DISTINCT u FROM unnest(o.duplicate_of || c.id) u),
    duplicate_reasons = ARRAY(SELECT DISTINCT r FROM unnest(o.duplicate_reasons || reasons) r),
    duplicate_status = 'possible'
  WHERE o.id = ANY (ids) AND o.duplicate_status IN ('none', 'possible') AND NOT (c.id = ANY (o.duplicate_of));
END;
$$;

CREATE OR REPLACE FUNCTION expense_claims_private.clean(p jsonb, k text, maxlen int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p ? k THEN left(nullif(btrim(p->>k), ''), maxlen) ELSE NULL END;
$$;

-- Applies editable fields from p_fields (only keys present are changed);
-- returns the changed keys with old/new values for the audit trail.
CREATE OR REPLACE FUNCTION expense_claims_private.apply_fields(p_id uuid, p_fields jsonb, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.expense_claims; n public.expense_claims; diff jsonb := '{}'::jsonb; k text;
  num_keys text[] := ARRAY['amount_before_vat', 'vat_rate', 'vat_amount', 'total_amount'];
  txt_keys text[] := ARRAY['department', 'supplier_name', 'supplier_vat_number', 'receipt_number', 'category', 'business_purpose', 'payment_method', 'project', 'cost_center', 'customer', 'notes'];
BEGIN
  SELECT * INTO o FROM public.expense_claims WHERE id = p_id;
  UPDATE public.expense_claims SET
    department = CASE WHEN p_fields ? 'department' THEN expense_claims_private.clean(p_fields, 'department', 120) ELSE department END,
    supplier_name = CASE WHEN p_fields ? 'supplier_name' THEN expense_claims_private.clean(p_fields, 'supplier_name', 200) ELSE supplier_name END,
    supplier_vat_number = CASE WHEN p_fields ? 'supplier_vat_number' THEN expense_claims_private.clean(p_fields, 'supplier_vat_number', 30) ELSE supplier_vat_number END,
    receipt_number = CASE WHEN p_fields ? 'receipt_number' THEN expense_claims_private.clean(p_fields, 'receipt_number', 100) ELSE receipt_number END,
    category = CASE WHEN p_fields ? 'category' THEN expense_claims_private.clean(p_fields, 'category', 60) ELSE category END,
    business_purpose = CASE WHEN p_fields ? 'business_purpose' THEN expense_claims_private.clean(p_fields, 'business_purpose', 1000) ELSE business_purpose END,
    payment_method = CASE WHEN p_fields ? 'payment_method' THEN expense_claims_private.clean(p_fields, 'payment_method', 30) ELSE payment_method END,
    project = CASE WHEN p_fields ? 'project' THEN expense_claims_private.clean(p_fields, 'project', 120) ELSE project END,
    cost_center = CASE WHEN p_fields ? 'cost_center' THEN expense_claims_private.clean(p_fields, 'cost_center', 120) ELSE cost_center END,
    customer = CASE WHEN p_fields ? 'customer' THEN expense_claims_private.clean(p_fields, 'customer', 200) ELSE customer END,
    notes = CASE WHEN p_fields ? 'notes' THEN expense_claims_private.clean(p_fields, 'notes', 2000) ELSE notes END,
    expense_date = CASE WHEN p_fields ? 'expense_date' THEN nullif(p_fields->>'expense_date', '')::date ELSE expense_date END,
    currency = CASE WHEN p_fields ? 'currency' THEN upper(coalesce(nullif(btrim(p_fields->>'currency'), ''), currency)) ELSE currency END,
    amount_before_vat = CASE WHEN p_fields ? 'amount_before_vat' THEN nullif(p_fields->>'amount_before_vat', '')::numeric ELSE amount_before_vat END,
    vat_rate = CASE WHEN p_fields ? 'vat_rate' THEN nullif(p_fields->>'vat_rate', '')::numeric ELSE vat_rate END,
    vat_amount = CASE WHEN p_fields ? 'vat_amount' THEN nullif(p_fields->>'vat_amount', '')::numeric ELSE vat_amount END,
    total_amount = CASE WHEN p_fields ? 'total_amount' THEN nullif(p_fields->>'total_amount', '')::numeric ELSE total_amount END,
    ocr_suggestions = CASE WHEN jsonb_typeof(p_fields->'ocr_suggestions') = 'object' THEN p_fields->'ocr_suggestions' ELSE ocr_suggestions END,
    unverified_fields = CASE WHEN jsonb_typeof(p_fields->'unverified_fields') = 'array'
      THEN ARRAY(SELECT left(v, 40) FROM jsonb_array_elements_text(p_fields->'unverified_fields') v LIMIT 30) ELSE unverified_fields END,
    version = version + 1, updated_at = now(), updated_by = p_actor
  WHERE id = p_id RETURNING * INTO n;
  IF n.payment_method IS NOT NULL AND n.payment_method NOT IN ('cash', 'company_card', 'personal_card', 'bank_transfer', 'petty_cash', 'other') THEN
    RAISE EXCEPTION 'EXC010: invalid payment method';
  END IF;
  FOREACH k IN ARRAY txt_keys || num_keys || ARRAY['expense_date', 'currency'] LOOP
    IF (to_jsonb(o)->k) IS DISTINCT FROM (to_jsonb(n)->k) THEN
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(o)->k, 'to', to_jsonb(n)->k));
    END IF;
  END LOOP;
  PERFORM expense_claims_private.refresh_duplicates(p_id);
  RETURN diff;
END;
$$;

-- ═══ RPCs (authenticated) ═══
CREATE OR REPLACE FUNCTION public.expense_claim_save(p_id uuid, p_fields jsonb, p_expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); c public.expense_claims; diff jsonb; s public.expense_claim_settings;
  is_reviewer boolean := public.user_has_permission('expense_claims', 'approve');
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('expense_claims', 'create') AND NOT is_reviewer THEN
    RAISE EXCEPTION 'AUTH007: expense claim permission required';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RAISE EXCEPTION 'EXC001: invalid fields'; END IF;
  IF p_id IS NULL THEN
    IF NOT public.user_has_permission('expense_claims', 'create') THEN RAISE EXCEPTION 'AUTH007: expense claim permission required'; END IF;
    s := expense_claims_private.settings(t);
    INSERT INTO public.expense_claims (tenant_id, claim_no, submitter_id, currency, created_by, updated_by)
    VALUES (t, 'EXP-' || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), actor, s.default_currency, actor, actor)
    RETURNING * INTO c;
    PERFORM expense_claims_private.log(c, actor, 'created', NULL, 'draft');
  ELSE
    SELECT * INTO c FROM public.expense_claims WHERE id = p_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'EXC002: expense claim not found'; END IF;
    IF p_expected_version IS NOT NULL AND c.version <> p_expected_version THEN RAISE EXCEPTION 'EXC003: claim changed, reload and retry'; END IF;
    IF NOT ((c.submitter_id = actor AND c.status IN ('draft', 'needs_info'))
         OR (is_reviewer AND c.status IN ('submitted', 'needs_info'))) THEN
      RAISE EXCEPTION 'EXC004: this claim cannot be edited in its current status';
    END IF;
  END IF;
  diff := expense_claims_private.apply_fields(c.id, p_fields, actor);
  IF p_id IS NOT NULL AND diff <> '{}'::jsonb THEN
    PERFORM expense_claims_private.log(c, actor, 'edited', c.status, c.status, diff);
  END IF;
  SELECT * INTO c FROM public.expense_claims WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id, 'claim_no', c.claim_no, 'version', c.version, 'status', c.status, 'duplicate_status', c.duplicate_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_claim_transition(p_id uuid, p_action text, p_comment text DEFAULT NULL, p_expected_version integer DEFAULT NULL, p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); c public.expense_claims; n public.expense_claims; s public.expense_claim_settings;
  to_s text; reviewer boolean := public.user_has_permission('expense_claims', 'approve'); cmt text := left(nullif(btrim(p_comment), ''), 2000);
BEGIN
  IF actor IS NULL OR t IS NULL THEN RAISE EXCEPTION 'AUTH007: sign in required'; END IF;
  SELECT * INTO c FROM public.expense_claims WHERE id = p_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'EXC002: expense claim not found'; END IF;
  IF p_expected_version IS NOT NULL AND c.version <> p_expected_version THEN RAISE EXCEPTION 'EXC003: claim changed, reload and retry'; END IF;
  s := expense_claims_private.settings(t);
  IF p_action = 'submit' THEN
    IF c.submitter_id <> actor OR NOT public.user_has_permission('expense_claims', 'create') THEN RAISE EXCEPTION 'AUTH007: only the submitter can submit'; END IF;
    IF c.status NOT IN ('draft', 'needs_info') THEN RAISE EXCEPTION 'EXC005: invalid transition'; END IF;
    IF c.total_amount IS NULL OR c.expense_date IS NULL THEN RAISE EXCEPTION 'EXC006: expense date and total are required'; END IF;
    to_s := 'submitted';
  ELSIF p_action IN ('approve', 'reject', 'request_info') THEN
    IF NOT reviewer THEN RAISE EXCEPTION 'AUTH007: reviewer permission required'; END IF;
    IF c.status NOT IN ('submitted', 'needs_info') OR (p_action <> 'reject' AND c.status <> 'submitted') THEN RAISE EXCEPTION 'EXC005: invalid transition'; END IF;
    IF c.submitter_id = actor AND NOT s.allow_self_approval AND p_action <> 'request_info' THEN
      RAISE EXCEPTION 'EXC007: you cannot review your own expense claim';
    END IF;
    IF p_action = 'approve' AND c.duplicate_status IN ('possible', 'duplicate') THEN RAISE EXCEPTION 'EXC008: resolve the possible duplicate first'; END IF;
    IF p_action IN ('reject', 'request_info') AND cmt IS NULL THEN RAISE EXCEPTION 'EXC009: a comment is required'; END IF;
    to_s := CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'needs_info' END;
  ELSIF p_action = 'reimburse' THEN
    IF NOT reviewer THEN RAISE EXCEPTION 'AUTH007: reviewer permission required'; END IF;
    IF c.status NOT IN ('approved', 'exported') THEN RAISE EXCEPTION 'EXC005: invalid transition'; END IF;
    to_s := 'reimbursed';
  ELSE
    RAISE EXCEPTION 'EXC005: invalid transition';
  END IF;
  UPDATE public.expense_claims SET status = to_s,
    submitted_at = CASE WHEN to_s = 'submitted' THEN now() ELSE submitted_at END,
    submitter_confirmed_at = CASE WHEN to_s = 'submitted' THEN now() ELSE submitter_confirmed_at END,
    reviewer_id = CASE WHEN p_action IN ('approve', 'reject', 'request_info') THEN actor ELSE reviewer_id END,
    reviewed_at = CASE WHEN p_action IN ('approve', 'reject', 'request_info') THEN now() ELSE reviewed_at END,
    reviewer_comment = CASE WHEN p_action IN ('approve', 'reject', 'request_info') THEN cmt ELSE reviewer_comment END,
    verified_by = CASE WHEN to_s = 'approved' THEN actor ELSE verified_by END,
    verified_at = CASE WHEN to_s = 'approved' THEN now() ELSE verified_at END,
    unverified_fields = CASE WHEN to_s = 'approved' THEN '{}' ELSE unverified_fields END,
    reimbursed_at = CASE WHEN to_s = 'reimbursed' THEN now() ELSE reimbursed_at END,
    reimbursed_by = CASE WHEN to_s = 'reimbursed' THEN actor ELSE reimbursed_by END,
    reimbursement_ref = CASE WHEN to_s = 'reimbursed' THEN left(nullif(btrim(p_reference), ''), 120) ELSE reimbursement_ref END,
    version = version + 1, updated_at = now(), updated_by = actor
  WHERE id = c.id RETURNING * INTO n;
  PERFORM expense_claims_private.log(c, actor, CASE p_action WHEN 'submit' THEN 'submitted' WHEN 'request_info' THEN 'needs_info' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'reimbursed' END,
    c.status, to_s, CASE WHEN p_reference IS NOT NULL THEN jsonb_build_object('reference', left(p_reference, 120)) ELSE '{}'::jsonb END, cmt);
  RETURN jsonb_build_object('id', n.id, 'status', n.status, 'version', n.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_claim_save_checklist(p_id uuid, p_checklist jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); c public.expense_claims; clean jsonb;
BEGIN
  IF actor IS NULL OR NOT public.user_has_permission('expense_claims', 'approve') THEN RAISE EXCEPTION 'AUTH007: reviewer permission required'; END IF;
  SELECT * INTO c FROM public.expense_claims WHERE id = p_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'EXC002: expense claim not found'; END IF;
  IF jsonb_typeof(p_checklist) <> 'object' THEN RAISE EXCEPTION 'EXC001: invalid checklist'; END IF;
  SELECT coalesce(jsonb_object_agg(left(k, 40), v), '{}'::jsonb) INTO clean FROM jsonb_each_text(p_checklist) AS e(k, v) WHERE v IN ('yes', 'no', 'na');
  UPDATE public.expense_claims SET review_checklist = clean, updated_at = now(), updated_by = actor WHERE id = c.id;
  PERFORM expense_claims_private.log(c, actor, 'checklist_saved', c.status, c.status, jsonb_build_object('checklist', clean));
  RETURN clean;
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_claim_resolve_duplicate(p_id uuid, p_resolution text, p_comment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); c public.expense_claims; s public.expense_claim_settings;
BEGIN
  IF actor IS NULL OR NOT public.user_has_permission('expense_claims', 'approve') THEN RAISE EXCEPTION 'AUTH007: reviewer permission required'; END IF;
  IF p_resolution NOT IN ('not_duplicate', 'duplicate') THEN RAISE EXCEPTION 'EXC001: invalid resolution'; END IF;
  SELECT * INTO c FROM public.expense_claims WHERE id = p_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'EXC002: expense claim not found'; END IF;
  s := expense_claims_private.settings(t);
  IF c.submitter_id = actor AND NOT s.allow_self_approval THEN RAISE EXCEPTION 'EXC007: you cannot review your own expense claim'; END IF;
  UPDATE public.expense_claims SET duplicate_status = p_resolution, version = version + 1, updated_at = now(), updated_by = actor WHERE id = c.id;
  PERFORM expense_claims_private.log(c, actor, 'duplicate_resolved', c.status, c.status,
    jsonb_build_object('resolution', p_resolution, 'duplicate_of', to_jsonb(c.duplicate_of), 'reasons', to_jsonb(c.duplicate_reasons)), left(nullif(btrim(p_comment), ''), 2000));
  RETURN jsonb_build_object('id', c.id, 'duplicate_status', p_resolution);
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_claim_delete_draft(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); c public.expense_claims;
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = p_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL OR c.submitter_id <> actor OR c.status <> 'draft' THEN RAISE EXCEPTION 'EXC004: only your own drafts can be deleted'; END IF;
  UPDATE public.expense_claims SET deleted_at = now(), updated_by = actor WHERE id = c.id;
  PERFORM expense_claims_private.log(c, actor, 'deleted', 'draft', 'draft');
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_claims_record_export(p_ids uuid[], p_mark_exported boolean, p_filters jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); c public.expense_claims; n integer := 0;
BEGIN
  IF actor IS NULL OR NOT public.user_has_permission('expense_claims', 'export') THEN RAISE EXCEPTION 'AUTH007: export permission required'; END IF;
  IF cardinality(p_ids) > 20000 THEN RAISE EXCEPTION 'EXC001: too many rows'; END IF;
  FOR c IN SELECT * FROM public.expense_claims WHERE tenant_id = t AND id = ANY (p_ids) AND deleted_at IS NULL FOR UPDATE LOOP
    IF p_mark_exported AND c.status = 'approved' THEN
      UPDATE public.expense_claims SET status = 'exported', exported_at = now(), exported_by = actor, version = version + 1, updated_at = now(), updated_by = actor WHERE id = c.id;
      PERFORM expense_claims_private.log(c, actor, 'exported', c.status, 'exported');
      n := n + 1;
    ELSE
      PERFORM expense_claims_private.log(c, actor, 'exported', c.status, c.status);
    END IF;
  END LOOP;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, action, new_values)
  VALUES (t, actor, 'expense_claims', 'expense_claims', 'expense_claims_exported',
    jsonb_build_object('rows', cardinality(p_ids), 'marked_exported', n, 'filters', coalesce(p_filters, '{}'::jsonb)));
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_claim_settings_save(p_settings jsonb)
RETURNS public.expense_claim_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); o public.expense_claim_settings; n public.expense_claim_settings;
BEGIN
  IF actor IS NULL OR NOT public.user_has_permission('expense_claims', 'manage') THEN RAISE EXCEPTION 'AUTH007: settings permission required'; END IF;
  o := expense_claims_private.settings(t);
  UPDATE public.expense_claim_settings SET
    export_language = coalesce(p_settings->>'export_language', export_language),
    amount_locale = coalesce(p_settings->>'amount_locale', amount_locale),
    default_currency = upper(coalesce(p_settings->>'default_currency', default_currency)),
    allow_self_approval = coalesce((p_settings->>'allow_self_approval')::boolean, allow_self_approval),
    categories = CASE WHEN jsonb_typeof(p_settings->'categories') = 'array' THEN p_settings->'categories' ELSE categories END,
    checklist = CASE WHEN jsonb_typeof(p_settings->'checklist') = 'array' THEN p_settings->'checklist' ELSE checklist END,
    -- Any checklist change voids the previous confirmation.
    checklist_confirmed_by = CASE WHEN (p_settings->>'confirm_checklist')::boolean IS TRUE THEN actor
      WHEN jsonb_typeof(p_settings->'checklist') = 'array' AND p_settings->'checklist' IS DISTINCT FROM checklist THEN NULL ELSE checklist_confirmed_by END,
    checklist_confirmed_at = CASE WHEN (p_settings->>'confirm_checklist')::boolean IS TRUE THEN now()
      WHEN jsonb_typeof(p_settings->'checklist') = 'array' AND p_settings->'checklist' IS DISTINCT FROM checklist THEN NULL ELSE checklist_confirmed_at END,
    checklist_confirmation_note = CASE WHEN (p_settings->>'confirm_checklist')::boolean IS TRUE THEN left(nullif(btrim(p_settings->>'confirmation_note'), ''), 1000)
      WHEN jsonb_typeof(p_settings->'checklist') = 'array' AND p_settings->'checklist' IS DISTINCT FROM checklist THEN NULL ELSE checklist_confirmation_note END,
    telegram_enabled = coalesce((p_settings->>'telegram_enabled')::boolean, telegram_enabled),
    updated_at = now(), updated_by = actor
  WHERE tenant_id = t RETURNING * INTO n;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, action, old_values, new_values)
  VALUES (t, actor, 'expense_claims', 'expense_claim_settings', 'expense_claim_settings_updated', to_jsonb(o) - 'tenant_id', to_jsonb(n) - 'tenant_id');
  RETURN n;
END;
$$;

-- One-time Telegram link code: the app shows the plain code once; only its
-- SHA-256 is stored. Valid 10 minutes, single use.
CREATE OR REPLACE FUNCTION public.expense_telegram_create_link_code()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); code text; s public.expense_claim_settings;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('expense_claims', 'create') THEN RAISE EXCEPTION 'AUTH007: expense claim permission required'; END IF;
  s := expense_claims_private.settings(t);
  IF NOT s.telegram_enabled THEN RAISE EXCEPTION 'EXC011: the Telegram bot is not enabled for this company'; END IF;
  IF (SELECT count(*) FROM public.expense_telegram_link_codes WHERE user_id = actor AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'EXC012: too many link codes, try again later';
  END IF;
  code := upper(substr(translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=0O1IL', ''), 1, 10));
  INSERT INTO public.expense_telegram_link_codes (code_hash, tenant_id, user_id, expires_at)
  VALUES (encode(extensions.digest(code, 'sha256'), 'hex'), t, actor, now() + interval '10 minutes');
  RETURN jsonb_build_object('code', code, 'expires_at', now() + interval '10 minutes');
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_telegram_unlink(p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := public.get_my_tenant_id(); actor uuid := auth.uid(); target uuid := coalesce(p_user, auth.uid());
BEGIN
  IF actor IS NULL OR (target <> actor AND NOT public.user_has_permission('expense_claims', 'manage')) THEN RAISE EXCEPTION 'AUTH007: not allowed'; END IF;
  UPDATE public.expense_telegram_links SET revoked_at = now() WHERE tenant_id = t AND user_id = target AND revoked_at IS NULL;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action)
  VALUES (t, actor, 'expense_claims', 'expense_telegram_links', target, 'expense_telegram_unlinked');
END;
$$;

-- ═══ Service-role RPCs (server only: attachment registration, Telegram) ═══
CREATE OR REPLACE FUNCTION public.expense_claim_attach(p_actor uuid, p_claim_id uuid, p_path text, p_filename text, p_mime text, p_size integer, p_sha256 text, p_kind text, p_source text DEFAULT 'web')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.expense_claims; t uuid := expense_claims_private.tenant_of(p_actor); a public.expense_claim_attachments;
BEGIN
  SELECT * INTO c FROM public.expense_claims WHERE id = p_claim_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'EXC002: expense claim not found'; END IF;
  IF NOT ((c.submitter_id = p_actor AND c.status IN ('draft', 'needs_info', 'submitted') AND expense_claims_private.user_can(p_actor, 'create'))
       OR (expense_claims_private.user_can(p_actor, 'approve') AND c.status IN ('submitted', 'needs_info'))) THEN
    RAISE EXCEPTION 'EXC004: attachments cannot be added in this status';
  END IF;
  IF left(p_path, length(t::text || '/' || c.id::text || '/')) <> t::text || '/' || c.id::text || '/' OR p_path ~ '\.\.' THEN RAISE EXCEPTION 'EXC013: invalid path'; END IF;
  IF (SELECT count(*) FROM public.expense_claim_attachments WHERE claim_id = c.id) >= 10 THEN RAISE EXCEPTION 'EXC014: up to 10 attachments per claim'; END IF;
  INSERT INTO public.expense_claim_attachments (tenant_id, claim_id, storage_path, original_filename, mime_type, size_bytes, sha256, doc_kind, source, uploaded_by)
  VALUES (t, c.id, p_path, left(p_filename, 200), p_mime, p_size, p_sha256, p_kind, coalesce(p_source, 'web'), p_actor) RETURNING * INTO a;
  PERFORM expense_claims_private.log(c, p_actor, 'attachment_added', c.status, c.status,
    jsonb_build_object('file', a.original_filename, 'mime', a.mime_type, 'size', a.size_bytes, 'sha256', a.sha256, 'kind', a.doc_kind), NULL, p_source);
  PERFORM expense_claims_private.refresh_duplicates(c.id);
  SELECT * INTO c FROM public.expense_claims WHERE id = c.id;
  RETURN jsonb_build_object('id', a.id, 'duplicate_status', c.duplicate_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_telegram_consume_link(p_code text, p_tg_user bigint, p_chat bigint, p_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.expense_telegram_link_codes; s public.expense_claim_settings;
BEGIN
  SELECT * INTO k FROM public.expense_telegram_link_codes
    WHERE code_hash = encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex') FOR UPDATE;
  IF k.code_hash IS NULL OR k.used_at IS NOT NULL OR k.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF NOT expense_claims_private.user_can(k.user_id, 'create') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized'); END IF;
  s := expense_claims_private.settings(k.tenant_id);
  IF NOT s.telegram_enabled THEN RETURN jsonb_build_object('ok', false, 'reason', 'disabled'); END IF;
  UPDATE public.expense_telegram_link_codes SET used_at = now() WHERE code_hash = k.code_hash;
  UPDATE public.expense_telegram_links SET revoked_at = now() WHERE revoked_at IS NULL AND (telegram_user_id = p_tg_user OR user_id = k.user_id);
  INSERT INTO public.expense_telegram_links (tenant_id, user_id, telegram_user_id, telegram_chat_id, telegram_username)
  VALUES (k.tenant_id, k.user_id, p_tg_user, p_chat, left(p_username, 64));
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action)
  VALUES (k.tenant_id, k.user_id, 'expense_claims', 'expense_telegram_links', k.user_id, 'expense_telegram_linked');
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Resolves a Telegram sender to an app user: active link, active user with
-- expense_claims:create, bot enabled for the tenant. Otherwise rejected.
CREATE OR REPLACE FUNCTION public.expense_telegram_identity(p_tg_user bigint, p_chat bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.expense_telegram_links; s public.expense_claim_settings;
BEGIN
  SELECT * INTO l FROM public.expense_telegram_links WHERE telegram_user_id = p_tg_user AND telegram_chat_id = p_chat AND revoked_at IS NULL;
  IF l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_linked'); END IF;
  IF expense_claims_private.tenant_of(l.user_id) IS DISTINCT FROM l.tenant_id OR NOT expense_claims_private.user_can(l.user_id, 'create') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  s := expense_claims_private.settings(l.tenant_id);
  IF NOT s.telegram_enabled THEN RETURN jsonb_build_object('ok', false, 'reason', 'disabled'); END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', l.user_id, 'tenant_id', l.tenant_id, 'currency', s.default_currency);
END;
$$;

-- Telegram receipt → a SUBMITTED (pending) claim. Never approves. Albums
-- (same media group within 15 minutes) join the same claim.
CREATE OR REPLACE FUNCTION public.expense_telegram_claim(p_user uuid, p_fields jsonb, p_media_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t uuid := expense_claims_private.tenant_of(p_user); c public.expense_claims; s public.expense_claim_settings;
BEGIN
  IF t IS NULL OR NOT expense_claims_private.user_can(p_user, 'create') THEN RAISE EXCEPTION 'AUTH007: not authorized'; END IF;
  IF p_media_group IS NOT NULL THEN
    SELECT * INTO c FROM public.expense_claims WHERE tenant_id = t AND submitter_id = p_user AND telegram_media_group = left(p_media_group, 64)
      AND created_at > now() - interval '15 minutes' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1;
    IF c.id IS NOT NULL THEN RETURN jsonb_build_object('id', c.id, 'claim_no', c.claim_no, 'tenant_id', t, 'existing', true); END IF;
  END IF;
  s := expense_claims_private.settings(t);
  INSERT INTO public.expense_claims (tenant_id, claim_no, submitter_id, currency, source, status, submitted_at, telegram_media_group, created_by, updated_by)
  VALUES (t, 'EXP-' || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    p_user, s.default_currency, 'telegram', 'submitted', now(), left(p_media_group, 64), p_user, p_user)
  RETURNING * INTO c;
  PERFORM expense_claims_private.apply_fields(c.id, coalesce(p_fields, '{}'::jsonb), p_user);
  PERFORM expense_claims_private.log(c, p_user, 'submitted', NULL, 'submitted', jsonb_build_object('fields', coalesce(p_fields, '{}'::jsonb) - 'ocr_suggestions'), 'Submitted via Telegram (details unverified)', 'telegram');
  RETURN jsonb_build_object('id', c.id, 'claim_no', c.claim_no, 'tenant_id', t, 'existing', false);
END;
$$;

REVOKE ALL ON FUNCTION public.expense_claim_save(uuid, jsonb, integer), public.expense_claim_transition(uuid, text, text, integer, text),
  public.expense_claim_save_checklist(uuid, jsonb), public.expense_claim_resolve_duplicate(uuid, text, text), public.expense_claim_delete_draft(uuid),
  public.expense_claims_record_export(uuid[], boolean, jsonb), public.expense_claim_settings_save(jsonb), public.expense_telegram_create_link_code(),
  public.expense_telegram_unlink(uuid), public.expense_claim_attach(uuid, uuid, text, text, text, integer, text, text, text),
  public.expense_telegram_consume_link(text, bigint, bigint, text), public.expense_telegram_identity(bigint, bigint),
  public.expense_telegram_claim(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expense_claim_save(uuid, jsonb, integer), public.expense_claim_transition(uuid, text, text, integer, text),
  public.expense_claim_save_checklist(uuid, jsonb), public.expense_claim_resolve_duplicate(uuid, text, text), public.expense_claim_delete_draft(uuid),
  public.expense_claims_record_export(uuid[], boolean, jsonb), public.expense_claim_settings_save(jsonb), public.expense_telegram_create_link_code(),
  public.expense_telegram_unlink(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expense_claim_attach(uuid, uuid, text, text, text, integer, text, text, text),
  public.expense_telegram_consume_link(text, bigint, bigint, text), public.expense_telegram_identity(bigint, bigint),
  public.expense_telegram_claim(uuid, jsonb, text) TO service_role;
GRANT USAGE ON SCHEMA expense_claims_private TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA expense_claims_private TO service_role;

COMMIT;
