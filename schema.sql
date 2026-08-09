-- ============================================================
-- Attendance Sheet App — Supabase PostgreSQL Schema
-- Copy-paste this ENTIRE script into your Supabase Dashboard:
--   SQL Editor → New Query → Paste → Run
--
-- IMPORTANT: Column names are QUOTED to preserve camelCase.
-- PostgreSQL folds unquoted names to lowercase, which breaks
-- the Supabase JS client queries (e.g. employeeId → employeeid).
-- ============================================================

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS employees (
  "id"              TEXT PRIMARY KEY,
  "name"            TEXT NOT NULL,
  "role"            TEXT DEFAULT 'Staff',
  "status"          TEXT DEFAULT 'OUT' CHECK (status IN ('IN', 'OUT', 'LEAVE')),
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

-- ── Indexes for fast lookups ──────────────────────────────
CREATE INDEX idx_attendance_employee_id  ON attendance("employeeId");
CREATE INDEX idx_attendance_date         ON attendance("date");
CREATE INDEX idx_work_records_employee_id ON work_records("employeeId");
CREATE INDEX idx_work_records_month      ON work_records("month");
CREATE INDEX idx_work_records_date       ON work_records("date");
CREATE INDEX idx_employees_token         ON employees("token");
CREATE INDEX idx_form_submissions_employee_id ON form_submissions("employeeId");
CREATE INDEX idx_form_submissions_type   ON form_submissions("formType");

-- ── Row Level Security (RLS) ─────────────────────────────
ALTER TABLE employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for employees"      ON employees      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for settings"       ON settings       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for attendance"     ON attendance     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for work_records"   ON work_records   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for work_profiles"  ON work_profiles  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for form_submissions" ON form_submissions FOR ALL USING (true) WITH CHECK (true);

-- ── Seed default settings row ─────────────────────────────
INSERT INTO settings ("id", "adminPasscode", "officeName")
VALUES ('default', '1234', 'My Office')
ON CONFLICT ("id") DO NOTHING;