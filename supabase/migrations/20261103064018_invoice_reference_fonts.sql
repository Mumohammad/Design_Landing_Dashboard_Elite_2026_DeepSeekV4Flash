-- Owner-supplied licensed invoice fonts (Tahoma) stored privately in the database so that
-- Git-based deployments can use them without committing licensed files. Only the
-- service role (server PDF renderer) can read them; nothing is exposed to clients.
CREATE SCHEMA IF NOT EXISTS invoice_assets_private;
REVOKE ALL ON SCHEMA invoice_assets_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS invoice_assets_private.reference_fonts (
  name text PRIMARY KEY CHECK (name IN ('regular.ttf', 'bold.ttf')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 12 AND 2097152 AND substring(data FROM 1 FOR 4) = '\x00010000'::bytea),
  sha256 text GENERATED ALWAYS AS (encode(sha256(data), 'hex')) STORED,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoice_assets_private.reference_fonts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_assets_private.reference_fonts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.invoice_reference_fonts()
RETURNS TABLE (name text, data_base64 text, sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.name, encode(f.data, 'base64'), f.sha256 FROM invoice_assets_private.reference_fonts f ORDER BY f.name
$$;
REVOKE ALL ON FUNCTION public.invoice_reference_fonts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_reference_fonts() TO service_role;
