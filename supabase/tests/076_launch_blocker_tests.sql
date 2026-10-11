-- 076_launch_blocker_tests.sql
-- Adversarial coverage for the 2026-10-09 launch-blocker migration.
-- Runs only against a disposable local/test database.

BEGIN;

SELECT plan(26);

-- Fixed IDs keep failures reproducible while the surrounding transaction
-- guarantees the fixtures never persist.
INSERT INTO public.tenants (id, name_ar, name_en, slug)
VALUES
  ('76111111-1111-4111-8111-111111111111', 'Tenant A', 'Launch Test Tenant A', 'launch-tenant-a'),
  ('76222222-2222-4222-8222-222222222222', 'Tenant B', 'Launch Test Tenant B', 'launch-tenant-b');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '76333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', 'launch-gm@test.local', crypt('x', gen_salt('bf')),
    now(), now(), now(), '{"provider":"email","providers":["email"]}',
    '{"_invite_provisioned":true}'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '76444444-4444-4444-8444-444444444444',
    'authenticated', 'authenticated', 'launch-readonly@test.local', crypt('x', gen_salt('bf')),
    now(), now(), now(), '{"provider":"email","providers":["email"]}',
    '{"_invite_provisioned":true}'
  );

INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status, must_change_password)
VALUES
  (
    '76555555-5555-4555-8555-555555555555',
    '76333333-3333-4333-8333-333333333333',
    '76111111-1111-4111-8111-111111111111',
    'launch-gm@test.local', 'general_manager', 'active', false
  ),
  (
    '76666666-6666-4666-8666-666666666666',
    '76444444-4444-4444-8444-444444444444',
    '76111111-1111-4111-8111-111111111111',
    'launch-readonly@test.local', 'readonly_auditor', 'active', false
  );

INSERT INTO public.roles (id, tenant_id, name, name_ar, name_en)
VALUES (
  '76777777-7777-4777-8777-777777777777',
  '76111111-1111-4111-8111-111111111111',
  'readonly_auditor', 'Read only', 'Read only'
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '76777777-7777-4777-8777-777777777777', p.id
FROM public.permissions p
WHERE p.action = 'read'
  AND p.module IN ('drivers', 'vehicles', 'violations', 'payroll', 'invoices', 'expenses');

INSERT INTO public.drivers (
  id, tenant_id, full_name_ar, primary_mobile, category, status, hire_date
)
VALUES
  (
    '76888888-8888-4888-8888-888888888888',
    '76111111-1111-4111-8111-111111111111',
    'Tenant A Driver', '0507600001', 'freelancer', 'active', CURRENT_DATE - 365
  ),
  (
    '76999999-9999-4999-8999-999999999999',
    '76222222-2222-4222-8222-222222222222',
    'Tenant B Driver', '0507600002', 'freelancer', 'active', CURRENT_DATE - 365
  );

INSERT INTO public.vehicles (id, tenant_id, plate_number, make, model)
VALUES (
  '76aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '76111111-1111-4111-8111-111111111111',
  'LAUNCH-76', 'Test', 'Vehicle'
);

INSERT INTO public.violations (
  id, tenant_id, driver_id, incident_date, incident_description
)
VALUES (
  '76bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '76111111-1111-4111-8111-111111111111',
  '76888888-8888-4888-8888-888888888888', CURRENT_DATE, 'Launch test violation'
);

INSERT INTO public.driver_payroll_periods (
  id, tenant_id, driver_id, period_year, period_month
)
VALUES (
  '76cccccc-cccc-4ccc-8ccc-cccccccccccc',
  '76111111-1111-4111-8111-111111111111',
  '76888888-8888-4888-8888-888888888888', 2026, 10
);

INSERT INTO public.customers (id, tenant_id, name_ar, name_en)
VALUES (
  '76000000-0000-4000-8000-000000000003',
  '76111111-1111-4111-8111-111111111111',
  'Launch customer', 'Launch customer'
);

INSERT INTO public.invoices (
  id, tenant_id, invoice_number, customer_id, issue_date, due_date
)
VALUES (
  '76dddddd-dddd-4ddd-8ddd-dddddddddddd',
  '76111111-1111-4111-8111-111111111111',
  'INV-LAUNCH-76', '76000000-0000-4000-8000-000000000003', CURRENT_DATE, CURRENT_DATE
);

INSERT INTO public.expenses (
  id, tenant_id, expense_type, amount, expense_date, description
)
VALUES
  (
    '76eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '76111111-1111-4111-8111-111111111111',
    'other', 10, CURRENT_DATE, 'Tenant A launch fixture'
  ),
  (
    '76ffffff-ffff-4fff-8fff-ffffffffffff',
    '76222222-2222-4222-8222-222222222222',
    'other', 10, CURRENT_DATE, 'Tenant B cross-tenant fixture'
  );

INSERT INTO public.audit_log (
  id, tenant_id, actor_id, module, entity_type, entity_id, action, new_values
)
VALUES
  (
    '76000000-0000-4000-8000-000000000001',
    '76111111-1111-4111-8111-111111111111',
    '76333333-3333-4333-8333-333333333333',
    'drivers', 'driver', '76888888-8888-4888-8888-888888888888', 'created', '{}'
  ),
  (
    '76000000-0000-4000-8000-000000000002',
    '76222222-2222-4222-8222-222222222222',
    NULL, 'drivers', 'driver', '76999999-9999-4999-8999-999999999999', 'created', '{}'
  );

-- Caller from tenant A must not be able to use a tenant-B function argument.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"76333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.fetch_pending_approvals(
    '76222222-2222-4222-8222-222222222222', NULL, NULL, NULL, 50
  )),
  0,
  'fetch_pending_approvals rejects a cross-tenant tenant argument'
);

