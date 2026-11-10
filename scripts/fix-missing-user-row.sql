-- ══════════════════════════════════════════════════════════════════
-- FIX: Create missing `users` rows for auth users
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

-- STEP 1: Find your auth user(s) that are MISSING a `users` row.
--         Run this FIRST to confirm the issue and get the auth_user_id.
SELECT
  au.id AS auth_user_id,
  au.email,
  au.created_at,
  au.email_confirmed_at,
  au.raw_user_meta_data
FROM auth.users au
LEFT JOIN users u ON u.auth_user_id = au.id
WHERE u.id IS NULL
ORDER BY au.created_at DESC;

-- ══════════════════════════════════════════════════════════════════
-- STEP 2: Uncomment and fill in the values from STEP 1, then run.
-- ══════════════════════════════════════════════════════════════════

-- ── CONFIG — edit these three values ─────────────────────────────
-- Replace with YOUR values from Step 1 (or from the invite flow).
-- The default tenant is pre-filled (00000000-...-0001).

DO $$
DECLARE
  v_auth_user_id UUID := 'PASTE-YOUR-AUTH-USER-ID-HERE';   -- ← from Step 1
  v_email        TEXT  := 'PASTE-YOUR-EMAIL-HERE';          -- ← same email as in auth.users
  v_full_name    TEXT  := 'Admin User';                     -- ← display name
  v_tenant_id    UUID := '00000000-0000-0000-0000-000000000001';
  v_new_user_id  UUID;
BEGIN
  -- 1. Check if user already exists (idempotent)
  IF EXISTS (SELECT 1 FROM users WHERE auth_user_id = v_auth_user_id) THEN
    RAISE NOTICE 'User row already exists for auth_user_id % — skipping.', v_auth_user_id;
    RETURN;
  END IF;

  -- 2. Insert the custom `users` row
  INSERT INTO users (
    auth_user_id,
    tenant_id,
    email,
    role,
    full_name_ar,
    full_name_en,
    status,
    must_change_password,
    two_factor_enabled,
    failed_login_attempts,
    accepted_invite_at
  ) VALUES (
    v_auth_user_id,
    v_tenant_id,
    v_email,
    'general_manager',          -- full admin access
    v_full_name,
    v_full_name,
    'active',
    false,                      -- don't force password change
    false,
    0,
    now()
  )
  RETURNING id INTO v_new_user_id;

  RAISE NOTICE 'Created users row: id=%, auth_user_id=%', v_new_user_id, v_auth_user_id;

  -- 3. Create tenant_memberships row (required for the app to work)
  INSERT INTO tenant_memberships (user_id, tenant_id)
  VALUES (v_new_user_id, v_tenant_id)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created tenant_memberships row.';

  -- 4. Create role assignment (optional — authorization.ts reads users.role directly)
  INSERT INTO user_role_assignments (user_id, role_id, tenant_id)
  SELECT
    v_new_user_id,
    r.id,
    v_tenant_id
  FROM roles r
  WHERE r.tenant_id = v_tenant_id
    AND r.name = 'general_manager'
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '✅ All done! User is ready to log in.';

END $$;

-- ══════════════════════════════════════════════════════════════════
-- STEP 3 (OPTIONAL): Verify the fix worked.
-- ══════════════════════════════════════════════════════════════════
SELECT
  u.id AS user_id,
  u.auth_user_id,
  u.email,
  u.role,
  u.status,
  tm.tenant_id,
  ura.role_id AS assigned_role_id
FROM users u
LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
LEFT JOIN user_role_assignments ura ON ura.user_id = u.id
WHERE u.auth_user_id = 'PASTE-YOUR-AUTH-USER-ID-HERE';  -- ← same as Step 2
