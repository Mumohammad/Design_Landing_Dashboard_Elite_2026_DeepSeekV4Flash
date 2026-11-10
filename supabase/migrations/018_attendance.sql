
-- 018_attendance.sql
-- Module 3: Attendance
-- PostgreSQL-compatible version.
-- Partial UNIQUE constraints are implemented as standalone partial indexes.

-- ═══ Enums ═══
CREATE TYPE attendance_status AS ENUM (
  'present', 'absent_excused', 'absent_unexcused', 'late', 'half_day',
  'on_leave', 'public_holiday', 'day_off'
);
CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE attendance_period_status AS ENUM ('open', 'locked');
CREATE TYPE entry_method AS ENUM ('manual', 'biometric', 'gps', 'import', 'system');

-- ═══ Attendance periods ═══
CREATE TABLE attendance_periods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  period_year        SMALLINT NOT NULL,
  period_month       SMALLINT NOT NULL,
  period_label       TEXT,
  period_label_en    TEXT,
  working_days_count SMALLINT NOT NULL DEFAULT 26,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  status             attendance_period_status NOT NULL DEFAULT 'open',
  locked_by          UUID REFERENCES auth.users(id),
  locked_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT uq_attendance_period UNIQUE (tenant_id, period_year, period_month),
  CONSTRAINT chk_attendance_period_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_attendance_period_month CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT chk_attendance_period_year CHECK (period_year BETWEEN 2000 AND 2200)
);

CREATE INDEX idx_attendance_periods_tenant
  ON attendance_periods (tenant_id, period_year, period_month)
  WHERE deleted_at IS NULL;

-- ═══ Driver work schedules ═══
CREATE TABLE driver_work_schedules (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id),
  driver_id                   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  schedule_name               TEXT,
  shift_start                 TIME NOT NULL,
  shift_end                   TIME NOT NULL,
  grace_period_minutes        SMALLINT NOT NULL DEFAULT 15,
  late_threshold_minutes      SMALLINT NOT NULL DEFAULT 30,
  half_day_threshold_minutes  SMALLINT NOT NULL DEFAULT 120,
  working_days_per_week       SMALLINT NOT NULL DEFAULT 6,
  weekend_days                TEXT[],
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  effective_from              DATE,
  effective_to                DATE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  UUID REFERENCES auth.users(id),
  updated_by                  UUID REFERENCES auth.users(id),
  deleted_at                  TIMESTAMPTZ,
  CONSTRAINT chk_schedule_thresholds CHECK (
    grace_period_minutes >= 0
    AND late_threshold_minutes >= grace_period_minutes
    AND half_day_threshold_minutes >= late_threshold_minutes
  ),
  CONSTRAINT chk_schedule_working_days CHECK (working_days_per_week BETWEEN 1 AND 7),
  CONSTRAINT chk_schedule_dates CHECK (
    effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from
  )
);

CREATE UNIQUE INDEX idx_work_schedules_unique_active
  ON driver_work_schedules (tenant_id, driver_id, effective_from)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_work_schedules_active
  ON driver_work_schedules (tenant_id, driver_id, is_active)
  WHERE deleted_at IS NULL;

-- ═══ Driver attendance ═══
CREATE TABLE driver_attendance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  driver_id         UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  attendance_date   DATE NOT NULL,
  status            attendance_status NOT NULL DEFAULT 'present',
  check_in_time     TIMESTAMPTZ,
  check_out_time    TIMESTAMPTZ,
  late_minutes      SMALLINT NOT NULL DEFAULT 0,
  overtime_minutes  SMALLINT NOT NULL DEFAULT 0,
  entry_method      entry_method NOT NULL DEFAULT 'manual',
  schedule_id       UUID REFERENCES driver_work_schedules(id),
  leave_request_id  UUID,
  leave_type_id     UUID,
  notes             TEXT,
  is_locked         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ,
  working_day_value NUMERIC(3,2) GENERATED ALWAYS AS (
    CASE status
      WHEN 'present'          THEN 1.00
      WHEN 'late'             THEN 1.00
      WHEN 'half_day'         THEN 0.50
      WHEN 'absent_excused'   THEN 0.00
      WHEN 'absent_unexcused' THEN 0.00
      WHEN 'on_leave'         THEN 0.00
      WHEN 'public_holiday'   THEN 0.00
      WHEN 'day_off'          THEN 0.00
      ELSE                         0.00
    END
  ) STORED,
  CONSTRAINT uq_driver_attendance UNIQUE (tenant_id, attendance_date, driver_id),
  CONSTRAINT chk_attendance_late_minutes CHECK (late_minutes >= 0),
  CONSTRAINT chk_attendance_overtime_minutes CHECK (overtime_minutes >= 0),
  CONSTRAINT chk_attendance_checkout CHECK (
    check_out_time IS NULL OR check_in_time IS NULL OR check_out_time >= check_in_time
  )
);

