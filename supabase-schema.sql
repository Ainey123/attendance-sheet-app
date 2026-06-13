-- Supabase PostgreSQL Schema for Attendance Sheet App
-- Run this in your Supabase project's SQL Editor

-- Employees Table
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Staff',
  status TEXT DEFAULT 'OUT' CHECK (status IN ('IN', 'OUT')),
  pin TEXT NOT NULL DEFAULT '1234',
  token TEXT UNIQUE NOT NULL,
  dateCreated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  adminPasscode TEXT DEFAULT '1234',
  officeName TEXT DEFAULT 'My Office',
  adminToken TEXT
);

-- Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  employeeId TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employeeName TEXT NOT NULL,
  role TEXT NOT NULL,
  date TEXT NOT NULL,
  clockInTime TIMESTAMP WITH TIME ZONE NOT NULL,
  clockOutTime TIMESTAMP WITH TIME ZONE,
  clockInLocation JSONB,
  clockOutLocation JSONB,
  duration INTEGER,
  performanceNotes TEXT,
  receivedAmount NUMERIC DEFAULT 0,
  expenseAmount NUMERIC DEFAULT 0,
  moneySpent NUMERIC DEFAULT 0,
  image TEXT
);

-- Work Records Table
CREATE TABLE IF NOT EXISTS work_records (
  id TEXT PRIMARY KEY,
  employeeId TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employeeName TEXT NOT NULL,
  month TEXT NOT NULL,
  date TEXT NOT NULL,
  performedWork TEXT NOT NULL,
  receivedAmount NUMERIC DEFAULT 0,
  expenseAmount NUMERIC DEFAULT 0,
  paymentIssuance NUMERIC,
  balancePayment TEXT,
  materialIssuance TEXT,
  materialBalance TEXT,
  otherRemarks TEXT,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Work Profiles Table
CREATE TABLE IF NOT EXISTS work_profiles (
  employeeId TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  fatherName TEXT,
  PRIMARY KEY (employeeId, month)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance(employeeId);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_work_records_employee_id ON work_records(employeeId);
CREATE INDEX IF NOT EXISTS idx_work_records_month ON work_records(month);
CREATE INDEX IF NOT EXISTS idx_work_records_date ON work_records(date);

-- Enable Row Level Security (RLS) for security
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations (for simplicity in this app)
-- In production, you may want to restrict access based on authentication
CREATE POLICY "Enable all access for employees" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for settings" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for attendance" ON attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for work_records" ON work_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for work_profiles" ON work_profiles FOR ALL USING (true) WITH CHECK (true);

-- Insert default settings
INSERT INTO settings (id, adminPasscode, officeName)
VALUES ('default', '1234', 'My Office')
ON CONFLICT (id) DO NOTHING;
