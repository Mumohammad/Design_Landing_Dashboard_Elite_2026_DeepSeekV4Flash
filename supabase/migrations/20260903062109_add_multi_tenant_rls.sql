-- Add company_id (tenant_id) to existing tables
-- Add RLS policies for multi-tenant isolation

-- 1. Add tenant_id to drivers table (if not exists)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'tenant_id') THEN
    ALTER TABLE drivers ADD COLUMN tenant_id UUID REFERENCES tenants(id);
  END IF;
END $$;

-- 2. Add tenant_id to vehicles table (if not exists)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'tenant_id') THEN
    ALTER TABLE vehicles ADD COLUMN tenant_id UUID REFERENCES tenants(id);
  END IF;
END $$;

-- 3. Add tenant_id to driver_applications table (if not exists)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_applications' AND column_name = 'tenant_id') THEN
    ALTER TABLE driver_applications ADD COLUMN tenant_id UUID REFERENCES tenants(id);
  END IF;
END $$;

-- 4. Enable RLS on drivers (already enabled, update policies)
DROP POLICY IF EXISTS "Users can view drivers from their company" ON drivers;
DROP POLICY IF EXISTS "Users can insert drivers to their company" ON drivers;
DROP POLICY IF EXISTS "Users can update drivers in their company" ON drivers;

CREATE POLICY "Users can view drivers from their tenant"
  ON drivers FOR SELECT
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "Users can insert drivers to their tenant"
  ON drivers FOR INSERT
  WITH CHECK (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "Users can update drivers in their tenant"
  ON drivers FOR UPDATE
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

-- 5. Enable RLS on vehicles (already enabled, update policies)
DROP POLICY IF EXISTS "Users can view vehicles from their company" ON vehicles;
DROP POLICY IF EXISTS "Users can insert vehicles to their company" ON vehicles;
DROP POLICY IF EXISTS "Users can update vehicles in their company" ON vehicles;

CREATE POLICY "Users can view vehicles from their tenant"
  ON vehicles FOR SELECT
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "Users can insert vehicles to their tenant"
  ON vehicles FOR INSERT
  WITH CHECK (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "Users can update vehicles in their tenant"
  ON vehicles FOR UPDATE
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

-- 6. Enable RLS on driver_applications (already enabled, update policies)
DROP POLICY IF EXISTS "Users can view applications from their company" ON driver_applications;
DROP POLICY IF EXISTS "Users can insert applications to their company" ON driver_applications;
DROP POLICY IF EXISTS "Users can update applications in their company" ON driver_applications;

CREATE POLICY "Users can view applications from their tenant"
  ON driver_applications FOR SELECT
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "Users can insert applications to their tenant"
  ON driver_applications FOR INSERT
  WITH CHECK (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "Users can update applications in their tenant"
  ON driver_applications FOR UPDATE
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

-- 7. Create index for performance
CREATE INDEX IF NOT EXISTS idx_drivers_tenant ON drivers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_applications_tenant ON driver_applications(tenant_id);

