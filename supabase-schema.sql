-- ============================================================
-- Attendance Sheet App — Supabase PostgreSQL Schema
-- Copy-paste this ENTIRE script into your Supabase Dashboard:
--   SQL Editor → New Query → Paste → Run
--
-- IMPORTANT: Column names are QUOTED to preserve camelCase.
-- PostgreSQL folds unquoted names to lowercase, which breaks
-- the Supabase JS client queries (e.g. employeeId → employeeid).
-- ============================================================

-- Drop existing tables if they exist (clean slate)
DROP TABLE IF EXISTS work_profiles CASCADE;
DROP TABLE IF EXISTS work_records CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

-- 1. Employees Table
CREATE TABLE employees (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "role"        TEXT DEFAULT 'Staff',
  "status"      TEXT DEFAULT 'OUT' CHECK (status IN ('IN', 'OUT')),
  "pin"         TEXT NOT NULL DEFAULT '1234',
  "token"       TEXT UNIQUE NOT NULL,
  "dateCreated" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Settings Table (single-row config)
CREATE TABLE settings (
  "id"            TEXT PRIMARY KEY DEFAULT 'default',
  "adminPasscode" TEXT DEFAULT '1234',
  "officeName"    TEXT DEFAULT 'My Office',
  "adminToken"    TEXT
);

-- 3. Attendance Table
CREATE TABLE attendance (
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
CREATE TABLE work_records (
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
CREATE TABLE work_profiles (
  "employeeId" TEXT NOT NULL REFERENCES employees("id") ON DELETE CASCADE,
  "month"      TEXT NOT NULL,
  "fatherName" TEXT,
  PRIMARY KEY ("employeeId", "month")
);

-- ── Indexes for fast lookups ──────────────────────────────
CREATE INDEX idx_attendance_employee_id  ON attendance("employeeId");
CREATE INDEX idx_attendance_date         ON attendance("date");
CREATE INDEX idx_work_records_employee_id ON work_records("employeeId");
CREATE INDEX idx_work_records_month      ON work_records("month");
CREATE INDEX idx_work_records_date       ON work_records("date");
CREATE INDEX idx_employees_token         ON employees("token");

-- ── Row Level Security (RLS) ─────────────────────────────
ALTER TABLE employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_profiles  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for employees"     ON employees     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for settings"      ON settings      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for attendance"    ON attendance    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for work_records"  ON work_records  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access for work_profiles" ON work_profiles FOR ALL USING (true) WITH CHECK (true);

-- ── Seed default settings row ─────────────────────────────
INSERT INTO settings ("id", "adminPasscode", "officeName")
VALUES ('default', '1234', 'My Office')
ON CONFLICT ("id") DO NOTHING;