SELECT is(
  (SELECT count(*)::integer FROM public.fetch_audit_trail_page(
    '76222222-2222-4222-8222-222222222222', NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, 50
  )),
  0,
  'fetch_audit_trail_page rejects a cross-tenant tenant argument'
);

SELECT throws_ok(
  $$SELECT public.set_driver_status(
    '76999999-9999-4999-8999-999999999999', 'suspended', 'cross tenant',
    '00000000-0000-4000-8000-000000000099'
  )$$,
  '42501'::char(5),
  'AUTH006: cross-tenant driver access denied',
  'set_driver_status rejects a cross-tenant driver mutation'
);

-- A same-tenant caller without drivers:update must also be rejected.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"76444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$SELECT public.set_driver_status(
    '76888888-8888-4888-8888-888888888888', 'suspended', 'no permission', NULL
  )$$,
  '42501'::char(5),
  'AUTH007: drivers:update permission required',
  'set_driver_status requires drivers:update'
);

SELECT is(
  (SELECT count(*)::integer FROM public.fetch_pending_approvals(
    '76111111-1111-4111-8111-111111111111', NULL, NULL, NULL, 50
  )),
  0,
  'fetch_pending_approvals exposes no rows without an approval permission'
);

SELECT is(
  (SELECT count(*)::integer FROM public.fetch_audit_trail_page(
    '76111111-1111-4111-8111-111111111111', NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, 50
  )),
  0,
  'fetch_audit_trail_page exposes no rows without audit_log:read'
);

-- The caller cannot spoof updated_by; authenticated attribution is auth.uid().
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"76333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);
SELECT public.set_driver_status(
  '76888888-8888-4888-8888-888888888888', 'suspended', 'allowed',
  '00000000-0000-4000-8000-000000000099'
);
SELECT is(
  (SELECT updated_by FROM public.drivers WHERE id = '76888888-8888-4888-8888-888888888888'),
  '76333333-3333-4333-8333-333333333333'::uuid,
  'set_driver_status attributes authenticated changes to auth.uid()'
);

-- Low-privilege write attempts are RLS no-ops on every priority table.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"76444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);

UPDATE public.drivers SET preferred_name = 'forbidden'
WHERE id = '76888888-8888-4888-8888-888888888888';
SELECT is(
  (SELECT preferred_name FROM public.drivers WHERE id = '76888888-8888-4888-8888-888888888888'),
  NULL::text,
  'readonly role cannot update drivers'
);

UPDATE public.vehicles SET notes = 'forbidden'
WHERE id = '76aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT is(
  (SELECT notes FROM public.vehicles WHERE id = '76aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  NULL::text,
  'readonly role cannot update vehicles'
);

UPDATE public.violations SET review_notes = 'forbidden'
WHERE id = '76bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT is(
  (SELECT review_notes FROM public.violations WHERE id = '76bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  NULL::text,
  'readonly role cannot update violations'
);

UPDATE public.driver_payroll_periods SET notes = 'forbidden'
WHERE id = '76cccccc-cccc-4ccc-8ccc-cccccccccccc';
SELECT is(
  (SELECT notes FROM public.driver_payroll_periods WHERE id = '76cccccc-cccc-4ccc-8ccc-cccccccccccc'),
  NULL::text,
  'readonly role cannot update payroll periods'
);

UPDATE public.invoices SET notes = 'forbidden'
WHERE id = '76dddddd-dddd-4ddd-8ddd-dddddddddddd';
SELECT is(
  (SELECT notes FROM public.invoices WHERE id = '76dddddd-dddd-4ddd-8ddd-dddddddddddd'),
  NULL::text,
  'readonly role cannot update invoices'
);