CREATE INDEX idx_driver_attendance_active
  ON driver_attendance (tenant_id, attendance_date, driver_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_driver_attendance_driver_date
  ON driver_attendance (driver_id, attendance_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_driver_attendance_period
  ON driver_attendance (tenant_id, driver_id, attendance_date)
  WHERE deleted_at IS NULL AND is_locked = false;

-- ═══ Leave types ═══
CREATE TABLE leave_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  code              TEXT NOT NULL,
  name_ar           TEXT NOT NULL,
  name_en           TEXT,
  days_per_year     SMALLINT NOT NULL DEFAULT 0,
  is_paid           BOOLEAN NOT NULL DEFAULT true,
  is_deductible     BOOLEAN NOT NULL DEFAULT false,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  requires_document BOOLEAN NOT NULL DEFAULT false,
  color             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT chk_leave_type_days CHECK (days_per_year >= 0)
);

CREATE UNIQUE INDEX idx_leave_types_unique_code
  ON leave_types (tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_leave_types_active
  ON leave_types (tenant_id)
  WHERE deleted_at IS NULL;

-- ═══ Driver leave requests ═══
CREATE TABLE driver_leave_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  driver_id        UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  leave_type_id    UUID NOT NULL REFERENCES leave_types(id),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  days_requested   SMALLINT NOT NULL,
  reason           TEXT,
  status           leave_status NOT NULL DEFAULT 'pending',
  requested_by     UUID REFERENCES auth.users(id),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by      UUID REFERENCES auth.users(id),
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  attachment_url   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_leave_days CHECK (days_requested > 0)
);

CREATE INDEX idx_leave_requests_pending
  ON driver_leave_requests (tenant_id, status, start_date)
  WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_leave_requests_driver
  ON driver_leave_requests (tenant_id, driver_id, start_date DESC)
  WHERE deleted_at IS NULL;

-- ═══ Driver leave balances ═══
CREATE TABLE driver_leave_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  leave_type_id   UUID NOT NULL REFERENCES leave_types(id),
  year            SMALLINT NOT NULL,
  entitled_days   SMALLINT NOT NULL DEFAULT 0,
  used_days       SMALLINT NOT NULL DEFAULT 0,
  pending_days    SMALLINT NOT NULL DEFAULT 0,
  remaining_days  SMALLINT NOT NULL DEFAULT 0,
  carried_over    SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_leave_balance CHECK (
    entitled_days >= 0 AND used_days >= 0 AND pending_days >= 0
    AND remaining_days >= 0 AND carried_over >= 0
  )
);

CREATE UNIQUE INDEX idx_leave_balances_unique_year
  ON driver_leave_balances (tenant_id, driver_id, leave_type_id, year)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_leave_balances_driver_year
  ON driver_leave_balances (tenant_id, driver_id, year)
  WHERE deleted_at IS NULL;

-- ═══ Public holidays ═══
CREATE TABLE public_holidays (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  holiday_date     DATE,
  name_ar          TEXT NOT NULL,
  name_en          TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  duration_days    SMALLINT NOT NULL DEFAULT 1,
  calendar_type    TEXT NOT NULL DEFAULT 'gregorian',
  is_recurring     BOOLEAN NOT NULL DEFAULT false,
  gregorian_month  SMALLINT,
  gregorian_day    SMALLINT,
  hijri_month      SMALLINT,
  hijri_day        SMALLINT,
  notes            TEXT,
  CONSTRAINT uq_public_holiday UNIQUE (tenant_id, holiday_date),
  CONSTRAINT chk_holiday_calendar_type CHECK (
    calendar_type IN ('gregorian', 'hijri', 'fixed')
  ),
  CONSTRAINT chk_holiday_duration CHECK (duration_days > 0),
  CONSTRAINT chk_holiday_gregorian_month CHECK (
    gregorian_month IS NULL OR gregorian_month BETWEEN 1 AND 12
  ),
  CONSTRAINT chk_holiday_gregorian_day CHECK (
    gregorian_day IS NULL OR gregorian_day BETWEEN 1 AND 31
  ),
  CONSTRAINT chk_holiday_hijri_month CHECK (
    hijri_month IS NULL OR hijri_month BETWEEN 1 AND 12
  ),
  CONSTRAINT chk_holiday_hijri_day CHECK (
    hijri_day IS NULL OR hijri_day BETWEEN 1 AND 30
  )
);

