-- Structured Saudi National Address for ZATCA Phase 2 (seller BR-KSA-09/37,
-- standard-invoice buyer BR-KSA-63). `address` remains the street name and
-- `city` the city; the new columns are optional until a document needs them,
-- so existing rows stay valid. Formats follow the National Address: building
-- and additional numbers are 4 digits, postal codes 5 digits.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS building_number text,
  ADD COLUMN IF NOT EXISTS additional_number text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS postal_code text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS building_number text,
  ADD COLUMN IF NOT EXISTS additional_number text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'SA';

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS building_number text,
  ADD COLUMN IF NOT EXISTS additional_number text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'SA';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','customers','suppliers'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_national_address_format');
    EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (building_number IS NULL OR building_number ~ '^[0-9]{4}$') AND
      (additional_number IS NULL OR additional_number ~ '^[0-9]{4}$') AND
      (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$') AND
      (district IS NULL OR length(btrim(district)) BETWEEN 1 AND 127))$f$, t, t || '_national_address_format');
  END LOOP;
END $$;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_country_code_format;
ALTER TABLE public.customers ADD CONSTRAINT customers_country_code_format CHECK (country_code ~ '^[A-Z]{2}$');
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_country_code_format;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_country_code_format CHECK (country_code ~ '^[A-Z]{2}$');

NOTIFY pgrst, 'reload schema';