UPDATE public.expenses SET description = 'forbidden'
WHERE id = '76eeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
SELECT is(
  (SELECT description FROM public.expenses WHERE id = '76eeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  'Tenant A launch fixture'::text,
  'readonly role cannot update expenses'
);

SELECT throws_ok(
  $$UPDATE public.users SET full_name_en = 'forbidden'
    WHERE id = '76666666-6666-4666-8666-666666666666'$$,
  '42501', NULL,
  'readonly role cannot update users at the grant boundary'
);

SELECT throws_ok(
  $$UPDATE public.roles SET description = 'forbidden'
    WHERE id = '76777777-7777-4777-8777-777777777777'$$,
  '42501', NULL,
  'readonly role cannot update roles at the grant boundary'
);

SELECT throws_ok(
  $$UPDATE public.audit_log SET action = 'forbidden'
    WHERE id = '76000000-0000-4000-8000-000000000001'$$,
  '42501'::char(5),
  'permission denied for table audit_log',
  'authenticated callers cannot update the append-only audit log'
);

-- Exercise the anonymous Storage policy using the same role used by an anon
-- Supabase client. Only the exact drafts/<uuid>/<uuid>.<allowed-ext> shape and
-- an allowed MIME type may be inserted.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'driver-applications',
      'drafts/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000021.pdf',
      '{"mimetype":"application/pdf"}'::jsonb
    )$$,
  'anonymous client can upload a valid driver-application draft path'
);

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'driver-applications',
      'other/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000022.pdf',
      '{"mimetype":"application/pdf"}'::jsonb
    )$$,
  '42501'::char(5), NULL,
  'anonymous client cannot upload outside drafts'
);

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'driver-applications',
      'drafts/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000023.exe',
      '{"mimetype":"application/pdf"}'::jsonb
    )$$,
  '42501'::char(5), NULL,
  'anonymous client cannot upload a disallowed extension'
);

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'driver-applications',
      'drafts/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000024.pdf',
      '{"mimetype":"application/x-msdownload"}'::jsonb
    )$$,
  '42501'::char(5), NULL,
  'anonymous client cannot spoof a disallowed MIME type'
);

-- Public intake accepts only the service boundary and an explicit active slug.
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.provision_driver_application_atomic(text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.provision_driver_application_atomic(text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.provision_driver_application_atomic(text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'atomic intake RPC is executable only by service_role'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT throws_ok(
  $$SELECT public.provision_driver_application_atomic(
    NULL, '{}'::jsonb, '[]'::jsonb
  )$$,
  '22023'::char(5),
  'APP_TENANT_REQUIRED: tenant slug is required',
  'public intake rejects a missing tenant slug'
);

SELECT throws_ok(
  $$SELECT public.provision_driver_application_atomic(
    'does-not-exist', '{}'::jsonb, '[]'::jsonb
  )$$,
  '22023'::char(5),
  'APP_TENANT_NOT_FOUND: unknown or inactive tenant',
  'public intake rejects an unknown tenant slug'
);

-- Force the second statement in the RPC to fail. PostgreSQL must roll back
-- the first insert, while the server-action unit test verifies Storage cleanup.
RESET ROLE;
SET LOCAL ROLE postgres;
CREATE FUNCTION pg_temp.fail_launch_document_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.file_name = 'fault-injection.pdf' THEN
    RAISE EXCEPTION 'fault-injected document insert failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fail_launch_document_insert
  BEFORE INSERT ON public.driver_application_documents
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_launch_document_insert();

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT throws_ok(
  $$SELECT public.provision_driver_application_atomic(
    'launch-tenant-a',
    '{
      "locale":"en",
      "first_name":"Fault",
      "last_name":"Injection",
      "full_name":"Fault Injection",
      "mobile":"0507699999",
      "identity_type":"national_id",
      "work_type":"full_time",
      "driver_category":"freelancer",
      "platform_codes":[],
      "has_vehicle":false,
      "consent_terms":true,
      "consent_privacy":true,
      "status_token_hash":"fault-injection-status-token"
    }'::jsonb,
    '[
      {
        "document_type":"profile_photo",
        "file_name":"photo.jpg",
        "storage_path":"drafts/76000000-0000-4000-8000-000000000010/76000000-0000-4000-8000-000000000011.jpg",
        "mime_type":"image/jpeg"
      },
      {
        "document_type":"identity",
        "file_name":"fault-injection.pdf",
        "storage_path":"drafts/76000000-0000-4000-8000-000000000012/76000000-0000-4000-8000-000000000013.pdf",
        "mime_type":"application/pdf"
      },
      {
        "document_type":"license",
        "file_name":"license.pdf",
        "storage_path":"drafts/76000000-0000-4000-8000-000000000014/76000000-0000-4000-8000-000000000015.pdf",
        "mime_type":"application/pdf"
      }
    ]'::jsonb
  )$$,
  'P0001'::char(5),
  'fault-injected document insert failure',
  'document metadata failure aborts the atomic intake RPC'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(*)::integer FROM public.driver_applications WHERE mobile = '0507699999'),
  0,
  'document metadata failure rolls back the application row'
);

SELECT is(
  (SELECT count(*)::integer FROM public.driver_application_documents
   WHERE storage_path LIKE 'drafts/76000000-0000-4000-8000-00000000001%'),
  0,
  'document metadata failure leaves no document metadata rows'
);

SELECT * FROM finish();
ROLLBACK;