CREATE INDEX idx_public_holidays_date
  ON public_holidays (tenant_id, holiday_date)
  WHERE is_active = true;
CREATE INDEX idx_public_holidays_hijri
  ON public_holidays (tenant_id, hijri_month, hijri_day)
  WHERE calendar_type = 'hijri' AND is_active = true;

-- ═══ Attendance summary ═══
CREATE TABLE driver_attendance_summary (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  driver_id               UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  period_year             SMALLINT NOT NULL,
  period_month            SMALLINT NOT NULL,
  working_days_target     SMALLINT NOT NULL DEFAULT 26,
  working_days_actual     NUMERIC(5,2) NOT NULL DEFAULT 0,
  days_present            SMALLINT NOT NULL DEFAULT 0,
  days_late               SMALLINT NOT NULL DEFAULT 0,
  days_half_day           SMALLINT NOT NULL DEFAULT 0,
  days_absent_excused     SMALLINT NOT NULL DEFAULT 0,
  days_absent_unexcused   SMALLINT NOT NULL DEFAULT 0,
  days_on_leave           SMALLINT NOT NULL DEFAULT 0,
  days_public_holiday     SMALLINT NOT NULL DEFAULT 0,
  days_day_off            SMALLINT NOT NULL DEFAULT 0,
  total_late_minutes      INTEGER NOT NULL DEFAULT 0,
  total_overtime_minutes  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT uq_attendance_summary UNIQUE (tenant_id, driver_id, period_year, period_month),
  CONSTRAINT chk_summary_month CHECK (period_month BETWEEN 1 AND 12)
);

CREATE INDEX idx_attendance_summary_driver_period
  ON driver_attendance_summary (tenant_id, driver_id, period_year, period_month)
  WHERE deleted_at IS NULL;

-- ═══ Updated-at triggers ═══
CREATE TRIGGER trg_attendance_periods_updated_at
  BEFORE UPDATE ON attendance_periods FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_driver_work_schedules_updated_at
  BEFORE UPDATE ON driver_work_schedules FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_driver_attendance_updated_at
  BEFORE UPDATE ON driver_attendance FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_leave_types_updated_at
  BEFORE UPDATE ON leave_types FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_leave_requests_updated_at
  BEFORE UPDATE ON driver_leave_requests FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_leave_balances_updated_at
  BEFORE UPDATE ON driver_leave_balances FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_attendance_summary_updated_at
  BEFORE UPDATE ON driver_attendance_summary FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══ Row-level security ═══
ALTER TABLE attendance_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_attendance_summary ENABLE ROW LEVEL SECURITY;

-- Attendance periods
CREATE POLICY attendance_periods_sel ON attendance_periods FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY attendance_periods_ins ON attendance_periods FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY attendance_periods_upd ON attendance_periods FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Work schedules
CREATE POLICY work_schedules_sel ON driver_work_schedules FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY work_schedules_ins ON driver_work_schedules FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY work_schedules_upd ON driver_work_schedules FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Driver attendance
CREATE POLICY driver_attendance_sel ON driver_attendance FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY driver_attendance_ins ON driver_attendance FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY driver_attendance_upd ON driver_attendance FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Leave types
CREATE POLICY leave_types_sel ON leave_types FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY leave_types_ins ON leave_types FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY leave_types_upd ON leave_types FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Leave requests
CREATE POLICY leave_requests_sel ON driver_leave_requests FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY leave_requests_ins ON driver_leave_requests FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY leave_requests_upd ON driver_leave_requests FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Leave balances
CREATE POLICY leave_balances_sel ON driver_leave_balances FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY leave_balances_ins ON driver_leave_balances FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY leave_balances_upd ON driver_leave_balances FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Public holidays
CREATE POLICY public_holidays_sel ON public_holidays FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND is_active = true);
CREATE POLICY public_holidays_ins ON public_holidays FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY public_holidays_upd ON public_holidays FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- Attendance summary
CREATE POLICY attendance_summary_sel ON driver_attendance_summary FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY attendance_summary_ins ON driver_attendance_summary FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY attendance_summary_upd ON driver_attendance_summary FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());