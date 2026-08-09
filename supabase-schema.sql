-- ============================================================
-- Attendance Sheet App — Supabase PostgreSQL Schema
-- ⚠️  SAFE VERSION — NO DROP TABLE COMMANDS
-- ============================================================
--
-- HOW TO USE:
--   Run this ONLY when setting up a BRAND NEW empty database.
--   NEVER run this on a live database that already has data.
--
-- All tables use "CREATE TABLE IF NOT EXISTS" so running this
-- on an existing database is SAFE — it will NOT delete any data.
-- ============================================================

-- ⛔ DROP STATEMENTS PERMANENTLY REMOVED — DO NOT ADD THEM BACK ⛔
-- Reason: Running DROP TABLE deletes ALL employee records and
-- attendance history permanently with no way to recover.

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS employees (
  "id"              TEXT PRIMARY KEY,
  "name"            TEXT NOT NULL,
  "role"            TEXT DEFAULT 'Staff',
  "status"          TEXT DEFAULT 'OUT' CHECK (status IN ('IN', 'OUT')),
  "pin"             TEXT NOT NULL DEFAULT '1234',
  "token"           TEXT UNIQUE NOT NULL,
  "dateCreated"     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "tokenCreatedAt"  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "linkExpireCount" INTEGER DEFAULT 0,
  "minusScore"      INTEGER DEFAULT 0
);

-- Safe column additions for existing databases
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "tokenCreatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "linkExpireCount" INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "minusScore" INTEGER DEFAULT 0;

-- 2. Settings Table (single-row config)
CREATE TABLE IF NOT EXISTS settings (
  "id"            TEXT PRIMARY KEY DEFAULT 'default',
  "adminPasscode" TEXT DEFAULT '1234',
  "officeName"    TEXT DEFAULT 'My Office',
  "adminToken"    TEXT
);

-- 3. Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
  "id"               TEXT PRIMARY KEY,
  "employeeId"       TEXT NOT NULL REFERENCES employees("id") ON DELETE CASCADE,
  "employeeName"     TEXT NOT NULL,
  "role"             TEXT NOT NULL,
  "date"             TEXT NOT NULL,
  "clockInTime"      TIMESTAMP WITH TIME ZONE NOT NULL,
  "clockOutTime"     TIMESTAMP WITH TIME ZONE,
  "clockInLocation"  JSONB,
  "clockOutLocation" JSONB,
  "duration"         INTEGER,
  "performanceNotes" TEXT,
  "receivedAmount"   NUMERIC DEFAULT 0,
  "expenseAmount"    NUMERIC DEFAULT 0,
  "moneySpent"       NUMERIC DEFAULT 0,
  "image"            TEXT
);

-- 4. Work Records Table (monthly daily entries per employee)
CREATE TABLE IF NOT EXISTS work_records (
  "id"               TEXT PRIMARY KEY,
  "employeeId"       TEXT NOT NULL REFERENCES employees("id") ON DELETE CASCADE,
  "employeeName"     TEXT NOT NULL,
  "month"            TEXT NOT NULL,
  "date"             TEXT NOT NULL,
  "performedWork"    TEXT NOT NULL,
  "receivedAmount"   NUMERIC DEFAULT 0,
  "expenseAmount"    NUMERIC DEFAULT 0,
  "paymentIssuance"  NUMERIC,
  "balancePayment"   TEXT,
  "materialIssuance" TEXT,
  "materialBalance"  TEXT,
  "otherRemarks"     TEXT,
  "createdAt"        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Work Profiles Table (one per employee per month)
CREATE TABLE IF NOT EXISTS work_profiles (
  "employeeId" TEXT NOT NULL REFERENCES employees("id") ON DELETE CASCADE,
  "month"      TEXT NOT NULL,
  "fatherName" TEXT,
  PRIMARY KEY ("employeeId", "month")
);

-- 6. Form Submissions Table (employee documents like CNIC, CV, etc.)
CREATE TABLE IF NOT EXISTS form_submissions (
  "id"               TEXT PRIMARY KEY,
  "employeeId"       TEXT NOT NULL REFERENCES employees("id") ON DELETE CASCADE,
  "employeeName"     TEXT NOT NULL,
  "formType"         TEXT NOT NULL,
  "formData"         JSONB NOT NULL,
  "submittedAt"      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Employee Evaluations Table
CREATE TABLE IF NOT EXISTS employee_evaluations (
  "id"               TEXT PRIMARY KEY,
  "employeeId"       TEXT NOT NULL REFERENCES employees("id") ON DELETE CASCADE,
  "employeeName"     TEXT NOT NULL,
  "month"            TEXT NOT NULL,
  "score"            INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  "remarks"          TEXT,
  "createdAt"        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Indexes for fast lookups (IF NOT EXISTS prevents duplicate errors) ─
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id  ON attendance("employeeId");
CREATE INDEX IF NOT EXISTS idx_attendance_date         ON attendance("date");
CREATE INDEX IF NOT EXISTS idx_work_records_employee_id ON work_records("employeeId");
CREATE INDEX IF NOT EXISTS idx_work_records_month      ON work_records("month");
CREATE INDEX IF NOT EXISTS idx_work_records_date       ON work_records("date");
CREATE INDEX IF NOT EXISTS idx_employees_token         ON employees("token");
CREATE INDEX IF NOT EXISTS idx_form_submissions_employee_id ON form_submissions("employeeId");
CREATE INDEX IF NOT EXISTS idx_form_submissions_type   ON form_submissions("formType");

-- ── Row Level Security (RLS) ─────────────────────────────
ALTER TABLE employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_evaluations ENABLE ROW LEVEL SECURITY;

-- Policies (DO NOTHING if they already exist — avoids errors on re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='employees' AND policyname='Allow all access for employees') THEN
    CREATE POLICY "Allow all access for employees" ON employees FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Allow all access for settings') THEN
    CREATE POLICY "Allow all access for settings" ON settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attendance' AND policyname='Allow all access for attendance') THEN
    CREATE POLICY "Allow all access for attendance" ON attendance FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='work_records' AND policyname='Allow all access for work_records') THEN
    CREATE POLICY "Allow all access for work_records" ON work_records FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='work_profiles' AND policyname='Allow all access for work_profiles') THEN
    CREATE POLICY "Allow all access for work_profiles" ON work_profiles FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='form_submissions' AND policyname='Allow all access for form_submissions') THEN
    CREATE POLICY "Allow all access for form_submissions" ON form_submissions FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='employee_evaluations' AND policyname='Allow all access for employee_evaluations') THEN
    CREATE POLICY "Allow all access for employee_evaluations" ON employee_evaluations FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Seed default settings row (safe — does nothing if row exists) ─────
INSERT INTO settings ("id", "adminPasscode", "officeName")
VALUES ('default', '1234', 'My Office')
ON CONFLICT ("id") DO NOTHING;