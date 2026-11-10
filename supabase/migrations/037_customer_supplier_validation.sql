-- =====================================================================
-- 037 — Financial Phase 4: Customer / Supplier validation + demo seed
--
-- `customers` and `suppliers` already exist (migration 027, 4-policy RLS,
-- code defaults from finance_doc_ref_seq). This migration adds:
--
--   1. validate_party() — a BEFORE INSERT OR UPDATE trigger on both tables
--      enforcing (errors raise CUS*/SUP* codes parsed by mapFinancialError):
--        CUS005/SUP005  Arabic name is required (trimmed)
--        CUS003/SUP003  code must be 3-12 chars (letters/digits/dashes)
--        CUS002/SUP002  tax_number must be exactly 15 digits when present
--        CUS004/SUP004  credit_limit cannot be negative when present
--
--   2. Idempotent demo seed for the demo tenant ONLY (synthetic data, no
--      real records). Explicit codes bypass the shared finance_doc_ref_seq
--      so the demo rows never consume production numbering.
--
-- Bilingual user-facing messages live in src/lib/errors/error-codes.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Validation trigger (shared by customers + suppliers)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_party()
RETURNS trigger
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT;
  v_code   TEXT;
BEGIN
  -- Table name selects the error prefix: customers -> CUS, suppliers -> SUP.
  IF TG_TABLE_NAME = 'customers' THEN
    v_prefix := 'CUS';
    v_code   := NEW.customer_code;
  ELSE
    v_prefix := 'SUP';
    v_code   := NEW.supplier_code;
  END IF;

  -- CUS005/SUP005 — Arabic name required (NOT NULL alone allows '').
  IF btrim(NEW.name_ar) = '' THEN
    RAISE EXCEPTION '%', v_prefix || '005: an Arabic name is required';
  END IF;

  -- CUS003/SUP003 — code format 3-12 chars (alphanumeric + dash). The column
  -- default lpad(nextval('finance_doc_ref_seq')::text, 6, '0') always passes.
  IF v_code !~ '^[A-Za-z0-9][A-Za-z0-9-]{2,11}$' THEN
    RAISE EXCEPTION '%', v_prefix || '003: code must be 3-12 characters (letters, digits, dashes)';
  END IF;

  -- CUS002/SUP002 — tax_number is the ZATCA VAT registration number: 15 digits.
  IF NEW.tax_number IS NOT NULL AND NEW.tax_number !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION '%', v_prefix || '002: tax number must be exactly 15 digits';
  END IF;

  -- CUS004/SUP004 — credit_limit cannot be negative; NaN is the only value
  -- where x <> x is TRUE in SQL, so that catches NUMERIC 'NaN' too.
  IF NEW.credit_limit IS NOT NULL
     AND (NEW.credit_limit < 0 OR NEW.credit_limit <> NEW.credit_limit) THEN
    RAISE EXCEPTION '%', v_prefix || '004: credit limit cannot be negative';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_validate_party ON customers;
CREATE TRIGGER trg_customers_validate_party
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION validate_party();

DROP TRIGGER IF EXISTS trg_suppliers_validate_party ON suppliers;
CREATE TRIGGER trg_suppliers_validate_party
  BEFORE INSERT OR UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION validate_party();

-- ---------------------------------------------------------------------
-- 2. Demo seed (demo tenant only; idempotent)
-- ---------------------------------------------------------------------
INSERT INTO customers (tenant_id, customer_code, name_ar, name_en, phone, email, tax_number, address, credit_limit)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'CUST-0001', 'مؤسسة النخبة التجارية', 'Elite Trading Est.',        '+966500000001', 'sales@elitetrading.sa',   '310122993400003', 'الرياض، حي العليا',   50000.00),
  ('00000000-0000-0000-0000-000000000001', 'CUST-0002', 'شركة الواحة للتموين',      'Al Waha Catering Co.',     '+966500000002', 'info@waha.sa',            '310122993400004', 'جدة، حي الروضة',      25000.00),
  ('00000000-0000-0000-0000-000000000001', 'CUST-0003', 'مطاعم السراج',             'Al Siraj Restaurants',     '+966500000003', 'contact@siraj.sa',        '310122993400005', 'الدمام، حي الشاطئ',   10000.00)
ON CONFLICT (tenant_id, customer_code) WHERE deleted_at IS NULL DO NOTHING;

INSERT INTO suppliers (tenant_id, supplier_code, name_ar, name_en, phone, email, tax_number, address, credit_limit)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'SUPP-0001', 'مؤسسة الوقود الحديثة',     'Modern Fuel Est.',         '+966511111111', 'fuel@modern.sa',          '310122993400006', 'الرياض، حي السلي',    100000.00),
  ('00000000-0000-0000-0000-000000000001', 'SUPP-0002', 'شركة قطع الغيار الموحدة',  'Unified Parts Co.',        '+966511111112', 'parts@unified.sa',        '310122993400007', 'جدة، حي البلد',       60000.00),
  ('00000000-0000-0000-0000-000000000001', 'SUPP-0003', 'مؤسسة الصيانة السريعة',    'Rapid Maintenance Est.',   '+966511111113', 'maint@rapid.sa',          '310122993400008', 'الدمام، حي الفيصلية', 40000.00)
ON CONFLICT (tenant_id, supplier_code) WHERE deleted_at IS NULL DO NOTHING;
