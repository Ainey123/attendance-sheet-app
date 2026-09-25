const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config();

// ─── Supabase Configuration ────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
let useLocalFallback = false;
let cachedSettings = null;
let lastSettingsFetch = 0;
let settingsFetchPromise = null;

// Check if Supabase is configured
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Using Supabase database for persistent storage');

  // Auto-migrate: remove the status CHECK constraint so soft-delete works
  // and add isArchived column if missing. Uses raw SQL via rpc if available.
  (async () => {
    try {
      const { data, error: pingError } = await supabase.from('employees').select('id').limit(1);
      if (pingError) {
        console.warn('Supabase initial ping notice:', pingError.message);
        if (
          pingError.message?.includes('exceed_egress_quota') ||
          pingError.message?.includes('restricted') ||
          pingError.message?.includes('quota') ||
          pingError.message?.includes('Failed to fetch') ||
          pingError.status === 402 ||
          pingError.status === 403
        ) {
          console.warn('⚠️ Supabase egress quota exceeded or project restricted.');
          if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
            console.warn('Activating local JSON database fallback for local dev/testing.');
            useLocalFallback = true;
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Supabase initial connection failed:', e.message);
      if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
        useLocalFallback = true;
      }
      return;
    }

    try {
      const { error: rpcError } = await supabase.rpc('exec_sql', {
        sql: `
          ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
          ALTER TABLE employees DROP CONSTRAINT IF EXISTS "employees_status_check";
          ALTER TABLE employees ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT FALSE;
          ALTER TABLE employees ADD COLUMN IF NOT EXISTS "tokenCreatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
          ALTER TABLE employees ADD COLUMN IF NOT EXISTS "linkExpireCount" INTEGER DEFAULT 0;
          ALTER TABLE employees ADD COLUMN IF NOT EXISTS "minusScore" INTEGER DEFAULT 0;
          CREATE TABLE IF NOT EXISTS comments (
            "id"           TEXT PRIMARY KEY,
            "employeeId"   TEXT NOT NULL,
            "employeeName" TEXT NOT NULL,
            "sender"       TEXT NOT NULL,
            "senderName"   TEXT NOT NULL,
            "message"      TEXT NOT NULL,
            "createdAt"    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "isRead"       BOOLEAN DEFAULT TRUE
          );
          ALTER TABLE comments ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN DEFAULT TRUE;
          CREATE TABLE IF NOT EXISTS expense_verifications (
            "id"                 TEXT PRIMARY KEY,
            "employeeId"         TEXT NOT NULL,
            "employeeName"       TEXT NOT NULL,
            "salaryMonth"        TEXT NOT NULL,
            "claimedAmount"      NUMERIC DEFAULT 0,
            "verifiedAmount"     NUMERIC,
            "verifiedBy"         TEXT,
            "verifiedAt"         TIMESTAMP WITH TIME ZONE,
            "verificationStatus" TEXT DEFAULT 'PENDING',
            "approvedAmount"     NUMERIC,
            "approvedBy"         TEXT,
            "approvedAt"         TIMESTAMP WITH TIME ZONE,
            "approvalStatus"     TEXT DEFAULT 'PENDING',
            "notes"              TEXT,
            "auditLog"           JSONB DEFAULT '[]'::jsonb,
            "createdAt"          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt"          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS materials (
            "id" TEXT PRIMARY KEY,
            "name" TEXT UNIQUE NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS material_transactions (
            "id" TEXT PRIMARY KEY,
            "employeeId" TEXT NOT NULL,
            "employeeName" TEXT NOT NULL,
            "materialId" TEXT NOT NULL,
            "materialName" TEXT NOT NULL,
            "previousApprovedRemaining" NUMERIC DEFAULT 0,
            "inwardQuantity" NUMERIC DEFAULT 0,
            "inwardDate" TEXT,
            "inwardComment" TEXT,
            "outwardQuantity" NUMERIC DEFAULT 0,
            "outwardDate" TEXT,
            "outwardComment" TEXT,
            "availableQuantity" NUMERIC DEFAULT 0,
            "remainingQuantity" NUMERIC DEFAULT 0,
            "remainingComment" TEXT,
            "status" TEXT DEFAULT 'PENDING_VERIFICATION',
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS material_attachments (
            "id" TEXT PRIMARY KEY,
            "transactionId" TEXT NOT NULL,
            "step" TEXT NOT NULL,
            "fileType" TEXT,
            "fileData" TEXT,
            "uploadedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS material_verifications (
            "id" TEXT PRIMARY KEY,
            "transactionId" TEXT NOT NULL,
            "verifiedBy" TEXT NOT NULL,
            "verificationComment" TEXT,
            "verifiedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS material_verification_attachments (
            "id" TEXT PRIMARY KEY,
            "verificationId" TEXT NOT NULL,
            "fileType" TEXT,
            "fileData" TEXT
          );
          CREATE TABLE IF NOT EXISTS material_approvals (
            "id" TEXT PRIMARY KEY,
            "transactionId" TEXT NOT NULL,
            "approvedBy" TEXT NOT NULL,
            "approvalComment" TEXT,
            "approvedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS material_approval_attachments (
            "id" TEXT PRIMARY KEY,
            "approvalId" TEXT NOT NULL,
            "fileType" TEXT,
            "fileData" TEXT
          );

          CREATE SEQUENCE IF NOT EXISTS bills_seq START WITH 1 INCREMENT BY 1;
          CREATE TABLE IF NOT EXISTS bills (
            "id"                    TEXT PRIMARY KEY,
            "billNumber"            TEXT UNIQUE NOT NULL DEFAULT ('BILL-' || LPAD(nextval('bills_seq')::TEXT, 6, '0')),
            "employeeId"            TEXT NOT NULL,
            "employeeName"          TEXT NOT NULL,
            "siteName"              TEXT NOT NULL,
            "billDate"              TEXT NOT NULL,
            "submittedAt"           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "transportationExpense" NUMERIC DEFAULT 0 CHECK ("transportationExpense" >= 0),
            "materialExpense"       NUMERIC DEFAULT 0 CHECK ("materialExpense" >= 0),
            "labourExpense"         NUMERIC DEFAULT 0 CHECK ("labourExpense" >= 0),
            "accommodationExpense"  NUMERIC DEFAULT 0 CHECK ("accommodationExpense" >= 0),
            "otherExpense"          NUMERIC DEFAULT 0 CHECK ("otherExpense" >= 0),
            "totalClaimedAmount"    NUMERIC NOT NULL DEFAULT 0 CHECK ("totalClaimedAmount" >= 0),
            "description"           TEXT,
            "attachments"           JSONB DEFAULT '[]'::jsonb,
            "status"                TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK ("status" IN ('PENDING_VERIFICATION', 'VERIFIED', 'APPROVED', 'REJECTED')),
            "verifiedAmount"        NUMERIC CHECK ("verifiedAmount" IS NULL OR "verifiedAmount" >= 0),
            "verifiedBy"            TEXT,
            "verifiedAt"            TIMESTAMP WITH TIME ZONE,
            "verificationComment"   TEXT,
            "approvedAmount"        NUMERIC CHECK ("approvedAmount" IS NULL OR "approvedAmount" >= 0),
            "approvedBy"            TEXT,
            "approvedAt"            TIMESTAMP WITH TIME ZONE,
            "approvalComment"       TEXT,
            "rejectedBy"            TEXT,
            "rejectedAt"            TIMESTAMP WITH TIME ZONE,
            "rejectionReason"       TEXT,
            "auditLog"              JSONB DEFAULT '[]'::jsonb,
            "createdAt"             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt"             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_bills_employee_id ON bills("employeeId");
          CREATE INDEX IF NOT EXISTS idx_bills_bill_number ON bills("billNumber");
          CREATE INDEX IF NOT EXISTS idx_bills_status      ON bills("status");
          CREATE INDEX IF NOT EXISTS idx_bills_date        ON bills("billDate");

        `
      });
      if (rpcError) {
        console.log('Auto-migration via rpc not available (safe to ignore):', rpcError.message);
        if (
          rpcError.message?.includes('exceed_egress_quota') ||
          rpcError.message?.includes('restricted') ||
          rpcError.message?.includes('quota')
        ) {
          useLocalFallback = true;
        }
      } else {
        console.log('Auto-migration: status constraint removed, isArchived column ensured, tables ready.');
      }
    } catch (e) {
      console.log('Auto-migration skipped (safe to ignore):', e.message);
    }
  })();
} else {
  useLocalFallback = true;
  console.log('WARNING: Supabase not configured. Using local file storage.');
}

// ─── Local File Storage (Fallback) ───────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadLocalData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const file = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return {
        employees: file.employees || [],
        attendance: file.attendance || [],
        workRecords: file.workRecords || [],
        workProfiles: file.workProfiles || {},
        settings: file.settings || { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' },
        formSubmissions: file.formSubmissions || [],
        employeeEvaluations: file.employeeEvaluations || [],
        comments: file.comments || [],
        salaries: file.salaries || [],
        accountsPdfs: file.accountsPdfs || [],
        salaryApprovals: file.salaryApprovals || [],
        expenseVerifications: file.expenseVerifications || [], materials: file.materials || [], materialTransactions: file.materialTransactions || [], materialAttachments: file.materialAttachments || [], materialVerifications: file.materialVerifications || [], materialVerificationAttachments: file.materialVerificationAttachments || [], materialApprovals: file.materialApprovals || [], materialApprovalAttachments: file.materialApprovalAttachments || [],
        bills: file.bills || []
      };
    }
  } catch (e) {}
  return { employees: [], attendance: [], workRecords: [], workProfiles: {}, settings: { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' }, formSubmissions: [], employeeEvaluations: [], comments: [], salaries: [], accountsPdfs: [], salaryApprovals: [], expenseVerifications: [], materials: [], materialTransactions: [], materialAttachments: [], materialVerifications: [], materialVerificationAttachments: [], materialApprovals: [], materialApprovalAttachments: [], bills: [] };
}

function saveLocalData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

// Generate unique ID
function generateId(prefix = '') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 8; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}

// Format date to local YYYY-MM-DD (Asia/Karachi PKT timezone)
function getLocalDateString(dateInput = new Date()) {
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(d);
  } catch (err) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const offset = d.getTimezoneOffset();
    const adjustedDate = new Date(d.getTime() - (offset * 60 * 1000));
    return adjustedDate.toISOString().split('T')[0];
  }
}

function isLeaveAttendanceRecord(record) {
  return Boolean(record && String(record.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));
}

function isQuotaOrNetworkError(error) {
  if (!error) return false;
  const msg = (error.message || String(error)).toLowerCase();
  return (
    msg.includes('exceed_egress_quota') ||
    msg.includes('restricted') ||
    msg.includes('quota') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch_error') ||
    msg.includes('terminated') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('service unavailable') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table') ||
    msg.includes('pgrst204') ||
    error.status === 402 ||
    error.status === 403
  );
}

// Helper function to handle Supabase errors
function handleSupabaseError(error, operation) {
  console.error(`Database error during ${operation}:`, error ? (error.message || error) : 'Unknown error');
  if (isQuotaOrNetworkError(error)) {
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
      console.warn(`Supabase service error during ${operation}. Enabling local JSON database fallback for dev.`);
      useLocalFallback = true;
    }
  }
  throw new Error(`Failed to ${operation}: ${error ? (error.message || error) : 'Unknown error'}`);
}

let _lastAllocatedBillNum = 0;

const db = {
  get useLocalFallback() {
    return useLocalFallback;
  },
  set useLocalFallback(val) {
    useLocalFallback = !!val;
  },

  // --- Employee Methods ---
  async checkAndUpdateLinkCycle(emp) {
    if (!emp || emp.status === 'DELETED' || emp.isArchived) return emp;

    const now = Date.now();
    const startTimeStr = emp.tokenCreatedAt || emp.dateCreated || new Date(now).toISOString();
    const startTime = new Date(startTimeStr).getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const diffMs = now - startTime;

    if (isNaN(startTime) || diffMs < 0) return emp;

    const cyclesPassed = Math.floor(diffMs / twentyFourHoursMs);
    if (cyclesPassed > 0) {
      const newExpireCount = (emp.linkExpireCount || 0) + cyclesPassed;
      const newMinusScore = (emp.minusScore || 0) - cyclesPassed; // -1 penalty per 24h cycle
      const newTokenCreatedAt = new Date(startTime + (cyclesPassed * twentyFourHoursMs)).toISOString();

      emp.linkExpireCount = newExpireCount;
      emp.minusScore = newMinusScore;
      emp.tokenCreatedAt = newTokenCreatedAt;
      emp.justExpired = true;
      emp.expireCount = newExpireCount;
      emp.expireMessage = newExpireCount === 1 
        ? "Warning: -1 point deducted for late clock-out (forgot to clock out within 24 hours)" 
        : `Warning: -${newExpireCount} points deducted for late clock-out (${newExpireCount} times)`;

      if (useLocalFallback) {
        const data = loadLocalData();
        const found = data.employees.find(e => e.id === emp.id);
        if (found) {
          found.linkExpireCount = newExpireCount;
          found.minusScore = newMinusScore;
          found.tokenCreatedAt = newTokenCreatedAt;
          saveLocalData(data);
        }
      } else {
        try {
          await supabase
            .from('employees')
            .update({
              linkExpireCount: newExpireCount,
              minusScore: newMinusScore,
              tokenCreatedAt: newTokenCreatedAt
            })
            .eq('id', emp.id);
        } catch (err) {
          console.warn('Persisting link cycle in Supabase failed:', err.message);
        }
      }
    } else {
      emp.justExpired = false;
      emp.expireCount = emp.linkExpireCount || 0;
      emp.minusScore = emp.minusScore || 0;
      emp.expireMessage = (emp.linkExpireCount && emp.linkExpireCount > 0)
        ? (emp.linkExpireCount === 1 
          ? "Notice: -1 point deducted for late clock-out" 
          : `Notice: -${emp.linkExpireCount} points deducted for late clock-out (${emp.linkExpireCount} times)`)
        : null;
    }

    return emp;
  },

  async getEmployees(includeArchived = false) {
    if (useLocalFallback) {
      const data = loadLocalData();
      let emps = data.employees || [];
      emps = includeArchived ? emps : emps.filter(e => e.status !== 'DELETED' && !e.isArchived);
      let changed = false;
      for (let i = 0; i < emps.length; i++) {
        if (!emps[i].token || emps[i].token.startsWith('EXPIRED_')) {
          emps[i].token = generateToken();
          changed = true;
        }
        emps[i] = await this.checkAndUpdateLinkCycle(emps[i]);
      }
      if (changed) saveLocalData(data);
      return emps;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('dateCreated', { ascending: false });
      
      if (error) handleSupabaseError(error, 'fetch employees');
      let list = data || [];
      if (!includeArchived) {
        list = list.filter(e => e.status !== 'DELETED' && !e.isArchived);
      }
      for (let i = 0; i < list.length; i++) {
        if (!list[i].token || list[i].token.startsWith('EXPIRED_')) {
          list[i].token = generateToken();
          try {
            await supabase.from('employees').update({ token: list[i].token }).eq('id', list[i].id);
          } catch(e) {}
        }
        list[i] = await this.checkAndUpdateLinkCycle(list[i]);
      }
      return list;
    } catch (error) {
      if (isQuotaOrNetworkError(error)) {
        console.warn('Supabase getEmployees failed, automatically using local storage:', error.message || error);
        useLocalFallback = true;
        return this.getEmployees(includeArchived);
      }
      handleSupabaseError(error, 'fetch employees');
    }
  },

  async getEmployeeByToken(token) {
    if (!token || typeof token !== 'string' || token.startsWith('EXPIRED_') || token.startsWith('REVOKED_') || token.startsWith('LEGACY_')) {
      return null;
    }
    let emp = null;
    if (useLocalFallback) {
      const data = loadLocalData();
      emp = data.employees.find(e => e.token === token) || null;
      if (emp && (emp.status === 'DELETED' || emp.isArchived)) return null;
    } else {
      try {
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('token', token)
          .single();
        if (error || !data || data.status === 'DELETED' || data.isArchived) return null;
        emp = data;
      } catch (error) {
        return null;
      }
    }
    if (emp) {
      emp = await this.checkAndUpdateLinkCycle(emp);
    }
    return emp;
  },

  async resetEmployeeToken(id) {
    // Generates a fresh token for an existing employee WITHOUT deleting them.
    // All attendance history is preserved. Use this instead of delete+re-add.
    const newToken = generateToken();
    const nowIso = new Date().toISOString();

    if (useLocalFallback) {
      const data = loadLocalData();
      const emp = data.employees.find(e => e.id === id);
      if (!emp) throw new Error('Employee not found');
      emp.token = newToken;
      emp.tokenCreatedAt = nowIso;
      saveLocalData(data);
      return { token: newToken, tokenCreatedAt: nowIso };
    }
    try {
      const { error } = await supabase
        .from('employees')
        .update({ token: newToken, tokenCreatedAt: nowIso })
        .eq('id', id);

      if (error) {
        // Fallback update if tokenCreatedAt column doesn't exist in Supabase schema
        console.warn('Supabase update with tokenCreatedAt failed, retrying token-only:', error.message);
        const { error: err2 } = await supabase
          .from('employees')
          .update({ token: newToken })
          .eq('id', id);
        if (err2) handleSupabaseError(err2, 'reset employee token');
      }
      return { token: newToken, tokenCreatedAt: nowIso };
    } catch (error) {
      handleSupabaseError(error, 'reset employee token');
    }
  },

  async addEmployee(name, role) {
    const nowIso = new Date().toISOString();
    const newEmployee = {
      id: generateId('emp'),
      name: name.trim(),
      role: role.trim() || 'Staff',
      status: 'OUT',
      pin: '1234',
      token: generateToken(),
      dateCreated: nowIso,
      tokenCreatedAt: nowIso,
      linkExpireCount: 0,
      minusScore: 0
    };

    if (useLocalFallback) {
      const data = loadLocalData();
      data.employees.push(newEmployee);
      saveLocalData(data);
      return newEmployee;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert([newEmployee])
        .select()
        .single();
      if (error) {
        // Fallback insert without new columns if Supabase table has strict schema
        const legacyEmp = {
          id: newEmployee.id,
          name: newEmployee.name,
          role: newEmployee.role,
          status: newEmployee.status,
          pin: newEmployee.pin,
          token: newEmployee.token,
          dateCreated: newEmployee.dateCreated
        };
        const { data: d2, error: e2 } = await supabase
          .from('employees')
          .insert([legacyEmp])
          .select()
          .single();
        if (e2) handleSupabaseError(e2, 'add employee');
        return d2 || newEmployee;
      }
      return data;
    } catch (error) {
      handleSupabaseError(error, 'add employee');
    }
  },

  async deleteEmployee(id) {
    // SOFT DELETE: Preserves all attendance, work, and expense history forever.
    // The employee is hidden from the active roster but their records remain.
    if (useLocalFallback) {
      const data = loadLocalData();
      const emp = data.employees.find(e => e.id === id);
      if (emp) {
        emp.status = 'DELETED';
        emp.isArchived = true;
        emp.token = 'EXPIRED_' + Date.now();
        saveLocalData(data);
      }
      return true;
    }
    try {
      // Try full soft-delete with DELETED status
      const { error } = await supabase
        .from('employees')
        .update({
          status: 'DELETED',
          isArchived: true,
          token: 'EXPIRED_' + Date.now()
        })
        .eq('id', id);

      if (error) {
        // Fallback: if status CHECK constraint rejects 'DELETED',
        // just mark isArchived=true and invalidate token.
        // This hides the employee from the app without touching status.
        console.warn('Full soft-delete failed, trying archive-only fallback:', error.message);
        const { error: err2 } = await supabase
          .from('employees')
          .update({
            isArchived: true,
            token: 'EXPIRED_' + Date.now()
          })
          .eq('id', id);
        if (err2) handleSupabaseError(err2, 'delete employee');
      }
      return true;
    } catch (error) {
      handleSupabaseError(error, 'delete employee');
    }
  },

  async verifyEmployeePin(employeeId, pin) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const emp = data.employees.find(e => e.id === employeeId);
      return emp ? emp.pin === String(pin).trim() : false;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('pin')
        .eq('id', employeeId)
        .single();
      if (error || !data) return false;
      return data.pin === String(pin).trim();
    } catch (error) {
      return false;
    }
  },

  async updateEmployeePin(employeeId, newPin) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const emp = data.employees.find(e => e.id === employeeId);
      if (!emp) throw new Error('Employee not found');
      emp.pin = String(newPin).trim();
      saveLocalData(data);
      return emp;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .update({ pin: String(newPin).trim() })
        .eq('id', employeeId)
        .select()
        .single();
      if (error) handleSupabaseError(error, 'update employee PIN');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update employee PIN');
    }
  },

  async updateEmployeeToken(employeeId, token) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const emp = data.employees.find(e => e.id === employeeId);
      if (!emp) throw new Error('Employee not found');
      emp.token = token;
      saveLocalData(data);
      return emp;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .update({ token })
        .eq('id', employeeId)
        .select()
        .single();
      if (error) handleSupabaseError(error, 'update employee token');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update employee token');
    }
  },

  // --- Settings Methods ---
  async getSettings() {
    if (useLocalFallback) {
      const data = loadLocalData();
      const s = data.settings || {};
      return {
        adminPasscode: s.adminPasscode || '1234',
        seniorAdminPasscode: s.seniorAdminPasscode || '9999',
        officeName: s.officeName || 'My Office',
        adminToken: s.adminToken || null
      };
    }
    if (cachedSettings && (Date.now() - lastSettingsFetch < 60000)) {
        return cachedSettings;
    }
    
    // Cache stampede prevention
    if (settingsFetchPromise) {
      try {
        await settingsFetchPromise;
        if (cachedSettings) return cachedSettings;
      } catch(e) {}
    }
    
    settingsFetchPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('*')
          .single();
        if (error || !data) {
          throw new Error('Supabase fetch failed');
        }
        cachedSettings = {
          ...data,
          seniorAdminPasscode: data.seniorAdminPasscode || '9999'
        };
        lastSettingsFetch = Date.now();
      } finally {
        settingsFetchPromise = null;
      }
    })();
    
    try {
      await settingsFetchPromise;
    } catch (error) {
      if (cachedSettings) return cachedSettings;
      return { adminPasscode: '1290', seniorAdminPasscode: '9999', officeName: 'My Office' };
    }
    return cachedSettings || { adminPasscode: '1290', seniorAdminPasscode: '9999', officeName: 'My Office' };
  },

  async updateSettings(newSettings) {
    cachedSettings = null;
    if (useLocalFallback) {
      const data = loadLocalData();
      data.settings = { ...data.settings, ...newSettings };
      saveLocalData(data);
      return data.settings;
    }
    try {
      const { data: existingData, error: fetchError } = await supabase
        .from('settings')
        .select('*')
        .single();

      if (fetchError || !existingData) {
        const { data, error } = await supabase
          .from('settings')
          .insert([{ ...newSettings, id: 'default' }])
          .select()
          .single();
        if (error) handleSupabaseError(error, 'update settings');
        return data;
      }

      const { data, error } = await supabase
        .from('settings')
        .update(newSettings)
        .eq('id', 'default')
        .select()
        .single();
      if (error) handleSupabaseError(error, 'update settings');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update settings');
    }
  },

  async generateAdminToken() {
    if (useLocalFallback) {
      const data = loadLocalData();
      const token = crypto.randomBytes(16).toString('hex');
      data.settings.adminToken = token;
      saveLocalData(data);
      return token;
    }
    try {
      const token = crypto.randomBytes(16).toString('hex');
      const { data, error } = await supabase
        .from('settings')
        .update({ adminToken: token })
        .eq('id', 'default')
        .select()
        .single();
      if (error) handleSupabaseError(error, 'generate admin token');
      return token;
    } catch (error) {
      handleSupabaseError(error, 'generate admin token');
    }
  },

  // --- Attendance Methods ---
  async getAttendance(filterDate = null) {
    if (useLocalFallback) {
      const data = loadLocalData();
      let records = data.attendance || [];
      if (filterDate) {
        if (/^\d{4}-\d{2}$/.test(filterDate)) {
          records = records.filter(r => r.date && r.date.startsWith(filterDate));
        } else {
          records = records.filter(r => r.date === filterDate);
        }
      }
      return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
    }
    try {
      let query = supabase
        .from('attendance')
        .select('*')
        .order('clockInTime', { ascending: false });

      if (filterDate) {
        if (/^\d{4}-\d{2}$/.test(filterDate)) {
          query = query.gte('date', `${filterDate}-01`).lte('date', `${filterDate}-31`);
        } else {
          query = query.eq('date', filterDate);
        }
      }

      const { data, error } = await query;
      if (error) handleSupabaseError(error, 'fetch attendance');
      return data || [];
    } catch (error) {
      if (isQuotaOrNetworkError(error)) {
        console.warn('Supabase getAttendance failed, automatically using local storage:', error.message || error);
        useLocalFallback = true;
        return this.getAttendance(filterDate);
      }
      handleSupabaseError(error, 'fetch attendance');
    }
  },

  async getTodayAttendanceForEmployee(employeeId) {
    await this.autoCompleteOldAttendance(employeeId).catch(() => {});
    const today = getLocalDateString();
    if (useLocalFallback) {
      const data = loadLocalData();
      const empRecords = (data.attendance || [])
        .filter(r => r.employeeId === employeeId)
        .sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));

      if (empRecords.length === 0) return null;

      // First check if there is an active unclosed record
      const active = empRecords.find(r => !r.clockOutTime);
      if (active) {
        const emp = (data.employees || []).find(e => e.id === employeeId);
        if (emp && emp.status !== 'IN') { emp.status = 'IN'; saveLocalData(data); }
        return active;
      }

      // Check today's records
      const todayRecords = empRecords.filter(r => r.date === today);
      if (todayRecords.length > 0) {
        const leaveRecord = todayRecords.find(isLeaveAttendanceRecord);
        if (leaveRecord) return leaveRecord;
        return todayRecords[0];
      }
      return null;
    }
    try {
      // 1. Check for active unclosed record for this employee
      const { data: activeRecords, error: activeErr } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .is('clockOutTime', null)
        .order('clockInTime', { ascending: false })
        .limit(1);

      if (activeErr && isQuotaOrNetworkError(activeErr)) {
        useLocalFallback = true;
        return this.getTodayAttendanceForEmployee(employeeId);
      }

      if (!activeErr && activeRecords && activeRecords.length > 0) {
        try {
          await supabase.from('employees').update({ status: 'IN' }).eq('id', employeeId).neq('status', 'IN');
        } catch (e) {}
        return activeRecords[0];
      }

      // 2. Fetch today's records
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('date', today)
        .order('clockInTime', { ascending: false });

      if (error) {
        console.error('[getTodayAttendanceForEmployee] Supabase query error:', error.message);
        if (isQuotaOrNetworkError(error)) {
          useLocalFallback = true;
          return this.getTodayAttendanceForEmployee(employeeId);
        }
        return null;
      }
      if (!data || data.length === 0) {
        return null;
      }

      const leaveRecord = data.find(isLeaveAttendanceRecord);
      if (leaveRecord) return leaveRecord;
      return data[0];
    } catch (error) {
      console.error('[getTodayAttendanceForEmployee] Exception:', error.message);
      if (isQuotaOrNetworkError(error)) {
        useLocalFallback = true;
        return this.getTodayAttendanceForEmployee(employeeId);
      }
      return null;
    }
  },

  async clockIn(employeeId, location) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      throw new Error('Please turn on location first');
    }

    await this.autoCompleteOldAttendance(employeeId).catch(() => {});
    const now = new Date();
    const today = getLocalDateString(now);

    if (useLocalFallback) {
      const data = loadLocalData();
      const employee = data.employees.find(e => e.id === employeeId);
      if (!employee) throw new Error('Employee not found');

      // Auto-complete any older unclosed attendance record from prior days so it cannot block new shift
      (data.attendance || []).forEach(r => {
        if (r.employeeId === employeeId && !r.clockOutTime && r.date !== today) {
          const inTime = new Date(r.clockInTime);
          r.clockOutTime = now.toISOString();
          r.duration = Math.max(0, Math.round((now - inTime) / (1000 * 60)));
          r.autoClockOut = true;
          r.autoClockOutNote = 'Auto-closed on next shift clock-in';
        }
      });

      const todayRecords = (data.attendance || []).filter(r => r.employeeId === employeeId && r.date === today);
      const activeRecord = todayRecords.find(r => !r.clockOutTime);
      if (activeRecord) {
        employee.status = 'IN';
        saveLocalData(data);
        return { record: activeRecord, employee, alreadyActive: true };
      }

      const record = {
        id: generateId('att'),
        employeeId: employee.id,
        employeeName: employee.name,
        role: employee.role,
        date: today,
        clockInTime: now.toISOString(),
        clockOutTime: null,
        clockInLocation: location || null,
        clockOutLocation: null,
        duration: null
      };

      data.attendance.push(record);
      employee.status = 'IN';
      saveLocalData(data);
      return { record, employee };
    }
    try {
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (empError || !employee) throw new Error('Employee not found');

      // Check for any unclosed records from prior days and auto-complete them so they never block today's shift
      const { data: priorUnclosed } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .neq('date', today)
        .is('clockOutTime', null);

      if (priorUnclosed && priorUnclosed.length > 0) {
        for (const pr of priorUnclosed) {
          const inTime = new Date(pr.clockInTime);
          const duration = Math.max(0, Math.round((now - inTime) / (1000 * 60)));
          await supabase.from('attendance').update({
            clockOutTime: now.toISOString(),
            duration,
            autoClockOut: true,
            autoClockOutNote: 'Auto-closed on next shift clock-in'
          }).eq('id', pr.id);
        }
      }

      // Check for active unclosed record for today
      const { data: todayRecords, error: todayError } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('date', today)
        .order('clockInTime', { ascending: false });

      if (todayError) throw todayError;

      const activeRecord = todayRecords?.find(r => !r.clockOutTime);
      if (activeRecord) {
        const { data: updatedEmployee } = await supabase
          .from('employees')
          .update({ status: 'IN' })
          .eq('id', employeeId)
          .select()
          .single();
        return { record: activeRecord, employee: updatedEmployee || employee, alreadyActive: true };
      }

      const record = {
        id: generateId('att'),
        employeeId: employee.id,
        employeeName: employee.name,
        role: employee.role,
        date: today,
        clockInTime: now.toISOString(),
        clockOutTime: null,
        clockInLocation: location || null,
        clockOutLocation: null,
        duration: null
      };

      const { data: newRecord, error: insertError } = await supabase
        .from('attendance')
        .insert([record])
        .select()
        .single();

      if (insertError) handleSupabaseError(insertError, 'clock in');

      const { data: updatedEmployee, error: updateError } = await supabase
        .from('employees')
        .update({ status: 'IN' })
        .eq('id', employeeId)
        .select()
        .single();

      if (updateError) handleSupabaseError(updateError, 'update employee status');
      return { record: newRecord, employee: updatedEmployee };
    } catch (error) {
      if (isQuotaOrNetworkError(error)) {
        console.warn('Supabase clockIn failed, automatically using local storage:', error.message || error);
        useLocalFallback = true;
        return this.clockIn(employeeId, location);
      }
      handleSupabaseError(error, 'clock in');
    }
  },

  async clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image) {
    await this.autoCompleteOldAttendance(employeeId).catch(() => {});
    const now = new Date();
    const today = getLocalDateString(now);
    const finalNotes = (performanceNotes && String(performanceNotes).trim()) || 'Shift Completed';
    const finalReceived = Number(receivedAmount) || 0;
    const finalExpense = Number(expenseAmount) || 0;

    if (useLocalFallback) {
      const data = loadLocalData();
      const employee = data.employees.find(e => e.id === employeeId);
      if (!employee) throw new Error('Employee not found');

      // 1. Check for active unclosed record for this employee
      let record = (data.attendance || []).slice().reverse().find(r => r.employeeId === employeeId && !r.clockOutTime);

      if (!record) {
        // 2. Fall back to latest record today to update
        record = (data.attendance || []).slice().reverse().find(r => r.employeeId === employeeId && r.date === today);
      }

      if (record) {
        const inTime = new Date(record.clockInTime || now);
        const duration = Math.max(0, Math.round((now - inTime) / (1000 * 60)));
        Object.assign(record, {
          clockOutTime: now.toISOString(),
          clockOutLocation: location || record.clockOutLocation || null,
          duration,
          performanceNotes: finalNotes || record.performanceNotes || 'Shift Completed',
          receivedAmount: finalReceived,
          expenseAmount: finalExpense,
          moneySpent: finalExpense,
          image: image || record.image || null
        });
      } else {
        record = {
          id: generateId('att'),
          employeeId: employee.id,
          employeeName: employee.name,
          role: employee.role,
          date: today,
          clockInTime: now.toISOString(),
          clockOutTime: now.toISOString(),
          clockInLocation: location || null,
          clockOutLocation: location || null,
          duration: 0,
          performanceNotes: finalNotes,
          receivedAmount: finalReceived,
          expenseAmount: finalExpense,
          moneySpent: finalExpense,
          image: image || null
        };
        data.attendance.push(record);
      }

      employee.status = 'OUT';

      const monthStr = today.substring(0, 7);
      const existingWr = (data.workRecords || []).find(w => w.employeeId === employeeId && w.date === today);
      if (existingWr) {
        existingWr.performedWork = finalNotes;
        existingWr.receivedAmount = finalReceived;
        existingWr.expenseAmount = finalExpense;
        existingWr.paymentIssuance = finalReceived;
      } else {
        (data.workRecords = data.workRecords || []).push({
          id: generateId('wr'),
          employeeId,
          employeeName: employee.name,
          month: monthStr,
          date: today,
          performedWork: finalNotes,
          receivedAmount: finalReceived,
          expenseAmount: finalExpense,
          paymentIssuance: finalReceived,
          createdAt: now.toISOString()
        });
      }

      saveLocalData(data);
      return { record, employee };
    }
    try {
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (empError || !employee) throw new Error('Employee not found');

      // 1. Check for active unclosed record for this employee
      const { data: activeRecords } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .is('clockOutTime', null)
        .order('clockInTime', { ascending: false })
        .limit(1);

      let targetRecord = (activeRecords && activeRecords.length > 0) ? activeRecords[0] : null;

      if (!targetRecord) {
        // 2. Fall back to latest record today
        const { data: todayRecords } = await supabase
          .from('attendance')
          .select('*')
          .eq('employeeId', employeeId)
          .eq('date', today)
          .order('clockInTime', { ascending: false })
          .limit(1);
        if (todayRecords && todayRecords.length > 0) {
          targetRecord = todayRecords[0];
        }
      }

      let updatedRecord = null;
      if (targetRecord) {
        const inTime = new Date(targetRecord.clockInTime || now);
        const duration = Math.max(0, Math.round((now - inTime) / (1000 * 60)));
        const updatePayload = {
          clockOutTime: now.toISOString(),
          clockOutLocation: location || targetRecord.clockOutLocation || null,
          duration,
          performanceNotes: finalNotes || targetRecord.performanceNotes || 'Shift Completed',
          receivedAmount: finalReceived,
          expenseAmount: finalExpense,
          moneySpent: finalExpense,
          image: image || targetRecord.image || null
        };

        const { data: upd, error: updateError } = await supabase
          .from('attendance')
          .update(updatePayload)
          .eq('id', targetRecord.id)
          .select()
          .single();

        if (updateError) handleSupabaseError(updateError, 'update attendance record on clock out');
        updatedRecord = upd;
      } else {
        const newAttRecord = {
          id: generateId('att'),
          employeeId: employee.id,
          employeeName: employee.name,
          role: employee.role,
          date: today,
          clockInTime: now.toISOString(),
          clockOutTime: now.toISOString(),
          clockInLocation: location || null,
          clockOutLocation: location || null,
          duration: 0,
          performanceNotes: finalNotes,
          receivedAmount: finalReceived,
          expenseAmount: finalExpense,
          moneySpent: finalExpense,
          image: image || null
        };

        const { data: ins, error: insertError } = await supabase
          .from('attendance')
          .insert([newAttRecord])
          .select()
          .single();

        if (insertError) handleSupabaseError(insertError, 'insert attendance record on clock out');
        updatedRecord = ins;
      }

      const { data: updatedEmployee, error: empUpdateError } = await supabase
        .from('employees')
        .update({ status: 'OUT' })
        .eq('id', employeeId)
        .select()
        .single();

      if (empUpdateError) handleSupabaseError(empUpdateError, 'update employee status');

      // Auto-sync work record in background
      const monthStr = today.substring(0, 7);
      (async () => {
        try {
          const { data: wrs } = await supabase
            .from('work_records')
            .select('*')
            .eq('employeeId', employeeId)
            .eq('date', today);

          if (wrs && wrs.length > 0) {
            await supabase
              .from('work_records')
              .update({
                performedWork: finalNotes,
                receivedAmount: finalReceived,
                expenseAmount: finalExpense,
                paymentIssuance: finalReceived
              })
              .eq('id', wrs[0].id);
          } else {
            await supabase.from('work_records').insert([{
              id: generateId('wr'),
              employeeId,
              employeeName: employee.name,
              month: monthStr,
              date: today,
              performedWork: finalNotes,
              receivedAmount: finalReceived,
              expenseAmount: finalExpense,
              paymentIssuance: finalReceived,
              createdAt: now.toISOString()
            }]);
          }
        } catch (e) {
          console.warn('[ClockOut] Auto work-record sync:', e.message);
        }
      })();

      return { record: updatedRecord, employee: updatedEmployee || employee };
    } catch (error) {
      if (isQuotaOrNetworkError(error)) {
        console.warn('Supabase clockOut failed, automatically using local storage:', error.message || error);
        useLocalFallback = true;
        return this.clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image);
      }
      handleSupabaseError(error, 'clock out');
    }
  },

  async resolveUnclockedOutAttendance(attendanceId, clockOutTime, performanceNotes, expenseAmount) {
    const nowIso = clockOutTime ? new Date(clockOutTime).toISOString() : new Date().toISOString();
    if (useLocalFallback) {
      const data = loadLocalData();
      const record = (data.attendance || []).find(r => r.id === attendanceId);
      if (!record) throw new Error('Attendance record not found');
      
      const inTime = new Date(record.clockInTime);
      const outTime = new Date(nowIso);
      const duration = Math.max(0, Math.round((outTime - inTime) / (1000 * 60)));

      record.clockOutTime = nowIso;
      record.duration = duration;
      if (performanceNotes) record.performanceNotes = performanceNotes;
      if (expenseAmount !== undefined) record.expenseAmount = Number(expenseAmount) || 0;

      const employee = data.employees.find(e => e.id === record.employeeId);
      if (employee) employee.status = 'OUT';

      saveLocalData(data);
      return record;
    }
    try {
      const { data: record, error: fetchErr } = await supabase
        .from('attendance')
        .select('*')
        .eq('id', attendanceId)
        .single();
      
      if (fetchErr || !record) throw new Error('Attendance record not found');

      const inTime = new Date(record.clockInTime);
      const outTime = new Date(nowIso);
      const duration = Math.max(0, Math.round((outTime - inTime) / (1000 * 60)));

      const { data: updated, error } = await supabase
        .from('attendance')
        .update({
          clockOutTime: nowIso,
          duration,
          performanceNotes: performanceNotes || record.performanceNotes || 'Resolved by admin',
          expenseAmount: expenseAmount !== undefined ? Number(expenseAmount) : (record.expenseAmount || 0)
        })
        .eq('id', attendanceId)
        .select()
        .single();

      if (error) handleSupabaseError(error, 'resolve attendance record');

      await supabase.from('employees').update({ status: 'OUT' }).eq('id', record.employeeId);
      return updated;
    } catch (error) {
      handleSupabaseError(error, 'resolve attendance record');
    }
  },

  async autoCompleteOldAttendance(targetEmployeeId = null) {
    // Truly 24-hour auto clock-out: only close records where 24 hours have actually elapsed from clockInTime
    const now = new Date();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    try {
      if (useLocalFallback) {
        const data = loadLocalData();
        let changed = false;
        const empIdsToUpdate = new Set();
        (data.attendance || []).forEach(r => {
          if (!r.clockOutTime && (!targetEmployeeId || r.employeeId === targetEmployeeId)) {
            const inTime = new Date(r.clockInTime || (r.date + 'T09:00:00'));
            const inTimeMs = inTime.getTime();
            if (!isNaN(inTimeMs) && (now.getTime() - inTimeMs) >= twentyFourHoursMs) {
              const autoOut = new Date(inTimeMs + twentyFourHoursMs);
              r.clockOutTime = autoOut.toISOString();
              r.duration = 24 * 60;
              r.autoClockOut = true;
              r.autoClockOutNote = 'Auto clock-out by system — 24 hours elapsed without manual clock-out';
              empIdsToUpdate.add(r.employeeId);
              changed = true;
            }
          }
        });
        if (changed) {
          empIdsToUpdate.forEach(empId => {
            const hasActive = (data.attendance || []).some(a => a.employeeId === empId && !a.clockOutTime);
            if (!hasActive) {
              const emp = (data.employees || []).find(e => e.id === empId);
              if (emp) emp.status = 'OUT';
            }
          });
          saveLocalData(data);
        }
        return;
      }

      // Supabase: find unclosed records efficiently (selecting only essential columns)
      let query = supabase
        .from('attendance')
        .select('id, employeeId, clockInTime, date')
        .is('clockOutTime', null);
      if (targetEmployeeId) {
        query = query.eq('employeeId', targetEmployeeId);
      }

      const { data: unclosed, error } = await query;
      if (error || !unclosed || unclosed.length === 0) return;

      const stale = unclosed.filter(r => {
        const inTime = new Date(r.clockInTime || (r.date + 'T09:00:00'));
        const inTimeMs = inTime.getTime();
        return !isNaN(inTimeMs) && (now.getTime() - inTimeMs) >= twentyFourHoursMs;
      });

      if (stale.length === 0) return;

      const empIdsToUpdate = new Set();
      for (const r of stale) {
        const inTime = new Date(r.clockInTime || (r.date + 'T09:00:00'));
        const autoOut = new Date(inTime.getTime() + twentyFourHoursMs);
        empIdsToUpdate.add(r.employeeId);
        await supabase.from('attendance').update({
          clockOutTime: autoOut.toISOString(),
          duration: 24 * 60,
          autoClockOut: true,
          autoClockOutNote: 'Auto clock-out by system — 24 hours elapsed without manual clock-out'
        }).eq('id', r.id);
      }

      if (empIdsToUpdate.size > 0) {
        for (const empId of empIdsToUpdate) {
          const { data: stillActive } = await supabase
            .from('attendance')
            .select('id')
            .eq('employeeId', empId)
            .is('clockOutTime', null)
            .limit(1);
          if (!stillActive || stillActive.length === 0) {
            await supabase.from('employees').update({ status: 'OUT' }).eq('id', empId);
          }
        }
      }
      console.log(`[Auto Clock-Out] Completed ${stale.length} records that exceeded 24 hours`);
    } catch (err) {
      console.warn('[Auto Clock-Out] Error:', err.message);
    }
  },

  async getDashboardStats() {
    const today = getLocalDateString();
    const activeEmployees = await this.getEmployees(false);
    const activeEmpIds = new Set(activeEmployees.map(e => e.id));

    let attendanceLogs = [];
    let officeName = 'My Office';

    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));

    if (useLocalFallback) {
      const data = loadLocalData();
      attendanceLogs = (data.attendance || []).filter(a => a.date === today && activeEmpIds.has(a.employeeId) && !isLeave(a));
      officeName = data.settings?.officeName || 'My Office';
    } else {
      try {
        const { data: attendance } = await supabase.from('attendance').select('id, employeeId, clockInTime, clockOutTime, performanceNotes').eq('date', today);
        if (attendance) {
          attendanceLogs = attendance.filter(a => activeEmpIds.has(a.employeeId) && !isLeave(a));
        }
        const { data: settings } = await supabase.from('settings').select('officeName').single();
        if (settings && settings.officeName) officeName = settings.officeName;
      } catch (error) {
        console.warn('Error fetching Supabase dashboard stats details:', error.message);
      }
    }

    const totalEmployees = activeEmployees.length;
    // Currently Clocked In = today's records with clockInTime and no clockOutTime
    const currentlyClockedIn = attendanceLogs.filter(r => r.clockInTime && !r.clockOutTime).length;
    // Present Today = distinct employeeIds with a clock-in today
    const presentToday = new Set(attendanceLogs.map(r => r.employeeId)).size;
    // Clocked Out Today = today's records with a clockOutTime
    const clockedOutToday = attendanceLogs.filter(r => r.clockOutTime).length;
    const absentToday = Math.max(0, totalEmployees - presentToday);

    return {
      totalEmployees,
      activePresent: currentlyClockedIn,
      currentlyClockedIn,
      presentToday,
      clockedOutToday,
      absentToday,
      officeName
    };
  },

  // --- Work Records ---
  async getWorkRecords(employeeId = null, month = null) {
    if (useLocalFallback) {
      const data = loadLocalData();
      let records = data.workRecords || [];
      if (employeeId) records = records.filter(r => r.employeeId === employeeId);
      if (month) records = records.filter(r => r.month === month);
      
      // Compute running balances
      const recordsByEmployee = {};
      records.forEach(r => {
        if (!recordsByEmployee[r.employeeId]) recordsByEmployee[r.employeeId] = [];
        recordsByEmployee[r.employeeId].push(r);
      });

      const processedRecords = [];
      for (const empId in recordsByEmployee) {
        let runningBalance = 0;
        recordsByEmployee[empId].forEach(r => {
          const received = Number(r.receivedAmount ?? r.paymentIssuance ?? 0);
          const expense = Number(r.expenseAmount || 0);
          r.carriedOverBalance = runningBalance;
          r.remainingBalance = runningBalance + received - expense;
          runningBalance = r.remainingBalance;
          processedRecords.push(r);
        });
      }
      return processedRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    try {
      let query = supabase.from('work_records').select('*').order('date', { ascending: true });
      if (employeeId) query = query.eq('employeeId', employeeId);
      if (month) query = query.eq('month', month);

      const { data: records } = await query;
      const recordsByEmployee = {};
      (records || []).forEach(r => {
        if (!recordsByEmployee[r.employeeId]) recordsByEmployee[r.employeeId] = [];
        recordsByEmployee[r.employeeId].push(r);
      });

      const processedRecords = [];
      for (const empId in recordsByEmployee) {
        let runningBalance = 0;
        recordsByEmployee[empId].forEach(r => {
          const received = Number(r.receivedAmount ?? r.paymentIssuance ?? 0);
          const expense = Number(r.expenseAmount || 0);
          r.carriedOverBalance = runningBalance;
          r.remainingBalance = runningBalance + received - expense;
          runningBalance = r.remainingBalance;
          processedRecords.push(r);
        });
      }
      return processedRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (error) {
      handleSupabaseError(error, 'fetch work records');
    }
  },

  async getWorkProfile(employeeId, month) {
    if (useLocalFallback) {
      const data = loadLocalData();
      return data.workProfiles?.[`${employeeId}:${month}`] || { fatherName: '' };
    }
    try {
      const { data } = await supabase
        .from('work_profiles')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('month', month)
        .single();
      return data || { fatherName: '' };
    } catch (error) {
      return { fatherName: '' };
    }
  },

  async saveWorkProfile(employeeId, month, fatherName) {
    if (useLocalFallback) {
      const data = loadLocalData();
      if (!data.workProfiles) data.workProfiles = {};
      data.workProfiles[`${employeeId}:${month}`] = { fatherName };
      saveLocalData(data);
      return { employeeId, month, fatherName };
    }
    try {
      const { data: existing } = await supabase
        .from('work_profiles')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('month', month)
        .single();

      if (!existing) {
        const { data } = await supabase
          .from('work_profiles')
          .insert([{ employeeId, month, fatherName }])
          .select()
          .single();
        return data;
      }

      const { data } = await supabase
        .from('work_profiles')
        .update({ fatherName })
        .eq('employeeId', employeeId)
        .eq('month', month)
        .select()
        .single();
      return data;
    } catch (error) {
      handleSupabaseError(error, 'save work profile');
    }
  },

  async addWorkRecord(record) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const newRecord = { ...record, id: generateId('wr'), createdAt: new Date().toISOString() };
      data.workRecords = data.workRecords || [];
      data.workRecords.push(newRecord);
      saveLocalData(data);
      return newRecord;
    }
    try {
      const newRecord = {
        ...record,
        id: generateId('wr'),
        createdAt: new Date().toISOString()
      };
      const { data } = await supabase
        .from('work_records')
        .insert([newRecord])
        .select()
        .single();
      return data;
    } catch (error) {
      handleSupabaseError(error, 'add work record');
    }
  },

  async updateWorkRecord(id, employeeId, updates) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const record = data.workRecords.find(r => r.id === id && r.employeeId === employeeId);
      if (!record) throw new Error('Record not found');
      Object.assign(record, updates);
      saveLocalData(data);
      return record;
    }
    try {
      const { data } = await supabase
        .from('work_records')
        .update(updates)
        .eq('id', id)
        .eq('employeeId', employeeId)
        .select()
        .single();
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update work record');
    }
  },

  async deleteWorkRecord(id, employeeId) {
    if (useLocalFallback) {
      const data = loadLocalData();
      data.workRecords = data.workRecords.filter(r => !(r.id === id && r.employeeId === employeeId));
      saveLocalData(data);
      return true;
    }
    try {
      const { error } = await supabase
        .from('work_records')
        .delete()
        .eq('id', id)
        .eq('employeeId', employeeId);
      if (error) handleSupabaseError(error, 'delete work record');
      return true;
    } catch (error) {
      handleSupabaseError(error, 'delete work record');
    }
  },

  // --- Form Submissions ---
  async getFormSubmissions(employeeId = null, formType = null) {
    if (useLocalFallback) {
      const data = loadLocalData();
      let records = data.formSubmissions || [];
      if (employeeId) records = records.filter(r => r.employeeId === employeeId);
      if (formType) records = records.filter(r => r.formType === formType);
      else records = records.filter(r => r.formType !== 'manual_present_days' && r.formType !== 'manual_sunday_bonus');
      return records.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    }
    try {
      let query = supabase.from('form_submissions').select('*').order('submittedAt', { ascending: false });
      if (employeeId) query = query.eq('employeeId', employeeId);
      if (formType) query = query.eq('formType', formType);
      else query = query.neq('formType', 'manual_present_days').neq('formType', 'manual_sunday_bonus');

      const { data, error } = await query;
      if (error) {
        const msg = String(error?.message || '');
        if (msg.includes("Could not find the table") || msg.includes('does not exist')) {
          console.warn('Supabase schema missing: form_submissions table not found. Returning empty list.');
          return [];
        }
        handleSupabaseError(error, 'fetch form submissions');
      }
      return data || [];
    } catch (error) {
      handleSupabaseError(error, 'fetch form submissions');
    }
  },

  async getFormSubmission(id) {
    if (useLocalFallback) {
      const data = loadLocalData();
      return data.formSubmissions.find(r => r.id === id) || null;
    }
    try {
      const { data } = await supabase
        .from('form_submissions')
        .select('*')
        .eq('id', id)
        .single();
      return data || null;
    } catch (error) {
      return null;
    }
  },

  async saveFormSubmission(employeeId, employeeName, formType, formData) {
    if (useLocalFallback) {
      const data = loadLocalData();
      if (formType !== 'Leave') {
        const exists = data.formSubmissions.some(r => r.employeeId === employeeId && r.formType === formType);
        if (exists) throw new Error(`Document of type ${formType} already submitted.`);
      }

      const submission = {
        id: generateId('form'),
        employeeId,
        employeeName,
        formType,
        formData,
        submittedAt: new Date().toISOString()
      };

      data.formSubmissions = data.formSubmissions || [];
      data.formSubmissions.push(submission);

      // Create attendance record for leave
      if (formType === 'Leave' && formData?.leaveDate) {
        const leaveDate = String(formData.leaveDate);
        const leaveType = String(formData.leaveType || 'Leave');
        const leaveReason = String(formData.reason || 'Leave');
        const leaveNotes = String(formData.notes || '').trim();
        const leaveText = `LEAVE: ${leaveType} - ${leaveReason}${leaveNotes ? ` | ${leaveNotes}` : ''}`;

        const emp = data.employees.find(e => e.id === employeeId);
        const employeeRole = emp ? (emp.role || 'Staff') : 'Staff';

        const existing = data.attendance.find(r => r.employeeId === employeeId && r.date === leaveDate);
        const leavePayload = {
          id: existing?.id || generateId('att'),
          employeeId,
          employeeName,
          role: employeeRole,
          date: leaveDate,
          clockInTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockOutTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockInLocation: null,
          clockOutLocation: null,
          duration: 0,
          performanceNotes: leaveText,
          receivedAmount: 0,
          expenseAmount: 0,
          moneySpent: 0,
          image: null
        };

        if (existing) Object.assign(existing, leavePayload);
        else data.attendance.push(leavePayload);
      }

      saveLocalData(data);
      return submission;
    }
    try {
      if (formType !== 'Leave') {
        const { data: existing } = await supabase
          .from('form_submissions')
          .select('id')
          .eq('employeeId', employeeId)
          .eq('formType', formType)
          .limit(1);

        if (existing && existing.length > 0) {
          throw new Error(`Document of type ${formType} already submitted.`);
        }
      }

      const newSubmission = {
        id: generateId('form'),
        employeeId,
        employeeName,
        formType,
        formData,
        submittedAt: new Date().toISOString()
      };

      const { data } = await supabase
        .from('form_submissions')
        .insert([newSubmission])
        .select()
        .single();

      // Create attendance record for leave
      if (formType === 'Leave' && formData?.leaveDate) {
        const leaveDate = String(formData.leaveDate);
        const leaveType = String(formData.leaveType || 'Leave');
        const leaveReason = String(formData.reason || 'Leave');
        const leaveNotes = String(formData.notes || '').trim();
        const leaveText = `LEAVE: ${leaveType} - ${leaveReason}${leaveNotes ? ` | ${leaveNotes}` : ''}`;

        // Get employee role
        const { data: employeeData, error: empError } = await supabase
          .from('employees')
          .select('role')
          .eq('id', employeeId)
          .single();

        const employeeRole = empError || !employeeData ? 'Staff' : (employeeData.role || 'Staff');

        // Look up existing attendance record for this date
        const { data: existingRecords, error: lookupError } = await supabase
          .from('attendance')
          .select('*')
          .eq('employeeId', employeeId)
          .eq('date', leaveDate);

        if (lookupError) handleSupabaseError(lookupError, 'lookup leave attendance');

        const existingLeaveRecord = (existingRecords || []).find(r => 
          Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'))
        ) || (existingRecords || [])[0];

        const leavePayload = {
          id: existingLeaveRecord?.id || generateId('att'),
          employeeId,
          employeeName,
          role: employeeRole,
          date: leaveDate,
          clockInTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockOutTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockInLocation: null,
          clockOutLocation: null,
          duration: 0,
          performanceNotes: leaveText,
          receivedAmount: 0,
          expenseAmount: 0,
          moneySpent: 0,
          image: null
        };

        if (existingLeaveRecord) {
          const { error: updateError } = await supabase
            .from('attendance')
            .update(leavePayload)
            .eq('id', existingLeaveRecord.id);
          if (updateError) handleSupabaseError(updateError, 'save leave attendance');
        } else {
          const { error: insertError } = await supabase
            .from('attendance')
            .insert([leavePayload]);
          if (insertError) handleSupabaseError(insertError, 'save leave attendance');
        }
      }

      return data;
    } catch (error) {
      handleSupabaseError(error, 'save form submission');
    }
  },

  async approveLeaveApplication(formId) {
    const submission = await this.getFormSubmission(formId);
    if (!submission) throw new Error('Form submission not found.');

    const formData = submission.formData || {};
    formData.status = 'APPROVED';
    formData.approvedAt = new Date().toISOString();

    const employeeId = submission.employeeId;
    const employeeName = submission.employeeName;
    const leaveDate = formData.leaveDate;
    const leaveType = formData.leaveType || 'Leave';
    const leaveReason = formData.reason || 'Approved Application';
    const leaveNotes = formData.notes || '';
    const leaveText = `LEAVE: ${leaveType} - ${leaveReason}${leaveNotes ? ` | ${leaveNotes}` : ''}`;

    if (useLocalFallback) {
      const data = loadLocalData();
      const sub = (data.formSubmissions || []).find(r => r.id === formId);
      if (sub) { sub.formData = formData; }

      if (leaveDate) {
        const emp = (data.employees || []).find(e => e.id === employeeId);
        const role = emp ? (emp.role || 'Staff') : 'Staff';
        const existing = (data.attendance || []).find(r => r.employeeId === employeeId && r.date === leaveDate);
        const leavePayload = {
          id: existing?.id || generateId('att'),
          employeeId,
          employeeName,
          role,
          date: leaveDate,
          clockInTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockOutTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockInLocation: null,
          clockOutLocation: null,
          duration: 0,
          performanceNotes: leaveText,
          receivedAmount: 0,
          expenseAmount: 0,
          moneySpent: 0,
          image: null
        };
        if (existing) Object.assign(existing, leavePayload);
        else data.attendance.push(leavePayload);
      }
      saveLocalData(data);
      return sub || submission;
    } else {
      await supabase.from('form_submissions').update({ formData }).eq('id', formId);

      if (leaveDate) {
        const { data: empData } = await supabase.from('employees').select('role').eq('id', employeeId).maybeSingle();
        const role = empData?.role || 'Staff';

        const { data: existingAtt } = await supabase
          .from('attendance')
          .select('id')
          .eq('employeeId', employeeId)
          .eq('date', leaveDate)
          .maybeSingle();

        const attPayload = {
          id: existingAtt?.id || generateId('att'),
          employeeId,
          employeeName,
          role,
          date: leaveDate,
          clockInTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockOutTime: new Date(`${leaveDate}T00:00:00.000Z`).toISOString(),
          clockInLocation: null,
          clockOutLocation: null,
          duration: 0,
          performanceNotes: leaveText,
          receivedAmount: 0,
          expenseAmount: 0,
          moneySpent: 0,
          image: null
        };

        if (existingAtt) {
          await supabase.from('attendance').update(attPayload).eq('id', existingAtt.id);
        } else {
          await supabase.from('attendance').insert([attPayload]);
        }
      }
      return { ...submission, formData };
    }
  },

  async rejectLeaveApplication(formId) {
    const submission = await this.getFormSubmission(formId);
    if (!submission) throw new Error('Form submission not found.');

    const formData = submission.formData || {};
    formData.status = 'REJECTED';
    formData.rejectedAt = new Date().toISOString();

    const employeeId = submission.employeeId;
    const leaveDate = formData.leaveDate;

    if (useLocalFallback) {
      const data = loadLocalData();
      const sub = (data.formSubmissions || []).find(r => r.id === formId);
      if (sub) { sub.formData = formData; }
      if (leaveDate) {
        data.attendance = (data.attendance || []).filter(r => !(r.employeeId === employeeId && r.date === leaveDate && String(r.performanceNotes || '').startsWith('LEAVE')));
      }
      saveLocalData(data);
      return sub || submission;
    } else {
      await supabase.from('form_submissions').update({ formData }).eq('id', formId);
      if (leaveDate) {
        await supabase.from('attendance').delete().eq('employeeId', employeeId).eq('date', leaveDate).like('performanceNotes', 'LEAVE%');
      }
      return { ...submission, formData };
    }
  },

  async updateFormSubmission(id, employeeId, updates) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const submission = data.formSubmissions.find(r => r.id === id && r.employeeId === employeeId);
      if (!submission) throw new Error('Record not found');
      Object.assign(submission, updates);
      saveLocalData(data);
      return submission;
    }
    try {
      const { data } = await supabase
        .from('form_submissions')
        .update(updates)
        .eq('id', id)
        .eq('employeeId', employeeId)
        .select()
        .single();
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update form submission');
    }
  },

  async deleteFormSubmission(id, employeeId) {
    if (useLocalFallback) {
      const data = loadLocalData();
      data.formSubmissions = data.formSubmissions.filter(r => !(r.id === id && r.employeeId === employeeId));
      saveLocalData(data);
      return true;
    }
    try {
      const { error } = await supabase
        .from('form_submissions')
        .delete()
        .eq('id', id)
        .eq('employeeId', employeeId);
      if (error) handleSupabaseError(error, 'delete form submission');
      return true;
    } catch (error) {
      handleSupabaseError(error, 'delete form submission');
    }
  },

  // --- Manual Present Days Override Methods ---
  async getManualPresentDays(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const resultMap = {};

    // 1. First load from local storage cache
    const localData = loadLocalData();
    const subs = localData.formSubmissions || [];
    subs.forEach(s => {
      if (s && s.formType === 'manual_present_days' && s.formData && s.formData.month === month) {
        resultMap[s.employeeId] = {
          id: s.id,
          employeeId: s.employeeId,
          employeeName: s.employeeName,
          month: s.formData.month,
          originalAutoPresentDays: Number(s.formData.originalAutoPresentDays) || 0,
          manualPresentDays: Number(s.formData.manualPresentDays) || 0,
          editedBy: s.formData.editedBy || 'Admin',
          editedAt: s.formData.editedAt || s.submittedAt
        };
      }
    });

    if (useLocalFallback || !supabase) {
      return resultMap;
    }

    try {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*')
        .eq('formType', 'manual_present_days');

      if (error) {
        console.warn('Supabase getManualPresentDays notice:', error.message);
        return resultMap;
      }

      (data || []).forEach(s => {
        if (s && s.formData && s.formData.month === month) {
          resultMap[s.employeeId] = {
            id: s.id,
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            month: s.formData.month,
            originalAutoPresentDays: Number(s.formData.originalAutoPresentDays) || 0,
            manualPresentDays: Number(s.formData.manualPresentDays) || 0,
            editedBy: s.formData.editedBy || 'Admin',
            editedAt: s.formData.editedAt || s.submittedAt
          };
        }
      });

      return resultMap;
    } catch (err) {
      console.warn('getManualPresentDays exception:', err.message);
      return resultMap;
    }
  },

  async setManualPresentDays(employeeId, month, manualPresentDays, editedBy = 'Admin') {
    if (!employeeId) throw new Error('Employee ID is required');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('Valid month (YYYY-MM) is required');

    const numDays = parseInt(manualPresentDays, 10);
    if (isNaN(numDays) || numDays < 0 || numDays > 31) {
      throw new Error('Present days must be a number between 0 and 31');
    }

    const employees = await this.getEmployees(true);
    const emp = (employees || []).find(e => e.id === employeeId);
    if (!emp) throw new Error(`Employee ${employeeId} not found`);

    // Compute original auto present days from attendance
    const allAttendance = await this.getAttendance();
    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));
    const empAtt = (allAttendance || []).filter(a => a.employeeId === employeeId && a.date && a.date.startsWith(month) && !isLeave(a));
    const presentDates = new Set();
    empAtt.forEach(a => presentDates.add(a.date));
    const originalAutoPresentDays = presentDates.size;

    const recordId = `mpd_${employeeId}_${month}`;
    const nowIso = new Date().toISOString();

    const record = {
      id: recordId,
      employeeId,
      employeeName: emp.name,
      formType: 'manual_present_days',
      formData: {
        month,
        originalAutoPresentDays,
        manualPresentDays: numDays,
        editedBy: String(editedBy || 'Admin').trim(),
        editedAt: nowIso
      },
      submittedAt: nowIso
    };

    // Save to local cache
    const data = loadLocalData();
    if (!data.formSubmissions) data.formSubmissions = [];
    const localIdx = data.formSubmissions.findIndex(s => s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_present_days' && s.formData?.month === month));
    if (localIdx >= 0) {
      data.formSubmissions[localIdx] = record;
    } else {
      data.formSubmissions.push(record);
    }
    saveLocalData(data);

    // Save to Supabase if active
    if (!useLocalFallback && supabase) {
      try {
        const { error } = await supabase
          .from('form_submissions')
          .upsert(record);
        if (error) {
          console.warn('Supabase setManualPresentDays upsert notice:', error.message);
        }
      } catch (err) {
        console.warn('Supabase setManualPresentDays exception:', err.message);
      }
    }

    // Trigger salary recalculation
    await this.generateSalary(employeeId, month);

    return {
      success: true,
      employeeId,
      employeeName: emp.name,
      month,
      manualPresentDays: numDays,
      originalAutoPresentDays,
      editedBy: record.formData.editedBy,
      editedAt: nowIso
    };
  },

  async resetManualPresentDays(employeeId, month) {
    if (!employeeId) throw new Error('Employee ID is required');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('Valid month (YYYY-MM) is required');

    const recordId = `mpd_${employeeId}_${month}`;

    // Remove from local cache
    const data = loadLocalData();
    if (data.formSubmissions) {
      data.formSubmissions = data.formSubmissions.filter(s => !(s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_present_days' && s.formData?.month === month)));
      saveLocalData(data);
    }

    // Remove from Supabase
    if (!useLocalFallback && supabase) {
      try {
        await supabase
          .from('form_submissions')
          .delete()
          .eq('id', recordId);
      } catch (err) {
        console.warn('Supabase resetManualPresentDays delete notice:', err.message);
      }
    }

    // Re-generate salary to revert back to auto attendance
    await this.generateSalary(employeeId, month);

    return {
      success: true,
      employeeId,
      month
    };
  },

  // --- Manual Sunday Bonus Override Methods ---
  async getManualSundayBonuses(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const resultMap = {};

    // 1. First load from local storage cache
    const localData = loadLocalData();
    const subs = localData.formSubmissions || [];
    subs.forEach(s => {
      if (s && s.formType === 'manual_sunday_bonus' && s.formData && s.formData.month === month) {
        resultMap[s.employeeId] = {
          id: s.id,
          employeeId: s.employeeId,
          employeeName: s.employeeName,
          month: s.formData.month,
          originalAutoSundayBonus: Number(s.formData.originalAutoSundayBonus) || 0,
          manualSundayBonus: Number(s.formData.manualSundayBonus) || 0,
          editedBy: s.formData.editedBy || 'Admin',
          editedAt: s.formData.editedAt || s.submittedAt
        };
      }
    });

    if (useLocalFallback || !supabase) {
      return resultMap;
    }

    try {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*')
        .eq('formType', 'manual_sunday_bonus');

      if (error) {
        console.warn('Supabase getManualSundayBonuses notice:', error.message);
        return resultMap;
      }

      (data || []).forEach(s => {
        if (s && s.formData && s.formData.month === month) {
          resultMap[s.employeeId] = {
            id: s.id,
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            month: s.formData.month,
            originalAutoSundayBonus: Number(s.formData.originalAutoSundayBonus) || 0,
            manualSundayBonus: Number(s.formData.manualSundayBonus) || 0,
            editedBy: s.formData.editedBy || 'Admin',
            editedAt: s.formData.editedAt || s.submittedAt
          };
        }
      });

      return resultMap;
    } catch (err) {
      console.warn('getManualSundayBonuses exception:', err.message);
      return resultMap;
    }
  },

  async setManualSundayBonus(employeeId, month, manualSundayBonus, editedBy = 'Admin') {
    if (!employeeId) throw new Error('Employee ID is required');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('Valid month (YYYY-MM) is required');

    const numBonus = parseInt(manualSundayBonus, 10);
    if (isNaN(numBonus) || numBonus < 0) {
      throw new Error('Sunday bonus must be a non-negative number');
    }

    const employees = await this.getEmployees(true);
    const emp = (employees || []).find(e => e.id === employeeId);
    if (!emp) throw new Error(`Employee ${employeeId} not found`);

    // Compute original auto Sunday bonus from attendance
    const allAttendance = await this.getAttendance();
    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));
    const empAtt = (allAttendance || []).filter(a => a.employeeId === employeeId && a.date && a.date.startsWith(month) && !isLeave(a));
    const presentDates = new Set();
    empAtt.forEach(a => presentDates.add(a.date));

    let sundayDays = 0;
    presentDates.forEach(dateStr => {
      const parts = dateStr.split('-');
      const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      if (dt.getDay() === 0) sundayDays++;
    });

    const basicSalary = Number(emp.baseSalary) || Number(emp.basicSalary) || 0;
    const perDay = basicSalary > 0 ? Math.round((basicSalary / 30) * 100) / 100 : 0;
    const originalAutoSundayBonus = Math.round(perDay * sundayDays * 100) / 100;

    const recordId = `msb_${employeeId}_${month}`;
    const nowIso = new Date().toISOString();

    const record = {
      id: recordId,
      employeeId,
      employeeName: emp.name,
      formType: 'manual_sunday_bonus',
      formData: {
        month,
        originalAutoSundayBonus,
        manualSundayBonus: numBonus,
        editedBy: String(editedBy || 'Admin').trim(),
        editedAt: nowIso
      },
      submittedAt: nowIso
    };

    // Save to local cache
    const data = loadLocalData();
    if (!data.formSubmissions) data.formSubmissions = [];
    const localIdx = data.formSubmissions.findIndex(s => s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_sunday_bonus' && s.formData?.month === month));
    if (localIdx >= 0) {
      data.formSubmissions[localIdx] = record;
    } else {
      data.formSubmissions.push(record);
    }
    saveLocalData(data);

    // Save to Supabase if active
    if (!useLocalFallback && supabase) {
      try {
        const { error } = await supabase
          .from('form_submissions')
          .upsert(record);
        if (error) {
          console.warn('Supabase setManualSundayBonus upsert notice:', error.message);
        }
      } catch (err) {
        console.warn('Supabase setManualSundayBonus exception:', err.message);
      }
    }

    // Trigger salary recalculation
    await this.generateSalary(employeeId, month);

    return {
      success: true,
      employeeId,
      employeeName: emp.name,
      month,
      manualSundayBonus: numBonus,
      originalAutoSundayBonus,
      editedBy: record.formData.editedBy,
      editedAt: nowIso
    };
  },

  async resetManualSundayBonus(employeeId, month) {
    if (!employeeId) throw new Error('Employee ID is required');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('Valid month (YYYY-MM) is required');

    const recordId = `msb_${employeeId}_${month}`;

    // Remove from local cache
    const data = loadLocalData();
    if (data.formSubmissions) {
      data.formSubmissions = data.formSubmissions.filter(s => !(s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_sunday_bonus' && s.formData?.month === month)));
      saveLocalData(data);
    }

    // Remove from Supabase
    if (!useLocalFallback && supabase) {
      try {
        await supabase
          .from('form_submissions')
          .delete()
          .eq('id', recordId);
      } catch (err) {
        console.warn('Supabase resetManualSundayBonus delete notice:', err.message);
      }
    }

    // Re-generate salary to revert back to auto Sunday bonus
    await this.generateSalary(employeeId, month);

    return {
      success: true,
      employeeId,
      month
    };
  },

  async getMonthlySummary(monthStr = null, startDate = null, endDate = null) {
    let filterStart = startDate;
    let filterEnd = endDate;

    if (!filterStart || !filterEnd) {
      if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
        const now = new Date();
        monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }
      const [yearStr, mStr] = monthStr.split('-');
      const year = parseInt(yearStr, 10);
      const monthNum = parseInt(mStr, 10);
      const totalDaysInMonth = new Date(year, monthNum, 0).getDate();

      filterStart = `${monthStr}-01`;
      filterEnd = `${monthStr}-${String(totalDaysInMonth).padStart(2, '0')}`;
    }

    const startDt = new Date(filterStart + 'T00:00:00');
    const endDt = new Date(filterEnd + 'T23:59:59');
    
    let daysEvaluated = 0;
    let sundaysInEvaluatedPeriod = 0;

    if (!isNaN(startDt.getTime()) && !isNaN(endDt.getTime())) {
      const cur = new Date(startDt);
      while (cur <= endDt) {
        daysEvaluated++;
        if (cur.getDay() === 0) sundaysInEvaluatedPeriod++;
        cur.setDate(cur.getDate() + 1);
      }
    }
    if (daysEvaluated === 0) daysEvaluated = 1;
    const workingDaysToEvaluate = Math.max(0, daysEvaluated - sundaysInEvaluatedPeriod);

    const allEmployees = await this.getEmployees(true);
    const allAttendance = await this.getAttendance();
    
    const periodLogs = (allAttendance || []).filter(a => {
      if (!a || !a.date) return false;
      return a.date >= filterStart && a.date <= filterEnd;
    });

    let workRecords = [];
    try {
      const yearMonth = filterStart.substring(0, 7);
      workRecords = await this.getWorkRecords(null, yearMonth);
      workRecords = (workRecords || []).filter(w => w && w.date >= filterStart && w.date <= filterEnd);
    } catch (e) {
      workRecords = [];
    }

    const summaryMap = new Map();
    const empNameMap = new Map();

    (allEmployees || []).forEach(emp => {
      if (!emp || !emp.id) return;
      const normName = emp.name ? emp.name.trim().toLowerCase() : '';
      const summaryObj = {
        employeeId: emp.id,
        employeeName: emp.name ? emp.name.trim() : 'Staff Member',
        role: emp.role || 'Staff',
        isArchived: emp.status === 'DELETED' || Boolean(emp.isArchived),
        minusScore: emp.minusScore || 0,
        linkExpireCount: emp.linkExpireCount || 0,
        presentDates: new Set(),
        leaveDates: new Set(),
        incompleteDates: new Set(),
        totalDurationMinutes: 0,
        workDoneDetails: [],
        totalExpensesAdded: 0
      };
      summaryMap.set(emp.id, summaryObj);
      if (normName) empNameMap.set(normName, summaryObj);
    });

    periodLogs.forEach(log => {
      if (!log) return;
      let empSummary = null;
      if (log.employeeId) {
        empSummary = summaryMap.get(log.employeeId);
      } else if (log.employeeName) {
        empSummary = empNameMap.get(log.employeeName.trim().toLowerCase());
      }
      if (!empSummary && log.employeeId) {
        empSummary = {
          employeeId: log.employeeId,
          employeeName: log.employeeName ? log.employeeName.trim() : 'Staff Member',
          role: log.role || 'Staff',
          isArchived: true,
          minusScore: 0,
          linkExpireCount: 0,
          presentDates: new Set(),
          leaveDates: new Set(),
          incompleteDates: new Set(),
          totalDurationMinutes: 0,
          workDoneDetails: [],
          totalExpensesAdded: 0
        };
        summaryMap.set(log.employeeId, empSummary);
        if (log.employeeName) empNameMap.set(log.employeeName.trim().toLowerCase(), empSummary);
      }
      if (!empSummary) return;

      const isLeave = isLeaveAttendanceRecord(log);
      if (isLeave) {
        empSummary.leaveDates.add(log.date);
      } else {
        // Valid clock-in adds to presentDates even if auto-clocked out at end of day
        empSummary.presentDates.add(log.date);
        if (log.autoClockOut || (!log.clockOutTime && log.date < getLocalDateString())) {
          empSummary.incompleteDates.add(log.date);
        }
      }

      if (log.duration && !isNaN(Number(log.duration))) {
        empSummary.totalDurationMinutes += Number(log.duration);
      }

      if (log.expenseAmount && !isNaN(Number(log.expenseAmount))) {
        empSummary.totalExpensesAdded += Number(log.expenseAmount);
      }
      if (log.performanceNotes && !isLeave) {
        empSummary.workDoneDetails.push(log.performanceNotes.trim());
      }
    });

    (workRecords || []).forEach(wr => {
      if (!wr) return;
      let empSummary = null;
      if (wr.employeeId) {
        empSummary = summaryMap.get(wr.employeeId);
      } else if (wr.employeeName) {
        empSummary = empNameMap.get(wr.employeeName.trim().toLowerCase());
      }
      if (empSummary && wr.performedWork && wr.performedWork.trim() !== '') {
        empSummary.workDoneDetails.push(wr.performedWork.trim());
      }
    });

    const summaries = [];
    summaryMap.forEach(emp => {
      let regularPresentCount = 0;
      let sundayPresentCount = 0;
      emp.presentDates.forEach(dateStr => {
        const parts = dateStr.split('-');
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (dt.getDay() === 0) sundayPresentCount++;
        else regularPresentCount++;
      });

      let regularLeaveCount = 0;
      emp.leaveDates.forEach(dateStr => {
        const parts = dateStr.split('-');
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (dt.getDay() !== 0) regularLeaveCount++;
      });

      const totalAttendance = regularPresentCount + sundayPresentCount;
      const leaveDays = regularLeaveCount;
      const incompleteDays = emp.incompleteDates.size;
      const missingAttendance = Math.max(0, workingDaysToEvaluate - regularPresentCount - regularLeaveCount);
      const workDoneCount = emp.workDoneDetails.length;
      const totalHoursWorked = Math.round((emp.totalDurationMinutes / 60) * 10) / 10;

      if (!emp.isArchived || totalAttendance > 0 || workDoneCount > 0 || emp.totalExpensesAdded > 0) {
        summaries.push({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          role: emp.role,
          isArchived: emp.isArchived,
          minusScore: emp.minusScore || 0,
          linkExpireCount: emp.linkExpireCount || 0,
          presentDatesList: Array.from(emp.presentDates || []),
          leaveDatesList: Array.from(emp.leaveDates || []),
          incompleteDatesList: Array.from(emp.incompleteDates || []),
          daysEvaluated,
          sundaysInEvaluatedPeriod,
          workingDaysToEvaluate,
          totalAttendance,
          sundayPresentCount,
          missingAttendance,
          leaveDays,
          incompleteDays,
          totalHoursWorked,
          totalWorkDone: workDoneCount > 0 ? `${workDoneCount} Work Items` : '0 Work Items',
          totalWorkDoneCount: workDoneCount,
          workDoneSummary: emp.workDoneDetails.length > 0 ? emp.workDoneDetails.slice(0, 3).join('; ') : 'None',
          totalExpensesAdded: Math.round(emp.totalExpensesAdded)
        });
      }
    });

    return {
      month: monthStr || filterStart.substring(0, 7),
      startDate: filterStart,
      endDate: filterEnd,
      daysEvaluated,
      sundaysInEvaluatedPeriod,
      workingDaysToEvaluate,
      summaries
    };
  },

  async getIndividualAttendance({ employeeId, employeeName, startDate, endDate, month }) {
    let filterStart = startDate;
    let filterEnd = endDate;

    if (!filterStart || !filterEnd) {
      const monthStr = month || getLocalDateString().substring(0, 7);
      const [y, m] = monthStr.split('-');
      const days = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
      filterStart = `${monthStr}-01`;
      filterEnd = `${monthStr}-${String(days).padStart(2, '0')}`;
    }

    const allAttendance = await this.getAttendance();
    const allEmployees = await this.getEmployees(true);

    let targetEmpIds = new Set();
    if (employeeId) {
      targetEmpIds.add(employeeId);
    } else if (employeeName) {
      const norm = String(employeeName).trim().toLowerCase();
      allEmployees.forEach(e => {
        if (e.name && e.name.trim().toLowerCase() === norm) targetEmpIds.add(e.id);
      });
    }

    const records = (allAttendance || []).filter(a => {
      if (!a.employeeId || !targetEmpIds.has(a.employeeId)) return false;
      if (a.date < filterStart || a.date > filterEnd) return false;
      return true;
    }).sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));

    const presentDates = new Set();
    const leaveDates = new Set();
    const incompleteDates = new Set();
    let totalMinutes = 0;
    let totalExpenses = 0;

    records.forEach(r => {
      const isLeave = isLeaveAttendanceRecord(r);
      if (isLeave) leaveDates.add(r.date);
      else {
        presentDates.add(r.date);
        if (!r.clockOutTime && r.date < getLocalDateString()) incompleteDates.add(r.date);
      }
      if (r.duration) totalMinutes += Number(r.duration);
      if (r.expenseAmount) totalExpenses += Number(r.expenseAmount);
    });

    const startDt = new Date(filterStart + 'T00:00:00');
    const endDt = new Date(filterEnd + 'T23:59:59');
    let daysEvaluated = 0;
    let sundays = 0;
    if (!isNaN(startDt.getTime()) && !isNaN(endDt.getTime())) {
      const cur = new Date(startDt);
      while (cur <= endDt) {
        daysEvaluated++;
        if (cur.getDay() === 0) sundays++;
        cur.setDate(cur.getDate() + 1);
      }
    }

    const workingDays = Math.max(0, daysEvaluated - sundays);
    const absentDays = Math.max(0, workingDays - presentDates.size - leaveDates.size);

    return {
      employeeName: employeeName || (records[0] ? records[0].employeeName : 'Employee'),
      startDate: filterStart,
      endDate: filterEnd,
      daysEvaluated,
      workingDays,
      presentDays: presentDates.size,
      leaveDays: leaveDates.size,
      incompleteDays: incompleteDates.size,
      absentDays,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      totalExpenses,
      records
    };
  },

  // --- Comments / Messaging Methods ---
  async getComments(employeeId = null) {
    if (useLocalFallback) {
      const data = loadLocalData();
      let list = data.comments || [];
      if (employeeId) list = list.filter(c => c.employeeId === employeeId);
      return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    try {
      let query = supabase.from('comments').select('*').order('createdAt', { ascending: true });
      if (employeeId) query = query.eq('employeeId', employeeId);
      const { data, error } = await query;
      let list = (data && !error) ? [...data] : [];
      // Also merge any locally saved fallback comments
      const localData = loadLocalData();
      let localList = localData.comments || [];
      if (employeeId) localList = localList.filter(c => c.employeeId === employeeId);
      const existingIds = new Set(list.map(c => c.id));
      localList.forEach(c => {
        if (!existingIds.has(c.id)) list.push(c);
      });
      return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } catch (error) {
      console.warn('getComments error:', error.message);
      const dataLocal = loadLocalData();
      let list = dataLocal.comments || [];
      if (employeeId) list = list.filter(c => c.employeeId === employeeId);
      return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
  },

  async addComment({ employeeId, employeeName, sender, senderName, message }) {
    const senderNorm = (sender || 'employee').toLowerCase();
    const newComment = {
      id: generateId('comm'),
      employeeId,
      employeeName: employeeName || 'Employee',
      sender: senderNorm,
      senderName: senderName || (senderNorm === 'admin' ? 'Admin' : (employeeName || 'Employee')),
      message: message.trim(),
      createdAt: new Date().toISOString(),
      isRead: senderNorm === 'admin' ? false : true
    };

    if (useLocalFallback) {
      const data = loadLocalData();
      if (!data.comments) data.comments = [];
      data.comments.push(newComment);
      saveLocalData(data);
      return newComment;
    }
    try {
      const { data, error } = await supabase
        .from('comments')
        .insert([newComment])
        .select()
        .single();
      if (error) {
        if (error.message && error.message.includes('isRead')) {
          const commentNoRead = { ...newComment };
          delete commentNoRead.isRead;
          const { data: retryData, error: retryErr } = await supabase
            .from('comments')
            .insert([commentNoRead])
            .select()
            .single();
          if (!retryErr) {
            return retryData || newComment;
          }
        }
        console.warn('Supabase insert comment failed, using local fallback:', error.message);
        const localData = loadLocalData();
        if (!localData.comments) localData.comments = [];
        localData.comments.push(newComment);
        saveLocalData(localData);
        return newComment;
      }
      return data || newComment;
    } catch (error) {
      const localData = loadLocalData();
      if (!localData.comments) localData.comments = [];
      localData.comments.push(newComment);
      saveLocalData(localData);
      return newComment;
    }
  },

  async deleteComment(id) {
    if (useLocalFallback) {
      const data = loadLocalData();
      if (data.comments) {
        data.comments = data.comments.filter(c => c.id !== id);
        saveLocalData(data);
      }
      return true;
    }
    try {
      const { error } = await supabase.from('comments').delete().eq('id', id);
      if (error) {
        const data = loadLocalData();
        if (data.comments) {
          data.comments = data.comments.filter(c => c.id !== id);
          saveLocalData(data);
        }
      }
      return true;
    } catch (error) {
      const data = loadLocalData();
      if (data.comments) {
        data.comments = data.comments.filter(c => c.id !== id);
        saveLocalData(data);
      }
      return true;
    }
  },

  async getUnreadAdminMessages(employeeId) {
    try {
      if (useLocalFallback) {
        const data = loadLocalData();
        const list = (data.comments || []).filter(c =>
          c.employeeId === employeeId && c.sender === 'admin' && c.isRead === false
        );
        return { count: list.length, messages: list };
      }
      const { data, error } = await supabase
        .from('comments')
        .select('id,message,createdAt')
        .eq('employeeId', employeeId)
        .eq('sender', 'admin')
        .eq('isRead', false);
      if (error) return { count: 0, messages: [] };
      return { count: (data || []).length, messages: data || [] };
    } catch {
      return { count: 0, messages: [] };
    }
  },

  async markMessagesRead(employeeId) {
    try {
      if (useLocalFallback) {
        const data = loadLocalData();
        (data.comments || []).forEach(c => {
          if (c.employeeId === employeeId && c.sender === 'admin') c.isRead = true;
        });
        saveLocalData(data);
        return;
      }
      await supabase.from('comments')
        .update({ isRead: true })
        .eq('employeeId', employeeId)
        .eq('sender', 'admin')
        .eq('isRead', false);
    } catch (err) {
      console.warn('markMessagesRead error:', err.message);
    }
  },

  // ─── Salary Methods ─────────────────────────────────────────────────────────

  async getAllSalaries(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return await this.generateAllSalaries(month);
  },

  async getSalaryRecord(employeeId, month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return await this.generateSalary(employeeId, month);
  },

  async setSalaryBasic(employeeId, month, basicSalary) {
    const numSalary = Number(basicSalary) || 0;
    const data = loadLocalData();
    if (!data.salaries) data.salaries = [];
    let rec = data.salaries.find(s => s.employeeId === employeeId && s.month === month);
    if (!rec) {
      const employees = await this.getEmployees(true);
      const emp = (employees || []).find(e => e.id === employeeId);
      rec = {
        id: generateId('sal'),
        employeeId,
        employeeName: emp ? emp.name : '',
        role: emp ? (emp.role || 'Staff') : 'Staff',
        month,
        basicSalary: 0,
        generatedAt: null
      };
      data.salaries.push(rec);
    }
    rec.basicSalary = numSalary;
    if (data.employees) {
      const localEmp = data.employees.find(e => e.id === employeeId);
      if (localEmp) localEmp.baseSalary = numSalary;
    }
    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('employees').update({ baseSalary: numSalary }).eq('id', employeeId);
      } catch (err) {
        console.warn('Supabase employee baseSalary update notice:', err.message);
      }
    }

    // Immediately trigger full calculation and return updated salary object
    return await this.generateSalary(employeeId, month);
  },

  async generateSalary(employeeId, month, cachedAttendance = null, cachedEmployees = null, cachedWorkRecords = null) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [yearStr, mStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(mStr, 10);
    const totalDaysInMonth = new Date(year, monthNum, 0).getDate();

    const data = loadLocalData();
    if (!data.salaries) data.salaries = [];

    let salRec = data.salaries.find(s => s.employeeId === employeeId && s.month === month);
    const employees = cachedEmployees || await this.getEmployees(true);
    const emp = (employees || []).find(e => e.id === employeeId);

    if (!salRec) {
      salRec = {
        id: generateId('sal'),
        employeeId,
        employeeName: emp ? emp.name : employeeId,
        role: emp ? (emp.role || 'Staff') : 'Staff',
        month,
        basicSalary: 0,
        generatedAt: null
      };
      data.salaries.push(salRec);
    }

    // Helper: is this a leave record?
    const isLeave = (record) => Boolean(record && String(record.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));
    const empNameNorm = emp && emp.name ? emp.name.trim().toLowerCase() : '';

    // Fetch all attendance logs from active DB (Supabase or local fallback)
    const allAttendance = cachedAttendance || await this.getAttendance();
    const attendanceLogs = (allAttendance || []).filter(a => {
      if (!a || !a.date || !a.date.startsWith(month) || isLeave(a)) return false;
      if (a.employeeId) return a.employeeId === employeeId;
      return empNameNorm && a.employeeName && a.employeeName.trim().toLowerCase() === empNameNorm;
    });

    const presentDates = new Set();
    attendanceLogs.forEach(a => presentDates.add(a.date));

    // Separate regular days, Sunday days worked, and 14 August worked
    let regularPresentDays = 0;
    let sundayPresentDays = 0;
    let worked14Aug = false;
    presentDates.forEach(dateStr => {
      const parts = dateStr.split('-');
      const yearStr = parts[0];
      const monthStr = parts[1];
      const dayStr = parts[2];
      const dt = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10));
      
      // Check 14 August
      if (monthStr === '08' && dayStr === '14') {
        worked14Aug = true;
      }
      
      if (dt.getDay() === 0) sundayPresentDays++;
      else regularPresentDays++;
    });

    const autoTotalDays = regularPresentDays + sundayPresentDays;

    // Check for manual present days override
    let manualOverrides = {};
    try {
      manualOverrides = await this.getManualPresentDays(month);
    } catch (e) {}

    // Check for manual Sunday bonus override
    let manualSundayOverrides = {};
    try {
      manualSundayOverrides = await this.getManualSundayBonuses(month);
    } catch (e) {}

    const override = manualOverrides[employeeId];
    const isManual = Boolean(override && typeof override.manualPresentDays === 'number');
    const effectivePresentDays = isManual ? override.manualPresentDays : autoTotalDays;

    let effectiveSundayDays = sundayPresentDays;
    let effectiveRegularDays = regularPresentDays;
    if (isManual) {
      effectiveSundayDays = Math.min(sundayPresentDays, effectivePresentDays);
      effectiveRegularDays = Math.max(0, effectivePresentDays - effectiveSundayDays);
    }

    // Sum total expenses from clock-out records & work records for this month
    let totalExpenses = 0;
    const processedDates = new Set();
    attendanceLogs.forEach(a => {
      const exp = Number(a.expenseAmount) || Number(a.moneySpent) || 0;
      if (exp > 0) {
        totalExpenses += exp;
        processedDates.add(a.date);
      }
    });

    let workRecords = cachedWorkRecords;
    if (!workRecords) {
      try {
        workRecords = await this.getWorkRecords(null, month);
      } catch (e) {
        workRecords = [];
      }
    }
    (workRecords || []).forEach(wr => {
      if (!wr || !wr.date || !wr.date.startsWith(month)) return;
      const matched = wr.employeeId ? wr.employeeId === employeeId : (empNameNorm && wr.employeeName && wr.employeeName.trim().toLowerCase() === empNameNorm);
      if (matched && !processedDates.has(wr.date)) {
        const exp = Number(wr.expenseAmount) || 0;
        if (exp > 0) totalExpenses += exp;
      }
    });

    const basicSalary = salRec.basicSalary || (emp ? (Number(emp.baseSalary) || Number(emp.basicSalary) || 0) : 0);

    // REQUIRED PAYROLL FORMULA:
    // PerDaySalary = MonthlySalary / 30
    const perDaySalary = basicSalary > 0 ? Math.round((basicSalary / 30) * 100) / 100 : 0;

    // Salary Calculation Rules:
    // If presentDays >= 26: Regular salary = Basic Salary (full monthly salary) + Extra Day Bonus for days > 26
    // If presentDays < 26: Regular salary = PerDaySalary × PresentDays
    let regularEarned = 0;
    let extraDaysBonus = 0;
    if (effectivePresentDays >= 26) {
      regularEarned = basicSalary;
      const extraDays = effectivePresentDays - 26;
      if (extraDays > 0) {
        extraDaysBonus = Math.round(extraDays * perDaySalary * 100) / 100;
      }
    } else {
      regularEarned = Math.round(effectivePresentDays * perDaySalary * 100) / 100;
    }

    // Sunday Bonus: PerDaySalary × SundayWorked
    const sunOverride = manualSundayOverrides[employeeId];
    const isManualSunday = Boolean(sunOverride && typeof sunOverride.manualSundayBonus === 'number');
    const autoSundayBonus = Math.round(effectiveSundayDays * perDaySalary * 100) / 100;
    const sundayBonus = isManualSunday ? sunOverride.manualSundayBonus : autoSundayBonus;

    // 14 August Independence Day Bonus: 1 day salary if worked on 14th Aug
    const aug14Bonus = (month.endsWith('-08') && worked14Aug) ? perDaySalary : 0;

    // GrossEarnedSalary = RegularSalary + ExtraDaysBonus + SundayBonus + 14AugBonus
    const earnedSalary = Math.round((regularEarned + extraDaysBonus + sundayBonus + aug14Bonus) * 100) / 100;

    // NetSalary = GrossEarnedSalary - Expenses
    const netSalary = Math.round((earnedSalary - totalExpenses) * 100) / 100;

    Object.assign(salRec, {
      employeeName: emp ? emp.name : salRec.employeeName,
      role: emp ? (emp.role || 'Staff') : salRec.role,
      totalDaysInMonth,
      workingDays: 30,           // fixed 30-day divisor
      regularPresentDays: effectiveRegularDays,
      sundayPresentDays: effectiveSundayDays,
      worked14Aug,
      aug14Bonus,
      extraDaysBonus,
      presentDays: effectivePresentDays,
      autoPresentDays: autoTotalDays,
      isManualPresentDays: isManual,
      manualPresentDays: isManual ? override.manualPresentDays : null,
      editedBy: isManual ? override.editedBy : null,
      editedAt: isManual ? override.editedAt : null,
      isManualSundayBonus: isManualSunday,
      manualSundayBonus: isManualSunday ? sunOverride.manualSundayBonus : null,
      autoSundayBonus,
      sundayBonusEditedBy: isManualSunday ? sunOverride.editedBy : null,
      sundayBonusEditedAt: isManualSunday ? sunOverride.editedAt : null,
      perDaySalary,
      regularEarned,
      sundayBonus,
      earnedSalary,
      totalExpenses: Math.round(totalExpenses),
      netSalary,
      generatedAt: new Date().toISOString()
    });

    saveLocalData(data);
    return salRec;
  },

  async generateAllSalaries(month) {
    const [employees, allAttendance, workRecords] = await Promise.all([
      this.getEmployees(false),
      this.getAttendance().catch(() => []),
      this.getWorkRecords(null, month).catch(() => [])
    ]);

    if (!employees || employees.length === 0) return [];

    const results = [];
    for (const emp of employees) {
      const rec = await this.generateSalary(emp.id, month, allAttendance, employees, workRecords);
      results.push(rec);
    }
    return results;
  },

  // ─── Accounts PDF Verification Methods ──────────────────────────────────────

  async getAppExpensesMap(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));
    
    const [allAttendance, allWorkRecords, employees, allBills] = await Promise.all([
      this.getAttendance(month).catch(() => []),
      this.getWorkRecords(null, month).catch(() => []),
      this.getEmployees(true).catch(() => []),
      this.getBills({ employeeId: null }).catch(() => [])
    ]);

    const attendanceLogs = (allAttendance || []).filter(a =>
      a.date && a.date.startsWith(month) && !isLeave(a)
    );

    const map = {};

    (employees || []).forEach(emp => {
      map[emp.id] = { totalExpense: 0, entries: [] };
    });

    attendanceLogs.forEach(a => {
      const empId = a.employeeId;
      if (!map[empId]) map[empId] = { totalExpense: 0, entries: [] };
      const exp = Number(a.expenseAmount) || Number(a.moneySpent) || 0;
      if (exp > 0) {
        map[empId].totalExpense += exp;
        map[empId].entries.push({
          date: a.date,
          amount: exp,
          description: a.performanceNotes || 'Clock-Out Expense',
          category: 'Daily Shift Expense',
          source: 'Attendance Clock-Out'
        });
      }
    });

    (allWorkRecords || []).forEach(wr => {
      const empId = wr.employeeId;
      if (!empId) return;
      if (!map[empId]) map[empId] = { totalExpense: 0, entries: [] };
      const exp = Number(wr.expenseAmount) || 0;
      if (exp > 0) {
        const alreadyAdded = map[empId].entries.some(e => e.date === wr.date && e.amount === exp);
        if (!alreadyAdded) {
          map[empId].totalExpense += exp;
          map[empId].entries.push({
            date: wr.date,
            amount: exp,
            description: wr.performedWork || 'Work Record Expense',
            category: 'Work Record',
            source: 'Work Record'
          });
        }
      }
    });

    // Include submitted & approved employee bills (including materials, transport, supplies, etc.)
    (allBills || []).forEach(bill => {
      const empId = bill.employeeId;
      if (!empId) return;
      const bDate = bill.billDate || bill.date || (bill.createdAt ? bill.createdAt.split('T')[0] : '');
      if (!bDate || !bDate.startsWith(month)) return;
      if (bill.status === 'REJECTED') return;

      const exp = Number(bill.totalClaimedAmount) || Number(bill.totalAmount) || (
        (Number(bill.transportationExpense) || 0) +
        (Number(bill.materialExpense) || 0) +
        (Number(bill.labourExpense) || 0) +
        (Number(bill.accommodationExpense) || 0) +
        (Number(bill.otherExpense) || 0)
      );

      if (exp > 0) {
        if (!map[empId]) map[empId] = { totalExpense: 0, entries: [] };
        const key = `bill_${bill.id}`;
        const alreadyAdded = map[empId].entries.some(e => e.billId === bill.id || e.key === key);
        if (!alreadyAdded) {
          map[empId].totalExpense += exp;
          let cat = 'Bill Expense';
          if (bill.materialExpense > 0 || (bill.categories && bill.categories.material && bill.categories.material.claimedAmount > 0)) {
            cat = 'Materials & Supplies';
          } else if (bill.transportationExpense > 0) {
            cat = 'Transportation';
          } else if (bill.category) {
            cat = bill.category;
          }
          map[empId].entries.push({
            key,
            id: bill.id,
            billId: bill.id,
            isBill: true,
            billNumber: bill.billNumber || 'Bill',
            date: bDate,
            amount: exp,
            category: cat,
            description: bill.description || bill.notes || `Bill #${bill.billNumber || bill.id}`,
            status: bill.status || 'SUBMITTED',
            attachments: bill.attachments || [],
            source: 'Employee Bill'
          });
        }
      }
    });

    Object.values(map).forEach(empData => {
      if (Array.isArray(empData.entries)) {
        empData.entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      }
    });

    return map;
  },

  async getAccountsPdfData(month, pdfId = null) {
    if (!month) return null;
    let found = null;
    if (!useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('accounts_pdfs').select('pdfData, pdfs').eq('salaryMonth', month).maybeSingle();
        if (data) found = data;
      } catch (e) {}
    }
    if (!found) {
      const data = loadLocalData();
      found = (data.accountsPdfs || []).find(p => p.salaryMonth === month);
    }
    if (!found) return null;
    if (pdfId && Array.isArray(found.pdfs)) {
      const f = found.pdfs.find(p => p.id === pdfId);
      if (f && f.pdfData) return f.pdfData;
    }
    return found.pdfData || null;
  },

  async getAccountsPdf(month, forceReverify = false) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    let found = null;
    if (!useLocalFallback && supabase) {
      try {
        const { data, error } = await supabase
          .from('accounts_pdfs')
          .select('id, salaryMonth, fileName, fileSize, uploadedAt, uploadedBy, processingStatus, extractedData, extractedEntries, manualMappings, auditLog, summary, verificationResults, unmatchedPdfEntries, pdfs')
          .eq('salaryMonth', month)
          .maybeSingle();
        if (data && !error) {
          found = data;
        }
      } catch (err) {
        console.warn('Supabase getAccountsPdf fetch notice:', err.message);
      }
    }

    if (!found) {
      const data = loadLocalData();
      const list = data.accountsPdfs || [];
      found = list.find(p => p.salaryMonth === month);
    }

    if (!found) return null;

    // Reject/filter any documentation or sample PDF filenames
    if (found.fileName && /Accounts_Department|User_Manual|User Manual|Documentation|Sample|Demo|Default|Initial|Mock/i.test(found.fileName)) {
      return null;
    }

    if (found.verificationResults && !forceReverify) {
      return sanitizeAccountsPdfForClient(found);
    }

    // Refresh live verification using current application expenses, roster, and exact date matching
    const res = await this.reverifyAccountsPdf(month, found);
    return sanitizeAccountsPdfForClient(res);
  },

  async saveAccountsPdf(month, fileName, pdfInput, uploadedBy = 'Admin', replace = false, pdfId = null) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('Invalid salary month format (expected YYYY-MM)');
    }
    if (!pdfInput) {
      throw new Error('PDF data or extracted text is required');
    }

    const { parseAccountsPdf, matchAndVerifyExpenses, validateSalaryClaimMonth } = require('./pdf-parser-helper');
    const newPdfId = pdfId || generateId('pdf_file');
    let parsed;
    let cleanBase64 = '';
    let fileSize = 0;

    if (pdfInput && typeof pdfInput === 'object' && Array.isArray(pdfInput.pages)) {
      fileSize = pdfInput.fileSize || 1024;
      cleanBase64 = pdfInput.base64 || '';
      try {
        parsed = await parseAccountsPdf(pdfInput, fileName || 'accounts.pdf', newPdfId);
      } catch (err) {
        throw new Error('PDF Parsing failed: ' + err.message);
      }
    } else {
      cleanBase64 = String(pdfInput).replace(/^data:.*?;base64,/, '').replace(/\s+/g, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');
      fileSize = pdfBuffer.length;
      try {
        parsed = await parseAccountsPdf(pdfBuffer, fileName || 'accounts.pdf', newPdfId);
      } catch (err) {
        throw new Error('PDF Parsing failed: ' + err.message);
      }
    }

    // Rule 11: Enforce strict statement month vs salary claim month check
    if (parsed && parsed.bankMetadata) {
      const rawTxt = (pdfInput && typeof pdfInput === 'object' && pdfInput.rawText) ? pdfInput.rawText : '';
      const monthCheck = validateSalaryClaimMonth(parsed.bankMetadata.statementMonth, month, rawTxt);
      if (!monthCheck.valid) {
        throw new Error(monthCheck.error);
      }
    }

    const employees = await this.getEmployees(false);
    const appExpensesMap = await this.getAppExpensesMap(month);
    const salaries = await this.getAllSalaries(month);
    const salariesMap = {};
    (salaries || []).forEach(s => { salariesMap[s.employeeId] = s; });

    let existing = null;
    if (!useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('accounts_pdfs').select('id, salaryMonth, fileName, fileSize, uploadedAt, uploadedBy, processingStatus, extractedData, summary, manualMappings, auditLog, pdfs').eq('salaryMonth', month).maybeSingle();
        if (data) existing = data;
      } catch (e) {}
    }

    const localData = loadLocalData();
    if (!localData.accountsPdfs) localData.accountsPdfs = [];
    const localExisting = localData.accountsPdfs.find(p => p.salaryMonth === month);
    if (!existing) existing = localExisting;

    const nowIso = new Date().toISOString();

    const newFileEntry = {
      id: newPdfId,
      fileName: fileName || 'accounts.pdf',
      fileSize,
      pdfData: cleanBase64,
      uploadedBy,
      uploadedAt: nowIso,
      pageCount: parsed.numPages || 1,
      bankName: parsed.bankName || 'Bank Statement',
      transactionCount: (parsed.extractedEntries || []).length,
      extractedEntries: parsed.extractedEntries || []
    };

    if (!existing) {
      existing = {
        id: generateId('acct_pdf'),
        salaryMonth: month,
        pdfs: [newFileEntry],
        fileName: fileName || 'accounts.pdf',
        fileSize,
        pdfData: cleanBase64,
        uploadedBy,
        uploadedAt: nowIso,
        replacedAt: null,
        replacedBy: null,
        processingStatus: 'PROCESSED',
        processingError: null,
        extractedData: parsed.extractedEntries || [],
        manualMappings: {},
        auditLog: [{
          action: 'UPLOADED',
          by: uploadedBy,
          at: nowIso,
          fileName
        }]
      };
      if (!localExisting) {
        localData.accountsPdfs.push(existing);
      }
    } else {
      if (!existing.pdfs) {
        existing.pdfs = [];
        if (existing.pdfData) {
          existing.pdfs.push({
            id: existing.id || generateId('pdf_file'),
            fileName: existing.fileName || 'accounts.pdf',
            fileSize: existing.fileSize || 0,
            pdfData: existing.pdfData,
            uploadedBy: existing.uploadedBy || uploadedBy,
            uploadedAt: existing.uploadedAt || nowIso,
            pageCount: 1,
            bankName: 'Bank Statement',
            transactionCount: (existing.extractedData || []).length,
            extractedEntries: existing.extractedData || []
          });
        }
      }

      if (replace) {
        if (pdfId) {
          const idx = existing.pdfs.findIndex(p => p.id === pdfId);
          if (idx !== -1) existing.pdfs[idx] = newFileEntry;
          else existing.pdfs.push(newFileEntry);
        } else {
          existing.pdfs = [newFileEntry];
        }
      } else {
        existing.pdfs.push(newFileEntry);
      }

      existing.fileName = fileName;
      existing.fileSize = fileSize;
      if (cleanBase64) existing.pdfData = cleanBase64;
      existing.replacedAt = replace ? nowIso : existing.replacedAt;
      existing.replacedBy = replace ? uploadedBy : existing.replacedBy;
      existing.processingStatus = 'PROCESSED';
      if (!existing.auditLog) existing.auditLog = [];
      existing.auditLog.push({
        action: replace ? 'REPLACED' : 'ATTACHED_PDF',
        by: uploadedBy,
        at: nowIso,
        fileName
      });
    }

    const allEntries = [];
    existing.pdfs.forEach(pdfFile => {
      if (Array.isArray(pdfFile.extractedEntries)) {
        allEntries.push(...pdfFile.extractedEntries);
      }
    });

    const manualMappings = existing.manualMappings || {};
    const { verificationResults, unmatchedPdfEntries, summary } = matchAndVerifyExpenses(
      allEntries,
      employees,
      appExpensesMap,
      manualMappings,
      month,
      salariesMap
    );

    existing.extractedData = allEntries;
    existing.summary = summary;
    existing.verificationResults = verificationResults;
    existing.unmatchedPdfEntries = unmatchedPdfEntries;

    saveLocalData(localData);

    // Sync to Supabase
    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('accounts_pdfs').upsert({
          id: existing.id,
          salaryMonth: existing.salaryMonth,
          fileName: existing.fileName,
          fileSize: existing.fileSize,
          pdfData: existing.pdfData,
          pdfs: existing.pdfs,
          uploadedBy: existing.uploadedBy,
          uploadedAt: existing.uploadedAt,
          replacedAt: existing.replacedAt,
          replacedBy: existing.replacedBy,
          processingStatus: existing.processingStatus,
          extractedData: existing.extractedData,
          summary: existing.summary,
          manualMappings: existing.manualMappings,
          auditLog: existing.auditLog
        });
      } catch (err) {
        console.warn('Supabase accounts_pdfs upsert notice:', err.message);
      }
    }

    return sanitizeAccountsPdfForClient(existing);
  },

  async deleteAccountsPdfFile(month, pdfId, deletedBy = 'Admin') {
    if (!month || !pdfId) {
      throw new Error('month and pdfId required');
    }

    const localData = loadLocalData();
    if (!localData.accountsPdfs) localData.accountsPdfs = [];
    let existing = localData.accountsPdfs.find(p => p.salaryMonth === month);

    if (!existing) {
      if (!useLocalFallback && supabase) {
        try {
          const { data } = await supabase.from('accounts_pdfs').select('*').eq('salaryMonth', month).maybeSingle();
          if (data) existing = data;
        } catch (e) {}
      }
    }

    if (!existing || !existing.pdfs) return { success: true };

    existing.pdfs = existing.pdfs.filter(p => p.id !== pdfId);

    const nowIso = new Date().toISOString();
    if (!existing.auditLog) existing.auditLog = [];
    existing.auditLog.push({
      action: 'DELETED_PDF_FILE',
      pdfId,
      by: deletedBy,
      at: nowIso
    });

    if (existing.pdfs.length === 0) {
      existing.extractedData = [];
      existing.summary = {};
      existing.verificationResults = [];
    } else {
      const employees = await this.getEmployees(false);
      const appExpensesMap = await this.getAppExpensesMap(month);
      const salaries = await this.getAllSalaries(month);
      const salariesMap = {};
      (salaries || []).forEach(s => { salariesMap[s.employeeId] = s; });

      const { matchAndVerifyExpenses } = require('./pdf-parser-helper');
      const allEntries = [];
      existing.pdfs.forEach(pdfFile => {
        if (Array.isArray(pdfFile.extractedEntries)) {
          allEntries.push(...pdfFile.extractedEntries);
        }
      });

      const { verificationResults, unmatchedPdfEntries, summary } = matchAndVerifyExpenses(
        allEntries,
        employees,
        appExpensesMap,
        existing.manualMappings || {},
        month,
        salariesMap
      );

      existing.extractedData = allEntries;
      existing.summary = summary;
      existing.verificationResults = verificationResults;
    }

    saveLocalData(localData);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('accounts_pdfs').upsert({
          id: existing.id,
          salaryMonth: existing.salaryMonth,
          pdfs: existing.pdfs,
          extractedData: existing.extractedData,
          summary: existing.summary,
          verificationResults: existing.verificationResults,
          auditLog: existing.auditLog
        });
      } catch (e) {}
    }

    return existing;
  },

  async reverifyAccountsPdf(month, existingRecord = null) {
    let pdfRecord = existingRecord;

    if (!pdfRecord && !useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('accounts_pdfs').select('*').eq('salaryMonth', month).maybeSingle();
        if (data) pdfRecord = data;
      } catch (e) {}
    }

    if (!pdfRecord) {
      const data = loadLocalData();
      pdfRecord = (data.accountsPdfs || []).find(p => p.salaryMonth === month);
    }

    if (!pdfRecord) return null;

    const { parseAccountsPdf, matchAndVerifyExpenses } = require('./pdf-parser-helper');

    // If pdfData is stored, re-parse with the latest multi-line statement extractor
    if (pdfRecord.pdfData) {
      try {
        const cleanBase64 = String(pdfRecord.pdfData).replace(/^data:.*?;base64,/, '').replace(/\s+/g, '');
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        const parsed = await parseAccountsPdf(pdfBuffer);
        if (parsed && parsed.extractedEntries && parsed.extractedEntries.length > 0) {
          pdfRecord.extractedData = parsed.extractedEntries;
        }
      } catch (err) {
        console.warn('Re-parse pdfData notice:', err.message);
      }
    }

    const employees = await this.getEmployees(false);
    const appExpensesMap = await this.getAppExpensesMap(month);
    const salaries = await this.getAllSalaries(month);
    const salariesMap = {};
    (salaries || []).forEach(s => { salariesMap[s.employeeId] = s; });

    const { verificationResults, unmatchedPdfEntries, summary } = matchAndVerifyExpenses(
      pdfRecord.extractedData || [],
      employees,
      appExpensesMap,
      pdfRecord.manualMappings || {},
      month,
      salariesMap
    );

    // Merge existing salary approvals for this month
    const approvals = await this.getSalaryApprovals(month);
    const approvalsMap = {};
    approvals.forEach(a => { approvalsMap[a.employeeId] = a; });

    verificationResults.forEach(r => {
      const app = approvalsMap[r.employeeId];
      if (app) {
        r.approval = app;
        r.approvalStatus = app.approvalStatus || 'APPROVED';
        r.approvedAmount = app.approvedAmount;
        r.approvedBy = app.approvedBy;
        r.approvedAt = app.approvedAt;
      } else {
        r.approval = null;
        r.approvalStatus = 'NOT_APPROVED';
      }
    });

    pdfRecord.verificationResults = verificationResults;
    pdfRecord.unmatchedPdfEntries = unmatchedPdfEntries;
    pdfRecord.summary = summary;

    const data = loadLocalData();
    const localIdx = (data.accountsPdfs || []).findIndex(p => p.salaryMonth === month);
    if (localIdx !== -1) {
      data.accountsPdfs[localIdx] = pdfRecord;
    } else {
      if (!data.accountsPdfs) data.accountsPdfs = [];
      data.accountsPdfs.push(pdfRecord);
    }
    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('accounts_pdfs').update({
          summary: pdfRecord.summary,
          extractedData: pdfRecord.extractedData,
          manualMappings: pdfRecord.manualMappings,
          auditLog: pdfRecord.auditLog
        }).eq('salaryMonth', month);
      } catch (err) {
        console.warn('Supabase accounts_pdfs update notice:', err.message);
      }
    }

    return pdfRecord;
  },

  async mapAccountsPdfEmployee(month, extractedName, targetEmployeeId) {
    let pdfRecord = null;
    if (!useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('accounts_pdfs').select('*').eq('salaryMonth', month).maybeSingle();
        if (data) pdfRecord = data;
      } catch (e) {}
    }

    if (!pdfRecord) {
      const data = loadLocalData();
      pdfRecord = (data.accountsPdfs || []).find(p => p.salaryMonth === month);
    }

    if (!pdfRecord) throw new Error(`No Accounts PDF found for month ${month}`);

    if (!pdfRecord.manualMappings) pdfRecord.manualMappings = {};
    if (targetEmployeeId) {
      pdfRecord.manualMappings[targetEmployeeId] = extractedName;
    } else {
      for (const [k, v] of Object.entries(pdfRecord.manualMappings)) {
        if (v === extractedName) delete pdfRecord.manualMappings[k];
      }
    }

    return await this.reverifyAccountsPdf(month, pdfRecord);
  },

  async deleteAccountsPdf(month, deletedBy = 'Admin') {
    const data = loadLocalData();
    const idx = (data.accountsPdfs || []).findIndex(p => p.salaryMonth === month);
    if (idx !== -1) {
      data.accountsPdfs.splice(idx, 1);
      saveLocalData(data);
    }

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('accounts_pdfs').delete().eq('salaryMonth', month);
      } catch (e) {}
    }
    return true;
  },

  // ─── Salary Approval & Verification Methods ─────────────────────────────────

  async approveSalary({ employeeId, employeeName, salaryMonth, bankTotal, applicationTotal, difference, approvedAmount, notes, verificationRecordId, adminUser = 'Admin' }) {
    if (!employeeId || !salaryMonth) {
      throw new Error('employeeId and salaryMonth are required');
    }
    const amt = parseFloat(approvedAmount);
    if (isNaN(amt) || amt < 0) {
      throw new Error('Valid approvedAmount is required');
    }

    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    if (!data.salaryApprovals) data.salaryApprovals = [];

    let existing = data.salaryApprovals.find(a => a.employeeId === employeeId && a.salaryMonth === salaryMonth);
    const auditEntry = {
      action: existing ? 'UPDATED' : 'APPROVED',
      oldAmount: existing ? existing.approvedAmount : null,
      approvedAmount: amt,
      by: adminUser,
      at: nowIso,
      notes: notes || ''
    };

    if (existing) {
      existing.employeeName = employeeName || existing.employeeName;
      existing.bankTotal = Number(bankTotal) !== undefined ? Number(bankTotal) : existing.bankTotal;
      existing.applicationTotal = Number(applicationTotal) !== undefined ? Number(applicationTotal) : existing.applicationTotal;
      existing.difference = Number(difference) !== undefined ? Number(difference) : existing.difference;
      existing.approvedAmount = amt;
      existing.approvalStatus = 'APPROVED';
      existing.approvedBy = adminUser;
      existing.approvedAt = nowIso;
      existing.notes = notes || existing.notes;
      existing.verificationRecordId = verificationRecordId || existing.verificationRecordId;
      existing.updatedAt = nowIso;
      if (!existing.auditLog) existing.auditLog = [];
      existing.auditLog.push(auditEntry);
    } else {
      existing = {
        id: generateId('appr'),
        employeeId,
        employeeName: employeeName || '',
        salaryMonth,
        bankTotal: Number(bankTotal) || 0,
        applicationTotal: Number(applicationTotal) || 0,
        difference: Number(difference) || 0,
        approvedAmount: amt,
        approvalStatus: 'APPROVED',
        approvedBy: adminUser,
        approvedAt: nowIso,
        verificationRecordId: verificationRecordId || null,
        notes: notes || '',
        auditLog: [auditEntry],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      data.salaryApprovals.push(existing);
    }

    saveLocalData(data);

    // Sync to Supabase
    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('salary_approvals').upsert({
          id: existing.id,
          employeeId: existing.employeeId,
          employeeName: existing.employeeName,
          salaryMonth: existing.salaryMonth,
          bankTotal: existing.bankTotal,
          applicationTotal: existing.applicationTotal,
          difference: existing.difference,
          approvedAmount: existing.approvedAmount,
          approvalStatus: existing.approvalStatus,
          approvedBy: existing.approvedBy,
          approvedAt: existing.approvedAt,
          verificationRecordId: existing.verificationRecordId,
          notes: existing.notes,
          auditLog: existing.auditLog,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt
        });
      } catch (err) {
        console.warn('Supabase salary_approvals sync notice:', err.message);
      }
    }

    return existing;
  },

  async getSalaryApprovals(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    let list = [];
    if (!useLocalFallback && supabase) {
      try {
        const { data, error } = await supabase.from('salary_approvals').select('*').eq('salaryMonth', month);
        if (data && !error && data.length > 0) {
          list = data;
        }
      } catch (e) {}
    }

    if (list.length === 0) {
      const localData = loadLocalData();
      list = (localData.salaryApprovals || []).filter(a => a.salaryMonth === month);
    }

    return list;
  },

  async getSalaryApproval(employeeId, month) {
    const list = await this.getSalaryApprovals(month);
    return list.find(a => a.employeeId === employeeId) || null;
  },

  async revokeSalaryApproval(employeeId, month, reason = '', adminUser = 'Admin') {
    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    const existing = (data.salaryApprovals || []).find(a => a.employeeId === employeeId && a.salaryMonth === month);
    if (!existing) return true;

    existing.approvalStatus = 'REVOKED';
    existing.updatedAt = nowIso;
    if (!existing.auditLog) existing.auditLog = [];
    existing.auditLog.push({
      action: 'REVOKED',
      by: adminUser,
      at: nowIso,
      reason
    });
    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('salary_approvals').update({
          approvalStatus: 'REVOKED',
          auditLog: existing.auditLog,
          updatedAt: nowIso
        }).eq('employeeId', employeeId).eq('salaryMonth', month);
      } catch (e) {}
    }

    return true;
  },

  // ─── Expense Verification & Senior Admin Approval Methods ───────────────────
  async verifyExpense({ employeeId, employeeName, salaryMonth, claimedAmount, verifiedAmount, verifiedBy = 'Admin 1', notes = '' }) {
    if (!employeeId || !salaryMonth) {
      throw new Error('employeeId and salaryMonth are required');
    }
    const vAmt = parseFloat(verifiedAmount);
    if (isNaN(vAmt) || vAmt < 0) {
      throw new Error('Valid verifiedAmount is required');
    }

    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    if (!data.expenseVerifications) data.expenseVerifications = [];

    let existing = data.expenseVerifications.find(v => v.employeeId === employeeId && v.salaryMonth === salaryMonth);
    const auditEntry = {
      action: existing ? 'RE-VERIFIED' : 'VERIFIED',
      oldVerifiedAmount: existing ? existing.verifiedAmount : null,
      verifiedAmount: vAmt,
      by: verifiedBy,
      at: nowIso,
      notes: notes || ''
    };

    if (existing) {
      existing.employeeName = employeeName || existing.employeeName;
      existing.claimedAmount = (claimedAmount !== undefined && claimedAmount !== null) ? Number(claimedAmount) : existing.claimedAmount;
      existing.verifiedAmount = vAmt;
      existing.verifiedBy = verifiedBy;
      existing.verifiedAt = nowIso;
      existing.verificationStatus = 'VERIFIED';
      existing.notes = notes || existing.notes;
      existing.updatedAt = nowIso;
      if (!existing.auditLog) existing.auditLog = [];
      existing.auditLog.push(auditEntry);
    } else {
      existing = {
        id: generateId('expv'),
        employeeId,
        employeeName: employeeName || '',
        salaryMonth,
        claimedAmount: (claimedAmount !== undefined && claimedAmount !== null) ? Number(claimedAmount) : 0,
        verifiedAmount: vAmt,
        verifiedBy,
        verifiedAt: nowIso,
        verificationStatus: 'VERIFIED',
        approvedAmount: null,
        approvedBy: null,
        approvedAt: null,
        approvalStatus: 'PENDING',
        notes: notes || '',
        auditLog: [auditEntry],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      data.expenseVerifications.push(existing);
    }

    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('expense_verifications').upsert({
          id: existing.id,
          employeeId: existing.employeeId,
          employeeName: existing.employeeName,
          salaryMonth: existing.salaryMonth,
          claimedAmount: existing.claimedAmount,
          verifiedAmount: existing.verifiedAmount,
          verifiedBy: existing.verifiedBy,
          verifiedAt: existing.verifiedAt,
          verificationStatus: existing.verificationStatus,
          approvedAmount: existing.approvedAmount,
          approvedBy: existing.approvedBy,
          approvedAt: existing.approvedAt,
          approvalStatus: existing.approvalStatus,
          notes: existing.notes,
          auditLog: existing.auditLog,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt
        });
      } catch (err) {
        console.warn('Supabase expense_verifications sync notice:', err.message);
      }
    }

    // Synchronize submitted employee bills for this month: if verified, verify them with admin comments
    if (vAmt > 0) {
      try {
        const bills = await this.getBills({ employeeId });
        const pendingBills = (bills || []).filter(b => {
          const bDate = b.billDate || b.date || (b.createdAt ? b.createdAt.split('T')[0] : '');
          return bDate && bDate.startsWith(salaryMonth) && (b.status === 'SUBMITTED' || b.status === 'PENDING_VERIFICATION' || b.status === 'PARTIALLY_VERIFIED');
        });
        for (const bill of pendingBills) {
          const billClaimed = Number(bill.totalClaimedAmount) || Number(bill.totalAmount) || 0;
          if (billClaimed > 0) {
            await this.verifyBill(bill.id, {
              verifiedAmount: billClaimed,
              verificationComment: notes || 'Verified with monthly salary sheet',
              verifiedBy
            }).catch(e => console.warn(`Notice verifying bill ${bill.id}:`, e.message));
          }
        }
      } catch (bErr) {
        console.warn('Notice synchronizing bills in verifyExpense:', bErr.message);
      }
    }

    return existing;
  },

  async approveExpense({ employeeId, employeeName, salaryMonth, claimedAmount, approvedAmount, approvedBy = 'Senior Admin', notes = '' }) {
    if (!employeeId || !salaryMonth) {
      throw new Error('employeeId and salaryMonth are required');
    }
    const aAmt = parseFloat(approvedAmount);
    if (isNaN(aAmt) || aAmt < 0) {
      throw new Error('Valid approvedAmount is required');
    }

    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    if (!data.expenseVerifications) data.expenseVerifications = [];

    let existing = data.expenseVerifications.find(v => v.employeeId === employeeId && v.salaryMonth === salaryMonth);

    // Business rule: Approved amount cannot exceed verified amount if verified amount exists
    if (existing && existing.verifiedAmount !== null && existing.verifiedAmount !== undefined) {
      if (aAmt > existing.verifiedAmount) {
        throw new Error(`Approved amount (PKR ${aAmt.toLocaleString()}) cannot exceed verified amount (PKR ${existing.verifiedAmount.toLocaleString()})`);
      }
    }

    const auditEntry = {
      action: existing && existing.approvalStatus === 'APPROVED' ? 'RE-APPROVED' : 'APPROVED',
      oldApprovedAmount: existing ? existing.approvedAmount : null,
      approvedAmount: aAmt,
      by: approvedBy,
      at: nowIso,
      notes: notes || ''
    };

    if (existing) {
      existing.employeeName = employeeName || existing.employeeName;
      existing.claimedAmount = (claimedAmount !== undefined && claimedAmount !== null) ? Number(claimedAmount) : existing.claimedAmount;
      existing.approvedAmount = aAmt;
      existing.approvedBy = approvedBy;
      existing.approvedAt = nowIso;
      existing.approvalStatus = 'APPROVED';
      existing.notes = notes || existing.notes;
      existing.updatedAt = nowIso;
      if (!existing.auditLog) existing.auditLog = [];
      existing.auditLog.push(auditEntry);
    } else {
      existing = {
        id: generateId('expv'),
        employeeId,
        employeeName: employeeName || '',
        salaryMonth,
        claimedAmount: (claimedAmount !== undefined && claimedAmount !== null) ? Number(claimedAmount) : aAmt,
        verifiedAmount: aAmt,
        verifiedBy: `Auto-Verified by ${approvedBy}`,
        verifiedAt: nowIso,
        verificationStatus: 'VERIFIED',
        approvedAmount: aAmt,
        approvedBy,
        approvedAt: nowIso,
        approvalStatus: 'APPROVED',
        notes: notes || '',
        auditLog: [auditEntry],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      data.expenseVerifications.push(existing);
    }

    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('expense_verifications').upsert({
          id: existing.id,
          employeeId: existing.employeeId,
          employeeName: existing.employeeName,
          salaryMonth: existing.salaryMonth,
          claimedAmount: existing.claimedAmount,
          verifiedAmount: existing.verifiedAmount,
          verifiedBy: existing.verifiedBy,
          verifiedAt: existing.verifiedAt,
          verificationStatus: existing.verificationStatus,
          approvedAmount: existing.approvedAmount,
          approvedBy: existing.approvedBy,
          approvedAt: existing.approvedAt,
          approvalStatus: existing.approvalStatus,
          notes: existing.notes,
          auditLog: existing.auditLog,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt
        });
      } catch (err) {
        console.warn('Supabase expense_verifications sync notice:', err.message);
      }
    }

    return existing;
  },

  async rejectExpense({ employeeId, employeeName, salaryMonth, rejectionReason = '', rejectedBy = 'Admin 1', notes = '' }) {
    if (!employeeId || !salaryMonth) {
      throw new Error('employeeId and salaryMonth are required');
    }
    const reasonText = (rejectionReason || notes || 'Expense rejected by Admin').trim();
    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    if (!data.expenseVerifications) data.expenseVerifications = [];

    let existing = data.expenseVerifications.find(v => v.employeeId === employeeId && v.salaryMonth === salaryMonth);
    const auditEntry = {
      action: 'REJECTED',
      verifiedAmount: 0,
      approvedAmount: 0,
      by: rejectedBy,
      at: nowIso,
      rejectionReason: reasonText,
      notes: reasonText
    };

    if (existing) {
      existing.employeeName = employeeName || existing.employeeName;
      existing.verifiedAmount = 0;
      existing.approvedAmount = 0;
      existing.verifiedBy = rejectedBy;
      existing.verifiedAt = nowIso;
      existing.verificationStatus = 'REJECTED';
      existing.approvalStatus = 'REJECTED';
      existing.notes = reasonText;
      existing.updatedAt = nowIso;
      if (!existing.auditLog) existing.auditLog = [];
      existing.auditLog.push(auditEntry);
    } else {
      existing = {
        id: generateId('expv'),
        employeeId,
        employeeName: employeeName || '',
        salaryMonth,
        claimedAmount: 0,
        verifiedAmount: 0,
        verifiedBy: rejectedBy,
        verifiedAt: nowIso,
        verificationStatus: 'REJECTED',
        approvedAmount: 0,
        approvedBy: null,
        approvedAt: null,
        approvalStatus: 'REJECTED',
        notes: reasonText,
        auditLog: [auditEntry],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      data.expenseVerifications.push(existing);
    }

    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('expense_verifications').upsert({
          id: existing.id,
          employeeId: existing.employeeId,
          employeeName: existing.employeeName,
          salaryMonth: existing.salaryMonth,
          claimedAmount: existing.claimedAmount,
          verifiedAmount: existing.verifiedAmount,
          verifiedBy: existing.verifiedBy,
          verifiedAt: existing.verifiedAt,
          verificationStatus: existing.verificationStatus,
          approvedAmount: existing.approvedAmount,
          approvedBy: existing.approvedBy,
          approvedAt: existing.approvedAt,
          approvalStatus: existing.approvalStatus,
          notes: existing.notes,
          auditLog: existing.auditLog,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt
        });
      } catch (err) {
        console.warn('Supabase expense_verifications sync notice:', err.message);
      }
    }

    // Also reject any active bills submitted by this employee for this month
    try {
      const bills = await this.getBills({ employeeId });
      const monthBills = (bills || []).filter(b => {
        const bDate = b.billDate || b.date || (b.createdAt ? b.createdAt.split('T')[0] : '');
        return bDate && bDate.startsWith(salaryMonth) && b.status !== 'REJECTED';
      });
      for (const bill of monthBills) {
        await this.rejectBill(bill.id, {
          rejectionReason: reasonText,
          rejectedBy
        }).catch(e => console.warn(`Notice rejecting bill ${bill.id}:`, e.message));
      }
    } catch (bErr) {
      console.warn('Notice querying bills for expense rejection:', bErr.message);
    }

    return existing;
  },

  async getExpenseVerifications(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    let list = [];
    if (!useLocalFallback && supabase) {
      try {
        const { data, error } = await supabase.from('expense_verifications').select('*').eq('salaryMonth', month);
        if (data && !error && data.length > 0) {
          list = data;
        }
      } catch (e) {}
    }

    if (list.length === 0) {
      const localData = loadLocalData();
      list = (localData.expenseVerifications || []).filter(v => v.salaryMonth === month);
    }

    return list;
  },

  async getExpenseVerification(employeeId, month) {
    const list = await this.getExpenseVerifications(month);
    return list.find(v => v.employeeId === employeeId) || null;
  },

  async revokeExpenseVerification(employeeId, month, reason = '', adminUser = 'Admin') {
    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    const existing = (data.expenseVerifications || []).find(v => v.employeeId === employeeId && v.salaryMonth === month);
    if (!existing) return true;

    existing.verificationStatus = 'REVOKED';
    existing.updatedAt = nowIso;
    if (!existing.auditLog) existing.auditLog = [];
    existing.auditLog.push({
      action: 'VERIFICATION_REVOKED',
      by: adminUser,
      at: nowIso,
      reason
    });
    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('expense_verifications').update({
          verificationStatus: 'REVOKED',
          auditLog: existing.auditLog,
          updatedAt: nowIso
        }).eq('employeeId', employeeId).eq('salaryMonth', month);
      } catch (e) {}
    }

    return true;
  },

  async revokeExpenseApproval(employeeId, month, reason = '', adminUser = 'Senior Admin') {
    const nowIso = new Date().toISOString();
    const data = loadLocalData();
    const existing = (data.expenseVerifications || []).find(v => v.employeeId === employeeId && v.salaryMonth === month);
    if (!existing) return true;

    existing.approvalStatus = 'REVOKED';
    existing.updatedAt = nowIso;
    if (!existing.auditLog) existing.auditLog = [];
    existing.auditLog.push({
      action: 'APPROVAL_REVOKED',
      by: adminUser,
      at: nowIso,
      reason
    });
    saveLocalData(data);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('expense_verifications').update({
          approvalStatus: 'REVOKED',
          auditLog: existing.auditLog,
          updatedAt: nowIso
        }).eq('employeeId', employeeId).eq('salaryMonth', month);
      } catch (e) {}
    }

    return true;
  },

  async getEmployeeCreditHistory(employeeId) {
    if (!employeeId) throw new Error('employeeId is required');
    const employees = await this.getEmployees(true);
    const emp = employees.find(e => e.id === employeeId);
    const empName = emp ? emp.name : 'Unknown';

    let allPdfs = [];
    if (!useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('accounts_pdfs').select('*');
        if (data && data.length > 0) allPdfs = data;
      } catch (e) {}
    }
    if (allPdfs.length === 0) {
      const local = loadLocalData();
      allPdfs = local.accountsPdfs || [];
    }

    const allEntries = [];
    const seenTxKeys = new Set();
    const { isNameMatch } = require('./pdf-parser-helper');

    allPdfs.forEach(pdf => {
      const entries = Array.isArray(pdf.extractedData) ? pdf.extractedData : (Array.isArray(pdf.extractedEntries) ? pdf.extractedEntries : []);
      entries.forEach(entry => {
        let isMatch = false;
        if (pdf.manualMappings && pdf.manualMappings[employeeId] === entry.rawPayee) {
          isMatch = true;
        } else if (emp && isNameMatch(entry.rawPayee || entry.description, emp.name)) {
          isMatch = true;
        }

        if (isMatch) {
          const creditAmt = Number(entry.credit) || 0;
          const debitAmt = Number(entry.debit) || 0;
          const txAmt = Number(entry.amount) || (creditAmt > 0 ? creditAmt : debitAmt);
          const isCredit = (creditAmt > 0) || (entry.type === 'CREDIT') || (txAmt > 0 && debitAmt === 0 && !/debit|dr\b/i.test(entry.description || ''));

          if (isCredit && txAmt > 0) {
            const key = `${entry.date}_${entry.refNo || ''}_${txAmt}`;
            if (!seenTxKeys.has(key)) {
              seenTxKeys.add(key);
              allEntries.push({
                date: entry.date,
                month: entry.date ? entry.date.substring(0, 7) : 'Unknown',
                description: entry.description || entry.rawLine || 'Bank Credit',
                refNo: entry.refNo || '—',
                amount: txAmt,
                balance: entry.balance || 0,
                type: 'CREDIT',
                source: pdf.fileName || 'Bank PDF'
              });
            }
          }
        }
      });
    });

    allEntries.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const creditsByMonth = {};
    let totalCreditsAllTime = 0;
    allEntries.forEach(e => {
      creditsByMonth[e.month] = (creditsByMonth[e.month] || 0) + e.amount;
      totalCreditsAllTime += e.amount;
    });

    let verifications = [];
    if (!useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('expense_verifications').select('*').eq('employeeId', employeeId);
        if (data && data.length > 0) verifications = data;
      } catch (e) {}
    }
    if (verifications.length === 0) {
      const local = loadLocalData();
      verifications = (local.expenseVerifications || []).filter(v => v.employeeId === employeeId);
    }

    const verifByMonth = {};
    verifications.forEach(v => { verifByMonth[v.salaryMonth] = v; });

    const monthsSet = new Set([...Object.keys(creditsByMonth), ...Object.keys(verifByMonth)]);
    const monthlySummary = Array.from(monthsSet).sort().reverse().map(m => {
      const v = verifByMonth[m] || {};
      return {
        month: m,
        bankCredits: creditsByMonth[m] || 0,
        claimedAmount: v.claimedAmount || 0,
        verifiedAmount: v.verifiedAmount !== undefined ? v.verifiedAmount : null,
        approvedAmount: v.approvedAmount !== undefined ? v.approvedAmount : null,
        verificationStatus: v.verificationStatus || 'PENDING',
        approvalStatus: v.approvalStatus || 'PENDING',
        verifiedBy: v.verifiedBy || null,
        approvedBy: v.approvedBy || null
      };
    });

    return {
      employeeId,
      employeeName: empName,
      totalCreditsAllTime,
      creditsByMonth,
      allCreditTransactions: allEntries,
      monthlySummary
    };
  },

  // ─── Emergency Salary Generator Core Aggregation & Audit Methods ───────────

  async getEmergencySalaryData(monthStr = null) {
    if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
      const now = new Date();
      monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [employees, allSalaries, appExpensesMap, accountsPdf, expenseVerifications, pdfRuns] = await Promise.all([
      this.getEmployees(true).catch(() => []),
      this.generateAllSalaries(monthStr).catch(() => []),
      this.getAppExpensesMap(monthStr).catch(() => ({})),
      this.getAccountsPdf(monthStr).catch(() => null),
      this.getExpenseVerifications(monthStr).catch(() => []),
      this.getSalaryPdfRuns(monthStr).catch(() => [])
    ]);

    const salariesMap = {};
    (allSalaries || []).forEach(s => { if (s && s.employeeId) salariesMap[s.employeeId] = s; });

    const verifMap = {};
    (expenseVerifications || []).forEach(v => { if (v && v.employeeId) verifMap[v.employeeId] = v; });

    const pdfVerifMap = {};
    if (accountsPdf && Array.isArray(accountsPdf.verificationResults)) {
      accountsPdf.verificationResults.forEach(v => {
        if (v && v.employeeId) pdfVerifMap[v.employeeId] = v;
      });
    }

    const records = [];
    let totalBaseSalary = 0;
    let totalAppCredits = 0;
    let totalBankCredits = 0;
    let totalVerifiedCredits = 0;
    let totalExpenses = 0;
    let totalFinalPayable = 0;

    let totalVerifiedCount = 0;
    let totalMismatchCount = 0;
    let totalNeedsReviewCount = 0;
    let totalNoCreditCount = 0;
    let totalApprovedCount = 0;

    (employees || []).forEach(emp => {
      if (!emp || emp.status === 'DELETED' || emp.isArchived) return;
      const empId = emp.id;
      const empName = emp.name ? emp.name.trim() : 'Staff Member';
      const role = emp.role || 'Staff';
      const sal = salariesMap[empId] || {};
      const expData = appExpensesMap[empId] || { totalExpense: 0, entries: [] };
      const pdfVerif = pdfVerifMap[empId] || {};
      const dbVerif = verifMap[empId] || {};

      const monthlySalary = sal.basicSalary || (Number(emp.baseSalary) || Number(emp.basicSalary) || 0);
      const appCredit = sal.earnedSalary || 0;
      const bankCredit = pdfVerif.bankCreditTotal !== undefined ? pdfVerif.bankCreditTotal : 0;
      const matchedTxList = pdfVerif.matchedCredits || [];
      const monthExpense = expData.totalExpense || (sal.totalExpenses || 0);

      // Determine verified credit amount
      let verifiedCredit = bankCredit;
      if (dbVerif.verifiedAmount !== null && dbVerif.verifiedAmount !== undefined) {
        verifiedCredit = Number(dbVerif.verifiedAmount);
      }

      // Difference calculation
      const difference = Math.round(Math.abs(appCredit - bankCredit) * 100) / 100;

      // Verification Status resolution
      let verificationStatus = 'NO CREDIT FOUND';
      if (dbVerif.verificationStatus && dbVerif.verificationStatus !== 'PENDING') {
        verificationStatus = dbVerif.verificationStatus;
      } else if (pdfVerif.verificationStatus) {
        if (pdfVerif.verificationStatus === 'VERIFIED') verificationStatus = 'VERIFIED';
        else if (pdfVerif.verificationStatus === 'AMOUNT MISMATCH') verificationStatus = 'MISMATCH';
        else if (pdfVerif.verificationStatus === 'AMBIGUOUS' || pdfVerif.verificationStatus === 'PARSER REVIEW REQUIRED') verificationStatus = 'NEEDS REVIEW';
        else if (pdfVerif.verificationStatus === 'NOT FOUND') verificationStatus = 'NO CREDIT FOUND';
      } else if (bankCredit === 0 && appCredit === 0) {
        verificationStatus = 'VERIFIED';
      } else if (bankCredit > 0 && difference < 1.0) {
        verificationStatus = 'VERIFIED';
      } else if (difference >= 1.0) {
        verificationStatus = 'MISMATCH';
      }

      // Rule 9: ONLY subtract credit when verified or approved
      const isCreditEligible = (verificationStatus === 'VERIFIED' || dbVerif.approvalStatus === 'APPROVED' || (dbVerif.verifiedAmount !== null && dbVerif.verifiedAmount !== undefined));
      const creditDeduction = isCreditEligible ? verifiedCredit : 0;

      // Final Payable Salary: Monthly Salary - Verified Credit - Month Expense
      const calculatedFinal = Math.max(0, monthlySalary - creditDeduction - monthExpense);
      const finalSalary = dbVerif.approvedAmount !== null && dbVerif.approvedAmount !== undefined ? Number(dbVerif.approvedAmount) : calculatedFinal;

      const approvalStatus = dbVerif.approvalStatus || 'PENDING';

      // Totals summation
      totalBaseSalary += monthlySalary;
      totalAppCredits += appCredit;
      totalBankCredits += bankCredit;
      totalVerifiedCredits += creditDeduction;
      totalExpenses += monthExpense;
      totalFinalPayable += finalSalary;

      if (approvalStatus === 'APPROVED') totalApprovedCount++;
      if (verificationStatus === 'VERIFIED') totalVerifiedCount++;
      else if (verificationStatus === 'MISMATCH') totalMismatchCount++;
      else if (verificationStatus === 'NEEDS REVIEW' || verificationStatus === 'AMBIGUOUS') totalNeedsReviewCount++;
      else if (verificationStatus === 'NO CREDIT FOUND') totalNoCreditCount++;

      records.push({
        id: empId,
        employeeId: empId,
        name: empName,
        employeeName: empName,
        role,
        baseSalary: monthlySalary,
        monthlySalary,
        appCredit,
        bankCredit,
        verifiedCredit,
        difference,
        expenses: monthExpense,
        finalPayable: finalSalary,
        finalSalary,
        verificationStatus,
        approvalStatus,
        verifiedBy: dbVerif.verifiedBy || null,
        verifiedAt: dbVerif.verifiedAt || null,
        approvedBy: dbVerif.approvedBy || null,
        approvedAt: dbVerif.approvedAt || null,
        notes: dbVerif.notes || '',
        auditLog: dbVerif.auditLog || [],
        bankTransactions: matchedTxList,
        matchedTransactions: matchedTxList
      });
    });

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [yStr, mStr] = monthStr.split('-');
    const mIdx = parseInt(mStr, 10) - 1;
    const formattedMonth = `${monthNames[mIdx] || monthStr} ${yStr}`;

    return {
      month: monthStr,
      salaryMonth: monthStr,
      formattedMonth,
      summary: {
        totalEmployees: records.length,
        totalBaseSalary,
        totalAppCredits,
        totalBankCredits,
        totalVerifiedCredits,
        totalExpenses,
        totalFinalPayable,
        totalVerifiedCount,
        totalMismatchCount,
        totalNeedsReviewCount,
        totalNoCreditCount,
        totalApprovedCount
      },
      employees: records,
      records,
      attachedPdfs: accountsPdf ? (accountsPdf.pdfs || [{ fileName: accountsPdf.fileName || 'Bank_Statement.pdf', bankName: accountsPdf.bankName || 'Bank Statement', transactionCount: (accountsPdf.extractedData||[]).length }]) : [],
      pdfRuns
    };
  },

  async getSalaryPdfRuns(month) {
    if (!month) return [];
    let list = [];
    if (!useLocalFallback && supabase) {
      try {
        const { data } = await supabase.from('salary_pdf_runs').select('*').eq('salaryMonth', month).order('generatedAt', { ascending: false });
        if (data && data.length > 0) list = data;
      } catch (e) {}
    }
    if (list.length === 0) {
      const local = loadLocalData();
      list = (local.salaryPdfRuns || []).filter(r => r.salaryMonth === month);
    }
    return list;
  },

  async saveSalaryPdfRun(month, runData) {
    if (!month) throw new Error('month required');
    const nowIso = new Date().toISOString();
    const existingRuns = await this.getSalaryPdfRuns(month);
    const runSeq = String(existingRuns.length + 1).padStart(3, '0');
    const [yStr, mStr] = month.split('-');
    const monthAbbrList = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const mAbbr = monthAbbrList[parseInt(mStr, 10) - 1] || 'MON';
    const runId = runData.runId || `SAL-${mAbbr}-${yStr}-${runSeq}`;

    const newRun = {
      id: generateId('run'),
      salaryMonth: month,
      runId,
      generatedBy: runData.generatedBy || 'Admin',
      generatedAt: nowIso,
      summary: runData.summary || {},
      records: runData.records || [],
      auditLog: [{ action: 'PDF_GENERATED', by: runData.generatedBy || 'Admin', at: nowIso, runId }]
    };

    const localData = loadLocalData();
    if (!localData.salaryPdfRuns) localData.salaryPdfRuns = [];
    localData.salaryPdfRuns.unshift(newRun);
    saveLocalData(localData);

    if (!useLocalFallback && supabase) {
      try {
        await supabase.from('salary_pdf_runs').insert(newRun);
      } catch (e) {}
    }

    return newRun;
  },

  async getFinalizedSalaryReport(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [employees, allAttendance, workRecords, rawSalaries, accountsPdf, approvals, verifications, settings, manualOverrides, manualSundayOverrides, allBills] = await Promise.all([
      this.getEmployees(false),
      this.getAttendance(month).catch(() => []),
      this.getWorkRecords(null, month).catch(() => []),
      (async () => {
        if (!useLocalFallback && supabase) {
          try {
            const { data } = await supabase.from('salaries').select('*');
            if (data && data.length > 0) return data;
          } catch (e) {}
        }
        const local = loadLocalData();
        return (local.salaries || []);
      })().catch(() => []),
      this.getAccountsPdf(month).catch(() => null),
      this.getSalaryApprovals(month).catch(() => []),
      this.getExpenseVerifications(month).catch(() => []),
      this.getSettings().catch(() => ({})),
      this.getManualPresentDays(month).catch(() => ({})),
      this.getManualSundayBonuses(month).catch(() => ({})),
      this.getBills({ employeeId: null }).catch(() => [])
    ]);

    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));

    // Filter attendance strictly for this month and non-leave
    const monthAttendance = (allAttendance || []).filter(a => a.date && a.date.startsWith(month) && !isLeave(a));

    const salariesMap = {};
    // First map any month match
    (rawSalaries || []).forEach(s => {
      if (s.month === month || s.salaryMonth === month) {
        salariesMap[s.employeeId] = s;
      }
    });
    // Fallback basic salary from other months if not set for this month
    (rawSalaries || []).forEach(s => {
      if (!salariesMap[s.employeeId] && s.basicSalary > 0) {
        salariesMap[s.employeeId] = s;
      }
    });

    const approvalsMap = {};
    (approvals || []).forEach(a => { approvalsMap[a.employeeId] = a; });

    const verificationsMap = {};
    (verifications || []).forEach(v => { verificationsMap[v.employeeId] = v; });

    // Bank credits map from Accounts PDF
    const bankCreditsMap = {};
    if (accountsPdf && Array.isArray(accountsPdf.verificationResults)) {
      accountsPdf.verificationResults.forEach(vr => {
        bankCreditsMap[vr.employeeId] = vr;
      });
    }

    let totalBaseSalary = 0;
    let totalEarnedSalary = 0;
    let totalClaimedExpenses = 0;
    let totalEffectiveExpenses = 0;
    let totalNetSalary = 0;
    let totalBankCredits = 0;
    let totalVerifiedCount = 0;
    let totalApprovedCount = 0;

    const employeeReports = (employees || []).map(emp => {
      const empId = emp.id;
      const empName = emp.name;

      // Filter attendance records for this employee in this month
      const empAtt = monthAttendance.filter(a => a.employeeId === empId);
      const presentDates = new Set();
      empAtt.forEach(a => presentDates.add(a.date));

      let regularPresentDays = 0;
      let sundayPresentDays = 0;
      let worked14Aug = false;
      presentDates.forEach(dateStr => {
        const parts = dateStr.split('-');
        const yearStr = parts[0];
        const monthStr = parts[1];
        const dayStr = parts[2];
        const dt = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10));

        if (monthStr === '08' && dayStr === '14') worked14Aug = true;

        if (dt.getDay() === 0) sundayPresentDays++;
        else regularPresentDays++;
      });

      const autoTotalDays = regularPresentDays + sundayPresentDays;
      const override = manualOverrides[empId] || null;
      const isManualPresentDays = Boolean(override && typeof override.manualPresentDays === 'number');
      const effectivePresentDays = isManualPresentDays ? override.manualPresentDays : autoTotalDays;

      let effectiveSundayDays = sundayPresentDays;
      let effectiveRegularDays = regularPresentDays;
      if (isManualPresentDays) {
        effectiveSundayDays = Math.min(sundayPresentDays, effectivePresentDays);
        effectiveRegularDays = Math.max(0, effectivePresentDays - effectiveSundayDays);
      }

      // Salary definition: sal record basicSalary or emp.baseSalary or emp.basicSalary
      const salRec = salariesMap[empId] || {};
      const basicSalary = Number(salRec.basicSalary) || Number(emp.baseSalary) || Number(emp.basicSalary) || 0;

      // REQUIRED PAYROLL FORMULA:
      // PerDaySalary = MonthlySalary / 30
      const perDaySalary = basicSalary > 0 ? Math.round((basicSalary / 30) * 100) / 100 : 0;

      // RegularSalary: Full Basic Salary if presentDays >= 26, else perDaySalary * presentDays
      let regularEarned = 0;
      let extraDaysBonus = 0;
      if (effectivePresentDays >= 26) {
        regularEarned = basicSalary;
        const extraDays = effectivePresentDays - 26;
        if (extraDays > 0) {
          extraDaysBonus = Math.round(extraDays * perDaySalary * 100) / 100;
        }
      } else {
        regularEarned = Math.round(effectivePresentDays * perDaySalary * 100) / 100;
      }

      // SundayBonus = PerDaySalary × SundayWorked
      const sunOverride = manualSundayOverrides[empId] || null;
      const isManualSundayBonus = Boolean(sunOverride && typeof sunOverride.manualSundayBonus === 'number');
      const autoSundayBonus = Math.round(effectiveSundayDays * perDaySalary * 100) / 100;
      const sundayBonus = isManualSundayBonus ? sunOverride.manualSundayBonus : autoSundayBonus;

      // 14 Aug Independence Day Bonus
      const aug14Bonus = (month.endsWith('-08') && worked14Aug) ? perDaySalary : 0;

      // GrossEarnedSalary = RegularSalary + ExtraDaysBonus + SundayBonus + 14AugBonus
      const earnedSalary = Math.round((regularEarned + extraDaysBonus + sundayBonus + aug14Bonus) * 100) / 100;

      // Itemized expenses strictly for this month
      const itemizedExpenses = [];
      const processedExpenseKeys = new Set();

      // From attendance clock-outs
      empAtt.forEach(a => {
        const amt = Number(a.expenseAmount) || Number(a.moneySpent) || 0;
        if (amt > 0) {
          const key = `${a.date}_${amt}_${(a.performanceNotes || '').trim()}`;
          if (!processedExpenseKeys.has(key)) {
            processedExpenseKeys.add(key);
            itemizedExpenses.push({
              date: a.date,
              amount: amt,
              description: a.performanceNotes || 'Clock-Out Expense',
              category: 'Daily Shift Expense',
              source: 'Attendance Clock-Out'
            });
          }
        }
      });

      // From work records
      (workRecords || []).forEach(wr => {
        if (wr.employeeId === empId && wr.date && wr.date.startsWith(month)) {
          const amt = Number(wr.expenseAmount) || 0;
          if (amt > 0) {
            const key = `${wr.date}_${amt}_${(wr.performedWork || '').trim()}`;
            if (!processedExpenseKeys.has(key)) {
              processedExpenseKeys.add(key);
              itemizedExpenses.push({
                date: wr.date,
                amount: amt,
                description: wr.performedWork || 'Work Record Expense',
                category: 'Work Expense',
                source: 'Work Record'
              });
            }
          }
        }
      });

      // From employee bills (including materials, transport, supplies, etc.)
      (allBills || []).forEach(bill => {
        if (bill.employeeId === empId) {
          const bDate = bill.billDate || bill.date || (bill.createdAt ? bill.createdAt.split('T')[0] : '');
          if (bDate && bDate.startsWith(month) && bill.status !== 'REJECTED') {
            const amt = Number(bill.totalClaimedAmount) || Number(bill.totalAmount) || (
              (Number(bill.transportationExpense) || 0) +
              (Number(bill.materialExpense) || 0) +
              (Number(bill.labourExpense) || 0) +
              (Number(bill.accommodationExpense) || 0) +
              (Number(bill.otherExpense) || 0)
            );
            if (amt > 0) {
              const key = `bill_${bill.id}`;
              if (!processedExpenseKeys.has(key)) {
                processedExpenseKeys.add(key);
                let cat = 'Bill Expense';
                if (bill.materialExpense > 0 || (bill.categories && bill.categories.material && bill.categories.material.claimedAmount > 0)) {
                  cat = 'Materials & Supplies';
                } else if (bill.transportationExpense > 0) {
                  cat = 'Transportation';
                } else if (bill.category) {
                  cat = bill.category;
                }
                itemizedExpenses.push({
                  id: bill.id,
                  billId: bill.id,
                  isBill: true,
                  billNumber: bill.billNumber || 'Bill',
                  date: bDate,
                  amount: amt,
                  description: bill.description || bill.notes || `Bill #${bill.billNumber || bill.id}`,
                  category: cat,
                  status: bill.status || 'SUBMITTED',
                  attachments: bill.attachments || [],
                  source: 'Employee Bill'
                });
              }
            }
          }
        }
      });

      itemizedExpenses.sort((a, b) => a.date.localeCompare(b.date));
      const totalExpenses = itemizedExpenses.reduce((sum, e) => sum + e.amount, 0);

      // Two-level verification: Admin 1 Verification & Senior Admin Approval
      const expVer = verificationsMap[empId] || null;
      const appr = approvalsMap[empId] || null;

      const isExpRejected = Boolean(expVer && expVer.verificationStatus === 'REJECTED');
      const isExpVerified = Boolean(!isExpRejected && expVer && (expVer.verificationStatus === 'VERIFIED' || (expVer.verifiedAmount !== null && expVer.verifiedAmount !== undefined)));
      const verifiedAmount = isExpVerified ? Number(expVer.verifiedAmount) : (isExpRejected ? 0 : null);
      const verifiedBy = isExpVerified ? (expVer.verifiedBy || 'Admin 1') : (isExpRejected ? (expVer.verifiedBy || 'Admin 1') : null);
      const verifiedAt = isExpVerified ? expVer.verifiedAt : (isExpRejected ? expVer.verifiedAt : null);

      const isExpApproved = Boolean(!isExpRejected && ((expVer && (expVer.approvalStatus === 'APPROVED' || (expVer.approvedAmount !== null && expVer.approvedAmount !== undefined))) || (appr && appr.approvalStatus === 'APPROVED')));
      const approvedAmount = (isExpApproved && expVer && expVer.approvedAmount !== null && expVer.approvedAmount !== undefined) ? Number(expVer.approvedAmount) : (appr ? Number(appr.approvedAmount) : null);
      const approvedBy = isExpApproved ? (expVer?.approvedBy || appr?.approvedBy || 'Senior Admin') : null;
      const approvedAt = isExpApproved ? (expVer?.approvedAt || appr?.approvedAt) : null;

      let effectiveExpense = totalExpenses;
      if (isExpRejected) {
        effectiveExpense = 0;
      } else if (isExpApproved && approvedAmount !== null) {
        effectiveExpense = approvedAmount;
      } else if (isExpVerified && verifiedAmount !== null) {
        effectiveExpense = verifiedAmount;
      }

      const netSalary = Math.round((earnedSalary - effectiveExpense) * 100) / 100;

      // Bank statement credits from Accounts PDF
      const pdfVr = bankCreditsMap[empId] || null;
      const bankCredits = pdfVr ? (Number(pdfVr.bankCreditTotal) !== undefined ? Number(pdfVr.bankCreditTotal) : Number(pdfVr.pdfExpense || 0)) : 0;
      const bankDifference = Math.round(Math.abs(bankCredits - netSalary) * 100) / 100;
      
      let bankStatus = 'NO_PDF';
      if (accountsPdf) {
        if (pdfVr && (pdfVr.isFoundInPdf || pdfVr.includedTransactionsCount > 0)) {
          bankStatus = bankDifference < 1.0 ? 'MATCHED' : 'MISMATCH';
        } else {
          bankStatus = netSalary === 0 ? 'MATCHED_ZERO' : 'NOT_IN_PDF';
        }
      }

      if (isExpVerified) totalVerifiedCount++;
      if (isExpApproved) totalApprovedCount++;

      totalBaseSalary += basicSalary;
      totalEarnedSalary += earnedSalary;
      totalClaimedExpenses += totalExpenses;
      totalEffectiveExpenses += effectiveExpense;
      totalNetSalary += netSalary;
      totalBankCredits += bankCredits;

      return {
        id: empId,
        name: empName,
        role: emp.role || 'Staff',
        basicSalary,
        workingDays: 30,
        regularPresentDays: effectiveRegularDays,
        sundayPresentDays: effectiveSundayDays,
        worked14Aug,
        aug14Bonus,
        extraDaysBonus,
        presentDays: effectivePresentDays,
        autoPresentDays: autoTotalDays,
        isManualPresentDays,
        manualPresentDays: isManualPresentDays ? override.manualPresentDays : null,
        editedBy: override ? override.editedBy : null,
        editedAt: override ? override.editedAt : null,
        isManualSundayBonus,
        manualSundayBonus: isManualSundayBonus ? sunOverride.manualSundayBonus : null,
        autoSundayBonus,
        sundayBonusEditedBy: sunOverride ? sunOverride.editedBy : null,
        sundayBonusEditedAt: sunOverride ? sunOverride.editedAt : null,
        sundayBonusAudit: sunOverride ? {
          originalAutoSundayBonus: sunOverride.originalAutoSundayBonus,
          editedBy: sunOverride.editedBy,
          editedAt: sunOverride.editedAt
        } : null,
        perDaySalary,
        regularEarned,
        sundayBonus,
        earnedSalary,
        itemizedExpenses,
        totalExpenses,
        isExpVerified,
        isExpRejected,
        verifiedAmount,
        verifiedBy,
        verifiedAt,
        isExpApproved,
        approvedAmount,
        approvedBy,
        approvedAt,
        effectiveExpense,
        netSalary,
        bankCredits,
        bankDifference,
        bankStatus,
        salaryApprovalStatus: isExpApproved ? 'APPROVED' : 'NOT_APPROVED'
      };
    });

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [yStr, mStr] = month.split('-');
    const mIdx = parseInt(mStr, 10) - 1;
    const formattedMonth = `${monthNames[mIdx] || month} ${yStr}`;

    return {
      month,
      formattedMonth,
      officeName: settings.officeName || 'Office',
      generatedAt: new Date().toISOString(),
      summary: {
        totalEmployees: employeeReports.length,
        totalBaseSalary: Math.round(totalBaseSalary * 100) / 100,
        totalEarnedSalary: Math.round(totalEarnedSalary * 100) / 100,
        totalClaimedExpenses: Math.round(totalClaimedExpenses * 100) / 100,
        totalEffectiveExpenses: Math.round(totalEffectiveExpenses * 100) / 100,
        totalNetSalary: Math.round(totalNetSalary * 100) / 100,
        totalBankCredits: Math.round(totalBankCredits * 100) / 100,
        totalVerifiedCount,
        totalApprovedCount
      },
      employees: employeeReports
    };
  }

  , // ─── Material Management System Methods ────────────────────────────────────────

  async getMaterialTransactions(employeeId = null) {
    if (useLocalFallback) {
      const data = loadLocalData();
      let transactions = data.materialTransactions || [];
      if (employeeId) {
        transactions = transactions.filter(t => t.employeeId === employeeId);
      }
      
      return transactions.map(t => {
        const atts = (data.materialAttachments || []).filter(a => a.transactionId === t.id);
        const verif = (data.materialVerifications || []).find(v => v.transactionId === t.id);
        const appr = (data.materialApprovals || []).find(a => a.transactionId === t.id);
        
        let vAtts = [];
        if (verif) {
          vAtts = (data.materialVerificationAttachments || []).filter(a => a.verificationId === verif.id);
        }
        
        let aAtts = [];
        if (appr) {
          aAtts = (data.materialApprovalAttachments || []).filter(a => a.approvalId === appr.id);
        }

        return {
          ...t,
          attachments: atts,
          verification: verif ? { ...verif, attachments: vAtts } : null,
          approval: appr ? { ...appr, attachments: aAtts } : null
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    
    try {
      let query = supabase.from('material_transactions').select('*').order('createdAt', { ascending: false });
      if (employeeId) query = query.eq('employeeId', employeeId);
      const { data: transactions, error } = await query;
      if (error) throw error;
      
      if (!transactions || transactions.length === 0) return [];
      
      const transactionIds = transactions.map(t => t.id);
      
      const { data: atts } = await supabase.from('material_attachments').select('*').in('transactionId', transactionIds);
      const { data: verifs } = await supabase.from('material_verifications').select('*').in('transactionId', transactionIds);
      const { data: apprs } = await supabase.from('material_approvals').select('*').in('transactionId', transactionIds);
      
      const verifIds = (verifs || []).map(v => v.id);
      const apprIds = (apprs || []).map(a => a.id);
      
      const { data: vAtts } = verifIds.length > 0 ? await supabase.from('material_verification_attachments').select('*').in('verificationId', verifIds) : { data: [] };
      const { data: aAtts } = apprIds.length > 0 ? await supabase.from('material_approval_attachments').select('*').in('approvalId', apprIds) : { data: [] };
      
      return transactions.map(t => {
        const tAtts = (atts || []).filter(a => a.transactionId === t.id);
        const verif = (verifs || []).find(v => v.transactionId === t.id);
        const appr = (apprs || []).find(a => a.transactionId === t.id);
        
        return {
          ...t,
          attachments: tAtts,
          verification: verif ? { ...verif, attachments: (vAtts || []).filter(a => a.verificationId === verif.id) } : null,
          approval: appr ? { ...appr, attachments: (aAtts || []).filter(a => a.approvalId === appr.id) } : null
        };
      });
    } catch (error) {
      if (isQuotaOrNetworkError(error)) {
        useLocalFallback = true;
        return this.getMaterialTransactions(employeeId);
      }
      handleSupabaseError(error, 'fetch material transactions');
      return [];
    }
  },

  async addMaterialTransaction({ employeeId, employeeName, materialName, inwardQuantity, inwardDate, inwardComment, outwardQuantity, outwardDate, outwardComment, remainingComment, attachments }) {
    const normalizedName = materialName.trim().toUpperCase();
    let materialId = null;
    let newMaterial = null;
    
    if (useLocalFallback) {
      const data = loadLocalData();
      data.materials = data.materials || [];
      const existingMat = data.materials.find(m => m.name === normalizedName);
      if (existingMat) {
        materialId = existingMat.id;
      } else {
        materialId = generateId('mat');
        newMaterial = { id: materialId, name: normalizedName, createdAt: new Date().toISOString() };
        data.materials.push(newMaterial);
        saveLocalData(data);
      }
    } else {
      try {
        const { data: existingMat, error: fetchErr } = await supabase.from('materials').select('id').eq('name', normalizedName).single();
        if (existingMat) {
          materialId = existingMat.id;
        } else {
          materialId = generateId('mat');
          newMaterial = { id: materialId, name: normalizedName };
          const { error: insErr } = await supabase.from('materials').insert([newMaterial]);
          if (insErr) {
             const { data: retryMat } = await supabase.from('materials').select('id').eq('name', normalizedName).single();
             if (retryMat) materialId = retryMat.id;
             else throw insErr;
          }
        }
      } catch (err) {
        if (isQuotaOrNetworkError(err)) {
          useLocalFallback = true;
          return this.addMaterialTransaction({ employeeId, employeeName, materialName, inwardQuantity, inwardDate, inwardComment, outwardQuantity, outwardDate, outwardComment, remainingComment, attachments });
        }
        throw err;
      }
    }
    
    if (useLocalFallback) {
      const data = loadLocalData();
      const existingUnapproved = (data.materialTransactions || []).find(
        t => t.employeeId === employeeId && t.materialId === materialId && (t.status === 'PENDING_VERIFICATION' || t.status === 'VERIFIED')
      );
      if (existingUnapproved) {
        const err = new Error('MATERIAL_TRANSACTION_PENDING');
        err.status = 409;
        err.code = 'MATERIAL_TRANSACTION_PENDING';
        throw err;
      }
    } else {
      const { data: existingUnapproved, error: checkErr } = await supabase
        .from('material_transactions')
        .select('id')
        .eq('employeeId', employeeId)
        .eq('materialId', materialId)
        .in('status', ['PENDING_VERIFICATION', 'VERIFIED'])
        .limit(1);
        
      if (!checkErr && existingUnapproved && existingUnapproved.length > 0) {
        const err = new Error('MATERIAL_TRANSACTION_PENDING');
        err.status = 409;
        err.code = 'MATERIAL_TRANSACTION_PENDING';
        throw err;
      }
    }
    
    let previousApprovedRemaining = 0;
    if (useLocalFallback) {
      const data = loadLocalData();
      const approvedForMat = (data.materialTransactions || [])
        .filter(t => t.employeeId === employeeId && t.materialId === materialId && t.status === 'APPROVED')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (approvedForMat.length > 0) {
        previousApprovedRemaining = Number(approvedForMat[0].remainingQuantity || 0);
      }
    } else {
      const { data: lastApproved } = await supabase
        .from('material_transactions')
        .select('remainingQuantity')
        .eq('employeeId', employeeId)
        .eq('materialId', materialId)
        .eq('status', 'APPROVED')
        .order('createdAt', { ascending: false })
        .limit(1);
      if (lastApproved && lastApproved.length > 0) {
        previousApprovedRemaining = Number(lastApproved[0].remainingQuantity || 0);
      }
    }
    
    const inQty = Number(inwardQuantity || 0);
    const outQty = Number(outwardQuantity || 0);
    const availableQuantity = previousApprovedRemaining + inQty;
    
    if (outQty > availableQuantity) {
      throw new Error(`Outward quantity (${outQty}) cannot exceed available quantity (${availableQuantity}).`);
    }
    
    const remainingQuantity = availableQuantity - outQty;
    const transactionId = generateId('mtrx');
    const nowIso = new Date().toISOString();
    
    const newTx = {
      id: transactionId,
      employeeId,
      employeeName,
      materialId,
      materialName: normalizedName,
      previousApprovedRemaining,
      inwardQuantity: inQty,
      inwardDate,
      inwardComment,
      outwardQuantity: outQty,
      outwardDate,
      outwardComment,
      availableQuantity,
      remainingQuantity,
      remainingComment,
      status: 'PENDING_VERIFICATION',
      createdAt: nowIso,
      updatedAt: nowIso
    };
    
    const attRecords = (attachments || []).map(a => ({
      id: generateId('matt'),
      transactionId,
      step: a.step,
      fileType: a.fileType,
      fileData: a.fileData,
      uploadedAt: nowIso
    }));
    
    if (useLocalFallback) {
      const data = loadLocalData();
      data.materialTransactions = data.materialTransactions || [];
      data.materialAttachments = data.materialAttachments || [];
      data.materialTransactions.push(newTx);
      data.materialAttachments.push(...attRecords);
      saveLocalData(data);
      return newTx;
    }
    
    try {
      const { error: txErr } = await supabase.from('material_transactions').insert([newTx]);
      if (txErr) throw txErr;
      
      if (attRecords.length > 0) {
        const { error: attErr } = await supabase.from('material_attachments').insert(attRecords);
        if (attErr) console.error('Failed to insert material attachments:', attErr.message);
      }
      return newTx;
    } catch (err) {
      handleSupabaseError(err, 'insert material transaction');
      throw err;
    }
  },
  
  async verifyMaterialTransaction({ transactionId, verifiedBy, verificationComment, attachments }) {
    const nowIso = new Date().toISOString();
    const verifId = generateId('mver');
    
    const verifRecord = {
      id: verifId,
      transactionId,
      verifiedBy,
      verificationComment,
      verifiedAt: nowIso
    };
    
    const attRecords = (attachments || []).map(a => ({
      id: generateId('mva'),
      verificationId: verifId,
      fileType: a.fileType,
      fileData: a.fileData
    }));
    
    if (useLocalFallback) {
      const data = loadLocalData();
      const tx = (data.materialTransactions || []).find(t => t.id === transactionId);
      if (!tx) throw new Error('Transaction not found');
      if (tx.status !== 'PENDING_VERIFICATION') throw new Error('Transaction is not in PENDING_VERIFICATION state');
      
      tx.status = 'VERIFIED';
      tx.updatedAt = nowIso;
      
      data.materialVerifications = data.materialVerifications || [];
      data.materialVerificationAttachments = data.materialVerificationAttachments || [];
      
      data.materialVerifications.push(verifRecord);
      data.materialVerificationAttachments.push(...attRecords);
      saveLocalData(data);
      return tx;
    }
    
    try {
      const { data: tx } = await supabase.from('material_transactions').select('status').eq('id', transactionId).single();
      if (!tx || tx.status !== 'PENDING_VERIFICATION') throw new Error('Transaction is not in PENDING_VERIFICATION state');
      
      await supabase.from('material_transactions').update({ status: 'VERIFIED', updatedAt: nowIso }).eq('id', transactionId);
      await supabase.from('material_verifications').insert([verifRecord]);
      if (attRecords.length > 0) {
        await supabase.from('material_verification_attachments').insert(attRecords);
      }
      return { success: true };
    } catch (err) {
      handleSupabaseError(err, 'verify material transaction');
      throw err;
    }
  },
  
  async approveMaterialTransaction({ transactionId, approvedBy, approvalComment, attachments }) {
    const nowIso = new Date().toISOString();
    const apprId = generateId('mapr');
    
    const apprRecord = {
      id: apprId,
      transactionId,
      approvedBy,
      approvalComment,
      approvedAt: nowIso
    };
    
    const attRecords = (attachments || []).map(a => ({
      id: generateId('maa'),
      approvalId: apprId,
      fileType: a.fileType,
      fileData: a.fileData
    }));
    
    if (useLocalFallback) {
      const data = loadLocalData();
      const tx = (data.materialTransactions || []).find(t => t.id === transactionId);
      if (!tx) throw new Error('Transaction not found');
      if (tx.status !== 'VERIFIED') throw new Error('Transaction must be VERIFIED before approval');
      
      tx.status = 'APPROVED';
      tx.updatedAt = nowIso;
      
      data.materialApprovals = data.materialApprovals || [];
      data.materialApprovalAttachments = data.materialApprovalAttachments || [];
      
      data.materialApprovals.push(apprRecord);
      data.materialApprovalAttachments.push(...attRecords);
      saveLocalData(data);
      return tx;
    }
    
    try {
      const { data: tx } = await supabase.from('material_transactions').select('status').eq('id', transactionId).single();
      if (!tx || tx.status !== 'VERIFIED') throw new Error('Transaction must be VERIFIED before approval');
      
      await supabase.from('material_transactions').update({ status: 'APPROVED', updatedAt: nowIso }).eq('id', transactionId);
      await supabase.from('material_approvals').insert([apprRecord]);
      if (attRecords.length > 0) {
        await supabase.from('material_approval_attachments').insert(attRecords);
      }
      return { success: true };
    } catch (err) {
      handleSupabaseError(err, 'approve material transaction');
      throw err;
    }
  },
  
  async rejectMaterialTransaction({ transactionId, rejectedBy, rejectionComment }) {
    const nowIso = new Date().toISOString();
    
    if (useLocalFallback) {
      const data = loadLocalData();
      const tx = (data.materialTransactions || []).find(t => t.id === transactionId);
      if (!tx) throw new Error('Transaction not found');
      
      tx.status = 'REJECTED';
      tx.updatedAt = nowIso;
      if (tx.status === 'PENDING_VERIFICATION') {
         data.materialVerifications = data.materialVerifications || [];
         data.materialVerifications.push({ id: generateId('mver'), transactionId, verifiedBy: rejectedBy, verificationComment: `[REJECTED] ${rejectionComment}`, verifiedAt: nowIso });
      } else {
         data.materialApprovals = data.materialApprovals || [];
         data.materialApprovals.push({ id: generateId('mapr'), transactionId, approvedBy: rejectedBy, approvalComment: `[REJECTED] ${rejectionComment}`, approvedAt: nowIso });
      }
      saveLocalData(data);
      return tx;
    }
    
    try {
      const { data: tx } = await supabase.from('material_transactions').select('status').eq('id', transactionId).single();
      if (!tx) throw new Error('Transaction not found');
      
      await supabase.from('material_transactions').update({ status: 'REJECTED', updatedAt: nowIso }).eq('id', transactionId);
      if (tx.status === 'PENDING_VERIFICATION') {
         await supabase.from('material_verifications').insert([{ id: generateId('mver'), transactionId, verifiedBy: rejectedBy, verificationComment: `[REJECTED] ${rejectionComment}`, verifiedAt: nowIso }]);
      } else {
         await supabase.from('material_approvals').insert([{ id: generateId('mapr'), transactionId, approvedBy: rejectedBy, approvalComment: `[REJECTED] ${rejectionComment}`, approvedAt: nowIso }]);
      }
      return { success: true };
    } catch (err) {
      handleSupabaseError(err, 'reject material transaction');
      throw err;
    }
  },

  // ─── BILL & EXPENSE MANAGEMENT SYSTEM ─────────────────────────────────────────

  // Concurrency-safe Next Bill Number preview
  async getNextBillNumber() {
    try {
      let maxNum = _lastAllocatedBillNum;
      if (useLocalFallback) {
        const data = loadLocalData();
        const bills = data.bills || [];
        bills.forEach(b => {
          const m = String(b.billNumber || '').match(/^BILL-(\d+)$/i);
          if (m) {
            const val = parseInt(m[1], 10);
            if (!isNaN(val) && val > maxNum) maxNum = val;
          }
        });
        _lastAllocatedBillNum = Math.max(_lastAllocatedBillNum + 1, maxNum + 1);
        return `BILL-${String(_lastAllocatedBillNum).padStart(6, '0')}`;
      }

      const { data, error } = await supabase
        .from('bills')
        .select('billNumber')
        .order('billNumber', { ascending: false })
        .limit(100);

      if (error) throw error;
      (data || []).forEach(b => {
        const m = String(b.billNumber || '').match(/^BILL-(\d+)$/i);
        if (m) {
          const val = parseInt(m[1], 10);
          if (!isNaN(val) && val > maxNum) maxNum = val;
        }
      });
      _lastAllocatedBillNum = Math.max(_lastAllocatedBillNum + 1, maxNum + 1);
      return `BILL-${String(_lastAllocatedBillNum).padStart(6, '0')}`;
    } catch (err) {
      if (isQuotaOrNetworkError(err)) {
        useLocalFallback = true;
        return this.getNextBillNumber();
      }
      _lastAllocatedBillNum = Math.max(_lastAllocatedBillNum + 1, 1);
      return `BILL-${String(_lastAllocatedBillNum).padStart(6, '0')}`;
    }
  },

  // Concurrency-safe Atomic Bill Creation
  async createBill(billData) {
    if (!billData || !billData.employeeId) {
      const err = new Error('Employee ID is required.');
      err.status = 400;
      throw err;
    }
    if (!billData.siteName || !billData.siteName.trim()) {
      const err = new Error('Site Name is required.');
      err.status = 400;
      throw err;
    }

    const transportationExpense = Math.max(0, Number(billData.transportationExpense) || 0);
    const materialExpense = Math.max(0, Number(billData.materialExpense) || 0);
    const labourExpense = Math.max(0, Number(billData.labourExpense) || 0);
    const accommodationExpense = Math.max(0, Number(billData.accommodationExpense) || 0);
    const otherExpense = Math.max(0, Number(billData.otherExpense) || 0);

    const totalClaimedAmount = transportationExpense + materialExpense + labourExpense + accommodationExpense + otherExpense;

    if (totalClaimedAmount <= 0) {
      const err = new Error('At least one expense category must have a valid positive amount.');
      err.status = 400;
      throw err;
    }

    const attachments = Array.isArray(billData.attachments) ? billData.attachments : [];

    const claimMap = {
      transportation: transportationExpense,
      material: materialExpense,
      labour: labourExpense,
      accommodation: accommodationExpense,
      other: otherExpense
    };

    const categories = {};
    BILL_EXPENSE_CATEGORIES.forEach(cat => {
      const claimed = claimMap[cat];
      categories[cat] = {
        name: cat.charAt(0).toUpperCase() + cat.slice(1),
        claimedAmount: claimed,
        verifiedAmount: claimed === 0 ? 0 : null,
        approvedAmount: claimed === 0 ? 0 : null,
        verificationStatus: claimed === 0 ? 'N/A' : 'PENDING',
        approvalStatus: claimed === 0 ? 'N/A' : 'PENDING',
        verificationComment: '',
        approvalComment: '',
        verifiedBy: null,
        verifiedAt: null,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: '',
        status: claimed === 0 ? 'N/A' : 'SUBMITTED'
      };
    });

    return withBillLock(async () => {
      const nextNum = await this.getNextBillNumber();
      const nowIso = new Date().toISOString();

      const newBill = {
        id: generateId('bill'),
        billNumber: nextNum,
        employeeId: String(billData.employeeId).trim(),
        employeeName: (billData.employeeName || 'Employee').trim(),
        siteName: billData.siteName.trim(),
        billDate: billData.billDate || billData.date || getLocalDateString(),
        submittedAt: nowIso,
        transportationExpense,
        materialExpense,
        labourExpense,
        accommodationExpense,
        otherExpense,
        totalClaimedAmount,
        totalVerifiedAmount: null,
        totalApprovedAmount: null,
        categories,
        description: (billData.description || '').trim(),
        attachments,
        status: 'SUBMITTED',
        verifiedAmount: null,
        verifiedBy: null,
        verifiedAt: null,
        verificationComment: null,
        approvedAmount: null,
        approvedBy: null,
        approvedAt: null,
        approvalComment: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        auditLog: [
          {
            action: 'SUBMITTED',
            by: billData.employeeName || 'Employee',
            at: nowIso,
            details: { totalClaimedAmount, billNumber: nextNum, attachmentsCount: attachments.length, categories }
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      if (useLocalFallback) {
        const data = loadLocalData();
        data.bills = data.bills || [];
        if (data.bills.some(b => b.billNumber === newBill.billNumber)) {
          let maxNum = 0;
          data.bills.forEach(b => {
            const m = String(b.billNumber || '').match(/^BILL-(\d+)$/i);
            if (m) {
              const val = parseInt(m[1], 10);
              if (!isNaN(val) && val > maxNum) maxNum = val;
            }
          });
          newBill.billNumber = `BILL-${String(maxNum + 1).padStart(6, '0')}`;
        }
        data.bills.push(newBill);
        saveLocalData(data);
      } else {
        const hasNativeCategories = await checkBillsTableNativeCategories();
        const rowToInsert = { ...newBill };
        if (!hasNativeCategories) {
          delete rowToInsert.categories;
          delete rowToInsert.totalVerifiedAmount;
          delete rowToInsert.totalApprovedAmount;
          if (rowToInsert.status === 'SUBMITTED') {
            rowToInsert.status = 'PENDING_VERIFICATION';
          }
        }

        try {
          const { data, error } = await supabase
            .from('bills')
            .insert([rowToInsert])
            .select()
            .single();

          if (error) {
            if (error.code === '23505' || String(error.message).includes('duplicate key')) {
              console.warn('Concurrent billNumber collision detected, incrementing sequence...');
              const retryNum = await this.getNextBillNumber();
              newBill.billNumber = retryNum;
              rowToInsert.billNumber = retryNum;
              const { data: retryData, error: retryErr } = await supabase
                .from('bills')
                .insert([rowToInsert])
                .select()
                .single();
              if (retryErr) throw retryErr;
            } else {
              throw error;
            }
          }
        } catch (err) {
          if (isQuotaOrNetworkError(err)) {
            useLocalFallback = true;
            const data = loadLocalData();
            data.bills = data.bills || [];
            data.bills.push(newBill);
            saveLocalData(data);
          } else {
            handleSupabaseError(err, 'create bill');
            throw err;
          }
        }
      }

      // Automatically create a persistent notification in comments table (existing notification system)
      try {
        const notifMsg = `New Bill Submitted\nEmployee: ${newBill.employeeName}\nEmployee ID: ${newBill.employeeId}\nBill Number: ${newBill.billNumber}\nSite: ${newBill.siteName}\nDate: ${newBill.billDate}\nClaimed Amount: Rs. ${Number(newBill.totalClaimedAmount).toLocaleString()}\nStatus: Pending Verification\n[BillID:${newBill.id}]`;
        await this.addComment({
          employeeId: newBill.employeeId,
          employeeName: newBill.employeeName,
          sender: 'bill_system',
          senderName: newBill.employeeName,
          message: notifMsg
        });
      } catch (e) {
        console.warn('Persistent notification creation failed (non-fatal):', e.message);
      }

      return normalizeBillRecord(newBill);
    });
  },

  // Get Bills with optional scoping & filters
  async getBills({ employeeId = null, status = null, search = null, startDate = null, endDate = null } = {}) {
    let list = [];
    if (useLocalFallback) {
      const data = loadLocalData();
      list = (data.bills || []).map(b => normalizeBillRecord(b));
    } else {
      try {
        let query = supabase.from('bills').select('*').order('submittedAt', { ascending: false });
        if (employeeId) {
          query = query.eq('employeeId', employeeId);
        }
        if (status && status !== 'ALL') {
          if (status === 'PENDING_VERIFICATION' || status === 'SUBMITTED') {
            query = query.in('status', ['SUBMITTED', 'PENDING_VERIFICATION', 'PARTIALLY_VERIFIED']);
          } else {
            query = query.eq('status', status);
          }
        }
        if (startDate) {
          query = query.gte('billDate', startDate);
        }
        if (endDate) {
          query = query.lte('billDate', endDate);
        }
        const { data, error } = await query;
        if (error) throw error;
        list = (data || []).map(b => normalizeBillRecord(b));
      } catch (err) {
        if (isQuotaOrNetworkError(err)) {
          useLocalFallback = true;
          const data = loadLocalData();
          list = (data.bills || []).map(b => normalizeBillRecord(b));
        } else {
          handleSupabaseError(err, 'get bills');
          throw err;
        }
      }
    }

    // Apply filters for local fallback or in-memory search
    if (employeeId) {
      list = list.filter(b => b.employeeId === employeeId);
    }
    if (status && status !== 'ALL') {
      if (status === 'PENDING_VERIFICATION' || status === 'SUBMITTED') {
        list = list.filter(b => b.status === 'SUBMITTED' || b.status === 'PENDING_VERIFICATION' || b.status === 'PARTIALLY_VERIFIED');
      } else {
        list = list.filter(b => b.status === status);
      }
    }
    if (startDate) {
      list = list.filter(b => {
        const bDate = b.billDate || b.date || (b.submittedAt ? b.submittedAt.slice(0, 10) : '');
        return !bDate || bDate >= startDate;
      });
    }
    if (endDate) {
      list = list.filter(b => {
        const bDate = b.billDate || b.date || (b.submittedAt ? b.submittedAt.slice(0, 10) : '');
        return !bDate || bDate <= endDate;
      });
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      list = list.filter(b =>
        String(b.billNumber || '').toLowerCase().includes(term) ||
        String(b.employeeName || '').toLowerCase().includes(term) ||
        String(b.employeeId || '').toLowerCase().includes(term) ||
        String(b.siteName || '').toLowerCase().includes(term) ||
        String(b.billDate || '').toLowerCase().includes(term) ||
        String(b.status || '').toLowerCase().includes(term)
      );
    }

    list.sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
    return list;
  },

  // Get Bill By ID
  async getBillById(id) {
    if (!id) return null;
    if (useLocalFallback) {
      const data = loadLocalData();
      const found = (data.bills || []).find(b => b.id === id);
      return found ? normalizeBillRecord(found) : null;
    }
    try {
      const { data, error } = await supabase.from('bills').select('*').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      return normalizeBillRecord(data);
    } catch (err) {
      if (isQuotaOrNetworkError(err)) {
        useLocalFallback = true;
        const data = loadLocalData();
        const found = (data.bills || []).find(b => b.id === id);
        return found ? normalizeBillRecord(found) : null;
      }
      handleSupabaseError(err, 'get bill by ID');
      throw err;
    }
  },

  // Category-wise Admin Verification
  async verifyBillCategory(id, { category, verifiedAmount, verificationComment = '', verifiedBy = 'Admin' } = {}) {
    const catName = String(category || '').toLowerCase().trim();
    if (!BILL_EXPENSE_CATEGORIES.includes(catName)) {
      const err = new Error(`Invalid expense category "${category}". Must be one of: ${BILL_EXPENSE_CATEGORIES.join(', ')}`);
      err.status = 400;
      throw err;
    }

    return withBillLock(async () => {
      const maxRetries = 5;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const rawBill = await this.getBillById(id);
        if (!rawBill) {
          const err = new Error('Bill not found.');
          err.status = 404;
          throw err;
        }

        const bill = normalizeBillRecord(rawBill);
        const cat = bill.categories[catName];
        if (!cat) {
          const err = new Error(`Category "${catName}" not found in bill.`);
          err.status = 400;
          throw err;
        }

        const numVerified = Number(verifiedAmount);
        if (isNaN(numVerified) || numVerified < 0) {
          const err = new Error('Verified amount must be a valid non-negative number.');
          err.status = 400;
          throw err;
        }

        if (numVerified > cat.claimedAmount) {
          const err = new Error(`Verified amount (Rs. ${numVerified.toLocaleString()}) cannot exceed claimed amount (Rs. ${cat.claimedAmount.toLocaleString()}) for ${catName}.`);
          err.status = 400;
          throw err;
        }

        const nowIso = new Date().toISOString();
        const commentText = (verificationComment || '').trim();

        // Update category state
        cat.verifiedAmount = numVerified;
        cat.verifiedBy = verifiedBy || 'Admin';
        cat.verifiedAt = nowIso;
        cat.verificationComment = commentText;
        cat.verificationStatus = 'VERIFIED';
        cat.status = 'VERIFIED';

        // Recompute totals and status
        const calc = computeBillTotalsAndStatus(bill.categories, bill.status);
        bill.totalVerifiedAmount = calc.totalVerifiedAmount;
        bill.totalApprovedAmount = calc.totalApprovedAmount;
        bill.verifiedAmount = calc.totalVerifiedAmount;
        bill.approvedAmount = calc.totalApprovedAmount;
        bill.status = calc.status;

        const auditEntry = {
          action: 'CATEGORY_VERIFIED',
          category: catName,
          by: verifiedBy || 'Admin',
          at: nowIso,
          details: {
            claimedAmount: cat.claimedAmount,
            verifiedAmount: numVerified,
            comment: commentText,
            billStatus: bill.status,
            categories: bill.categories
          }
        };
        bill.auditLog = Array.isArray(bill.auditLog) ? [...bill.auditLog, auditEntry] : [auditEntry];
        bill.updatedAt = nowIso;

        const updates = {
          categories: bill.categories,
          totalVerifiedAmount: bill.totalVerifiedAmount,
          totalApprovedAmount: bill.totalApprovedAmount,
          verifiedAmount: bill.verifiedAmount,
          approvedAmount: bill.approvedAmount,
          status: bill.status,
          auditLog: bill.auditLog,
          updatedAt: nowIso
        };

        if (useLocalFallback) {
          const data = loadLocalData();
          const idx = (data.bills || []).findIndex(b => b.id === id);
          if (idx !== -1) {
            data.bills[idx] = { ...data.bills[idx], ...updates };
            saveLocalData(data);
            return normalizeBillRecord(data.bills[idx]);
          }
          throw new Error('Bill not found');
        }

        const hasNativeCategories = await checkBillsTableNativeCategories();
        const updatesToPersist = { ...updates };
        if (!hasNativeCategories) {
          delete updatesToPersist.categories;
          delete updatesToPersist.totalVerifiedAmount;
          delete updatesToPersist.totalApprovedAmount;
          if (updatesToPersist.status === 'PARTIALLY_VERIFIED' || updatesToPersist.status === 'SUBMITTED') {
            updatesToPersist.status = 'PENDING_VERIFICATION';
          }
        }

        try {
          let query = supabase.from('bills').update(updatesToPersist).eq('id', id);
          if (rawBill.updatedAt && attempt < maxRetries) {
            query = query.eq('updatedAt', rawBill.updatedAt);
          }
          const { data, error } = await query.select().single();

          if (error) {
            if (error.code === 'PGRST116' && attempt < maxRetries) {
              await new Promise(res => setTimeout(res, 50 * attempt));
              continue;
            }
            throw error;
          }

          try {
            await this.addComment({
              employeeId: bill.employeeId,
              employeeName: bill.employeeName,
              sender: 'admin',
              senderName: verifiedBy || 'Admin',
              message: `✓ Bill Category Verified: ${cat.name || catName} verified for Rs. ${numVerified.toLocaleString()} (Bill: ${bill.billNumber})`
            });
          } catch (e) {}

          return normalizeBillRecord({
            ...data,
            categories: bill.categories,
            totalVerifiedAmount: bill.totalVerifiedAmount,
            totalApprovedAmount: bill.totalApprovedAmount,
            status: bill.status
          });
        } catch (err) {
          if (attempt === maxRetries || !isQuotaOrNetworkError(err)) {
            if (isQuotaOrNetworkError(err)) {
              useLocalFallback = true;
              const data = loadLocalData();
              const idx = (data.bills || []).findIndex(b => b.id === id);
              if (idx !== -1) {
                data.bills[idx] = { ...data.bills[idx], ...updates };
                saveLocalData(data);
                return normalizeBillRecord(data.bills[idx]);
              }
            }
            handleSupabaseError(err, 'verify bill category');
            throw err;
          }
        }
      }
    });
  },

  // Category-wise Rejection (Verification or Approval Stage)
  async rejectBillCategory(id, { category, rejectionReason = '', reason = '', rejectedBy = 'Admin', stage = 'verification' } = {}) {
    const catName = String(category || '').toLowerCase().trim();
    if (!BILL_EXPENSE_CATEGORIES.includes(catName)) {
      const err = new Error(`Invalid expense category "${category}". Must be one of: ${BILL_EXPENSE_CATEGORIES.join(', ')}`);
      err.status = 400;
      throw err;
    }

    return withBillLock(async () => {
      const maxRetries = 5;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const rawBill = await this.getBillById(id);
        if (!rawBill) {
          const err = new Error('Bill not found.');
          err.status = 404;
          throw err;
        }

        const bill = normalizeBillRecord(rawBill);
        const cat = bill.categories[catName];
        if (!cat) {
          const err = new Error(`Category "${catName}" not found in bill.`);
          err.status = 400;
          throw err;
        }

        const nowIso = new Date().toISOString();
        const reasonText = (rejectionReason || reason || 'Rejected by Admin').trim();

        if (stage === 'approval') {
          cat.approvalStatus = 'REJECTED';
          cat.approvedAmount = 0;
        } else {
          cat.verificationStatus = 'REJECTED';
          cat.verifiedAmount = 0;
          cat.approvalStatus = 'REJECTED';
          cat.approvedAmount = 0;
        }
        cat.status = 'REJECTED';
        cat.rejectedBy = rejectedBy || 'Admin';
        cat.rejectedAt = nowIso;
        cat.rejectionReason = reasonText;

        // Recompute totals and status
        const calc = computeBillTotalsAndStatus(bill.categories, bill.status);
        bill.totalVerifiedAmount = calc.totalVerifiedAmount;
        bill.totalApprovedAmount = calc.totalApprovedAmount;
        bill.verifiedAmount = calc.totalVerifiedAmount;
        bill.approvedAmount = calc.totalApprovedAmount;
        bill.status = calc.status;

        const auditEntry = {
          action: 'CATEGORY_REJECTED',
          category: catName,
          stage,
          by: rejectedBy || 'Admin',
          at: nowIso,
          details: {
            claimedAmount: cat.claimedAmount,
            reason: reasonText,
            billStatus: bill.status,
            categories: bill.categories
          }
        };
        bill.auditLog = Array.isArray(bill.auditLog) ? [...bill.auditLog, auditEntry] : [auditEntry];
        bill.updatedAt = nowIso;

        const updates = {
          categories: bill.categories,
          totalVerifiedAmount: bill.totalVerifiedAmount,
          totalApprovedAmount: bill.totalApprovedAmount,
          verifiedAmount: bill.verifiedAmount,
          approvedAmount: bill.approvedAmount,
          status: bill.status,
          auditLog: bill.auditLog,
          updatedAt: nowIso
        };

        if (useLocalFallback) {
          const data = loadLocalData();
          const idx = (data.bills || []).findIndex(b => b.id === id);
          if (idx !== -1) {
            data.bills[idx] = { ...data.bills[idx], ...updates };
            saveLocalData(data);
            return normalizeBillRecord(data.bills[idx]);
          }
          throw new Error('Bill not found');
        }

        const hasNativeCategories = await checkBillsTableNativeCategories();
        const updatesToPersist = { ...updates };
        if (!hasNativeCategories) {
          delete updatesToPersist.categories;
          delete updatesToPersist.totalVerifiedAmount;
          delete updatesToPersist.totalApprovedAmount;
          if (updatesToPersist.status === 'PARTIALLY_VERIFIED' || updatesToPersist.status === 'SUBMITTED') {
            updatesToPersist.status = 'PENDING_VERIFICATION';
          }
        }

        try {
          let query = supabase.from('bills').update(updatesToPersist).eq('id', id);
          if (rawBill.updatedAt && attempt < maxRetries) {
            query = query.eq('updatedAt', rawBill.updatedAt);
          }
          const { data, error } = await query.select().single();

          if (error) {
            if (error.code === 'PGRST116' && attempt < maxRetries) {
              await new Promise(res => setTimeout(res, 50 * attempt));
              continue;
            }
            throw error;
          }

          try {
            await this.addComment({
              employeeId: bill.employeeId,
              employeeName: bill.employeeName,
              sender: 'admin',
              senderName: rejectedBy || 'Admin',
              message: `✖ Bill Category Rejected: ${cat.name || catName} was rejected. Reason: ${reasonText} (Bill: ${bill.billNumber})`
            });
          } catch (e) {}

          return normalizeBillRecord({
            ...data,
            categories: bill.categories,
            totalVerifiedAmount: bill.totalVerifiedAmount,
            totalApprovedAmount: bill.totalApprovedAmount,
            status: bill.status
          });
        } catch (err) {
          if (attempt === maxRetries || !isQuotaOrNetworkError(err)) {
            if (isQuotaOrNetworkError(err)) {
              useLocalFallback = true;
              const data = loadLocalData();
              const idx = (data.bills || []).findIndex(b => b.id === id);
              if (idx !== -1) {
                data.bills[idx] = { ...data.bills[idx], ...updates };
                saveLocalData(data);
                return normalizeBillRecord(data.bills[idx]);
              }
            }
            handleSupabaseError(err, 'reject bill category');
            throw err;
          }
        }
      }
    });
  },

  // Category-wise Senior Admin Approval
  async approveBillCategory(id, { category, approvedAmount, approvalComment = '', approvedBy = 'Senior Admin', seniorPasscode } = {}) {
    if (seniorPasscode !== undefined) {
      const settings = await this.getSettings();
      const validPass = (settings && settings.seniorAdminPasscode) || '9999';
      if (String(seniorPasscode).trim() !== validPass) {
        const err = new Error('Invalid Senior Admin Passcode. Approval requires authorization.');
        err.status = 401;
        throw err;
      }
    }

    const catName = String(category || '').toLowerCase().trim();
    if (!BILL_EXPENSE_CATEGORIES.includes(catName)) {
      const err = new Error(`Invalid expense category "${category}". Must be one of: ${BILL_EXPENSE_CATEGORIES.join(', ')}`);
      err.status = 400;
      throw err;
    }

    return withBillLock(async () => {
      const maxRetries = 5;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const rawBill = await this.getBillById(id);
        if (!rawBill) {
          const err = new Error('Bill not found.');
          err.status = 404;
          throw err;
        }

        const bill = normalizeBillRecord(rawBill);
        const cat = bill.categories[catName];
        if (!cat) {
          const err = new Error(`Category "${catName}" not found in bill.`);
          err.status = 400;
          throw err;
        }

        if (cat.verificationStatus !== 'VERIFIED') {
          const err = new Error(`Category "${catName}" cannot be approved because it is ${cat.verificationStatus || 'PENDING'}. It must be VERIFIED first.`);
          err.status = 400;
          throw err;
        }

        const numApproved = Number(approvedAmount);
        if (isNaN(numApproved) || numApproved < 0) {
          const err = new Error('Approved amount must be a valid non-negative number.');
          err.status = 400;
          throw err;
        }

        const maxAllowed = Number(cat.verifiedAmount);
        if (numApproved > maxAllowed) {
          const err = new Error(`Approved amount (Rs. ${numApproved.toLocaleString()}) cannot exceed verified amount (Rs. ${maxAllowed.toLocaleString()}) for ${catName}.`);
          err.status = 400;
          throw err;
        }

        const nowIso = new Date().toISOString();
        const commentText = (approvalComment || '').trim();

        // Update category state
        cat.approvedAmount = numApproved;
        cat.approvedBy = approvedBy || 'Senior Admin';
        cat.approvedAt = nowIso;
        cat.approvalComment = commentText;
        cat.approvalStatus = 'APPROVED';
        cat.status = 'APPROVED';

        // Recompute totals and status
        const calc = computeBillTotalsAndStatus(bill.categories, bill.status);
        bill.totalVerifiedAmount = calc.totalVerifiedAmount;
        bill.totalApprovedAmount = calc.totalApprovedAmount;
        bill.verifiedAmount = calc.totalVerifiedAmount;
        bill.approvedAmount = calc.totalApprovedAmount;
        bill.status = calc.status;

        const auditEntry = {
          action: 'CATEGORY_APPROVED',
          category: catName,
          by: approvedBy || 'Senior Admin',
          at: nowIso,
          details: {
            verifiedAmount: cat.verifiedAmount,
            approvedAmount: numApproved,
            comment: commentText,
            billStatus: bill.status,
            categories: bill.categories
          }
        };
        bill.auditLog = Array.isArray(bill.auditLog) ? [...bill.auditLog, auditEntry] : [auditEntry];
        bill.updatedAt = nowIso;

        const updates = {
          categories: bill.categories,
          totalVerifiedAmount: bill.totalVerifiedAmount,
          totalApprovedAmount: bill.totalApprovedAmount,
          verifiedAmount: bill.verifiedAmount,
          approvedAmount: bill.approvedAmount,
          status: bill.status,
          auditLog: bill.auditLog,
          updatedAt: nowIso
        };

        if (useLocalFallback) {
          const data = loadLocalData();
          const idx = (data.bills || []).findIndex(b => b.id === id);
          if (idx !== -1) {
            data.bills[idx] = { ...data.bills[idx], ...updates };
            saveLocalData(data);
            return normalizeBillRecord(data.bills[idx]);
          }
          throw new Error('Bill not found');
        }

        const hasNativeCategories = await checkBillsTableNativeCategories();
        const updatesToPersist = { ...updates };
        if (!hasNativeCategories) {
          delete updatesToPersist.categories;
          delete updatesToPersist.totalVerifiedAmount;
          delete updatesToPersist.totalApprovedAmount;
          if (updatesToPersist.status === 'PARTIALLY_APPROVED') {
            updatesToPersist.status = 'PENDING_VERIFICATION';
          }
        }

        try {
          let query = supabase.from('bills').update(updatesToPersist).eq('id', id);
          if (rawBill.updatedAt && attempt < maxRetries) {
            query = query.eq('updatedAt', rawBill.updatedAt);
          }
          const { data, error } = await query.select().single();

          if (error) {
            if (error.code === 'PGRST116' && attempt < maxRetries) {
              await new Promise(res => setTimeout(res, 50 * attempt));
              continue;
            }
            throw error;
          }

          try {
            await this.addComment({
              employeeId: bill.employeeId,
              employeeName: bill.employeeName,
              sender: 'senior_admin',
              senderName: approvedBy || 'Senior Admin',
              message: `★ Bill Category Approved: ${cat.name || catName} approved for Rs. ${numApproved.toLocaleString()} (Bill: ${bill.billNumber})`
            });
          } catch (e) {}

          return normalizeBillRecord({
            ...data,
            categories: bill.categories,
            totalVerifiedAmount: bill.totalVerifiedAmount,
            totalApprovedAmount: bill.totalApprovedAmount,
            status: bill.status
          });
        } catch (err) {
          if (attempt === maxRetries || !isQuotaOrNetworkError(err)) {
            if (isQuotaOrNetworkError(err)) {
              useLocalFallback = true;
              const data = loadLocalData();
              const idx = (data.bills || []).findIndex(b => b.id === id);
              if (idx !== -1) {
                data.bills[idx] = { ...data.bills[idx], ...updates };
                saveLocalData(data);
                return normalizeBillRecord(data.bills[idx]);
              }
            }
            handleSupabaseError(err, 'approve bill category');
            throw err;
          }
        }
      }
    });
  },

  // Legacy Whole-Bill Verification (Backward Compatibility Batch)
  async verifyBill(id, { verifiedAmount, verificationComment = '', verifiedComment = '', verifiedBy = 'Admin' } = {}) {
    const rawBill = await this.getBillById(id);
    if (!rawBill) {
      const err = new Error('Bill not found.');
      err.status = 404;
      throw err;
    }
    const bill = normalizeBillRecord(rawBill);
    const numVerified = Number(verifiedAmount);
    if (isNaN(numVerified) || numVerified < 0) {
      const err = new Error('Verified amount must be a valid non-negative number.');
      err.status = 400;
      throw err;
    }
    if (numVerified > bill.totalClaimedAmount) {
      const err = new Error(`Verified amount (Rs. ${numVerified.toLocaleString()}) cannot exceed claimed amount (Rs. ${bill.totalClaimedAmount.toLocaleString()}).`);
      err.status = 400;
      throw err;
    }

    // Verify each active category up to claimed or proportionally
    const ratio = bill.totalClaimedAmount > 0 ? (numVerified / bill.totalClaimedAmount) : 1;
    let runningVerified = 0;
    const activeCats = BILL_EXPENSE_CATEGORIES.filter(c => bill.categories[c].claimedAmount > 0);
    for (let i = 0; i < activeCats.length; i++) {
      const catKey = activeCats[i];
      let catAmt = Math.round(bill.categories[catKey].claimedAmount * ratio);
      if (i === activeCats.length - 1) {
        catAmt = numVerified - runningVerified;
      } else {
        runningVerified += catAmt;
      }
      catAmt = Math.min(catAmt, bill.categories[catKey].claimedAmount);
      await this.verifyBillCategory(id, {
        category: catKey,
        verifiedAmount: Math.max(0, catAmt),
        verificationComment: verificationComment || verifiedComment || '',
        verifiedBy
      });
    }
    return this.getBillById(id);
  },

  // Legacy Whole-Bill Approval (Backward Compatibility Batch)
  async approveBill(id, { approvedAmount, approvalComment = '', approvedComment = '', approvedBy = 'Senior Admin' } = {}) {
    const rawBill = await this.getBillById(id);
    if (!rawBill) {
      const err = new Error('Bill not found.');
      err.status = 404;
      throw err;
    }
    const bill = normalizeBillRecord(rawBill);
    const numApproved = Number(approvedAmount);
    if (isNaN(numApproved) || numApproved < 0) {
      const err = new Error('Approved amount must be a valid non-negative number.');
      err.status = 400;
      throw err;
    }
    const maxAllowed = bill.totalVerifiedAmount !== null && bill.totalVerifiedAmount !== undefined ? bill.totalVerifiedAmount : bill.totalClaimedAmount;
    if (numApproved > maxAllowed) {
      const err = new Error(`Approved amount (Rs. ${numApproved.toLocaleString()}) cannot exceed verified amount (Rs. ${maxAllowed.toLocaleString()}).`);
      err.status = 400;
      throw err;
    }

    const ratio = maxAllowed > 0 ? (numApproved / maxAllowed) : 1;
    let runningApproved = 0;
    const verifiedCats = BILL_EXPENSE_CATEGORIES.filter(c => bill.categories[c].verificationStatus === 'VERIFIED');
    for (let i = 0; i < verifiedCats.length; i++) {
      const catKey = verifiedCats[i];
      let catAmt = Math.round(bill.categories[catKey].verifiedAmount * ratio);
      if (i === verifiedCats.length - 1) {
        catAmt = numApproved - runningApproved;
      } else {
        runningApproved += catAmt;
      }
      catAmt = Math.min(catAmt, bill.categories[catKey].verifiedAmount);
      await this.approveBillCategory(id, {
        category: catKey,
        approvedAmount: Math.max(0, catAmt),
        approvalComment: approvalComment || approvedComment || '',
        approvedBy
      });
    }
    return this.getBillById(id);
  },

  // Whole-Bill Rejection (Audited & Non-Destructive)
  async rejectBill(id, { rejectionReason = '', reason = '', rejectedBy = 'Admin' } = {}) {
    const rawBill = await this.getBillById(id);
    if (!rawBill) {
      const err = new Error('Bill not found.');
      err.status = 404;
      throw err;
    }
    const bill = normalizeBillRecord(rawBill);
    const reasonText = (rejectionReason || reason || 'Rejected by Admin').trim();

    // Reject all active categories
    const activeCats = BILL_EXPENSE_CATEGORIES.filter(c => bill.categories[c].claimedAmount > 0);
    for (const catKey of activeCats) {
      await this.rejectBillCategory(id, {
        category: catKey,
        rejectionReason: reasonText,
        rejectedBy,
        stage: 'verification'
      });
    }

    const nowIso = new Date().toISOString();
    const currentBill = await this.getBillById(id);
    const existingLog = Array.isArray(currentBill.auditLog) ? currentBill.auditLog : [];
    const auditLog = [...existingLog, {
      action: 'REJECTED',
      by: rejectedBy || 'Admin',
      at: nowIso,
      details: {
        reason: reasonText,
        billStatus: 'REJECTED'
      }
    }];

    const updates = {
      rejectedBy,
      rejectedAt: nowIso,
      rejectionReason: reasonText,
      status: 'REJECTED',
      auditLog,
      updatedAt: nowIso
    };
    if (useLocalFallback) {
      const data = loadLocalData();
      const idx = (data.bills || []).findIndex(b => b.id === id);
      if (idx !== -1) {
        data.bills[idx] = { ...data.bills[idx], ...updates };
        saveLocalData(data);
      }
    } else {
      await supabase.from('bills').update(updates).eq('id', id);
    }
    const finalBill = await this.getBillById(id);
    return finalBill.bill || finalBill;
  },

  // Bill Statistics
  async getBillStats() {
    const rawBills = await this.getBills();
    const bills = (rawBills || []).map(b => normalizeBillRecord(b));
    const totalBills = bills.length;
    let pendingVerification = 0;
    let partiallyVerified = 0;
    let verified = 0;
    let partiallyApproved = 0;
    let approved = 0;
    let rejected = 0;
    let totalClaimedAmount = 0;
    let totalVerifiedAmount = 0;
    let totalApprovedAmount = 0;

    bills.forEach(b => {
      totalClaimedAmount += (Number(b.totalClaimedAmount) || 0);
      totalVerifiedAmount += (Number(b.totalVerifiedAmount) || 0);
      totalApprovedAmount += (Number(b.totalApprovedAmount) || 0);

      if (b.status === 'SUBMITTED' || b.status === 'PENDING_VERIFICATION') pendingVerification++;
      else if (b.status === 'PARTIALLY_VERIFIED') partiallyVerified++;
      else if (b.status === 'VERIFIED') verified++;
      else if (b.status === 'PARTIALLY_APPROVED') partiallyApproved++;
      else if (b.status === 'APPROVED') approved++;
      else if (b.status === 'REJECTED') rejected++;
    });

    return {
      totalBills,
      pendingVerification: pendingVerification + partiallyVerified,
      pendingVerificationCount: pendingVerification + partiallyVerified,
      partiallyVerified,
      partiallyVerifiedCount: partiallyVerified,
      verified,
      verifiedCount: verified,
      partiallyApproved,
      partiallyApprovedCount: partiallyApproved,
      approved,
      approvedCount: approved,
      rejected,
      rejectedCount: rejected,
      totalClaimedAmount,
      totalVerifiedAmount,
      totalApprovedAmount
    };
  },
};

const BILL_EXPENSE_CATEGORIES = ['transportation', 'material', 'labour', 'accommodation', 'other'];

let billsTableHasNativeCategories = null;
async function checkBillsTableNativeCategories() {
  if (billsTableHasNativeCategories !== null) return billsTableHasNativeCategories;
  if (!supabase || useLocalFallback) {
    billsTableHasNativeCategories = true;
    return true;
  }
  try {
    const { error } = await supabase.from('bills').select('categories').limit(1);
    if (error && (error.message?.includes('categories') || error.code === 'PGRST204' || error.message?.includes('schema cache'))) {
      billsTableHasNativeCategories = false;
    } else {
      billsTableHasNativeCategories = true;
    }
  } catch (e) {
    billsTableHasNativeCategories = false;
  }
  return billsTableHasNativeCategories;
}

function computeBillTotalsAndStatus(categories, currentOverallStatus) {
  let totalClaimed = 0;
  let totalVerified = 0;
  let totalApproved = 0;
  let hasAnyVerified = false;
  let hasAnyApproved = false;

  let activeCount = 0;
  let verifiedCount = 0;
  let approvedCount = 0;
  let rejectedAtVerificationCount = 0;
  let rejectedAtApprovalCount = 0;

  BILL_EXPENSE_CATEGORIES.forEach(c => {
    const cat = categories[c];
    if (!cat) return;
    const claimed = Math.max(0, Number(cat.claimedAmount) || 0);
    totalClaimed += claimed;

    if (claimed > 0) {
      activeCount++;

      if (cat.verificationStatus === 'REJECTED') {
        rejectedAtVerificationCount++;
      } else if (cat.verificationStatus === 'VERIFIED') {
        verifiedCount++;
        const vAmt = Math.max(0, Number(cat.verifiedAmount) || 0);
        totalVerified += vAmt;
        hasAnyVerified = true;

        if (cat.approvalStatus === 'REJECTED') {
          rejectedAtApprovalCount++;
        } else if (cat.approvalStatus === 'APPROVED') {
          approvedCount++;
          const aAmt = Math.max(0, Number(cat.approvedAmount) || 0);
          totalApproved += aAmt;
          hasAnyApproved = true;
        }
      }
    }
  });

  if (currentOverallStatus === 'REJECTED' && approvedCount === 0 && verifiedCount === 0) {
    return {
      totalClaimedAmount: totalClaimed,
      totalVerifiedAmount: 0,
      totalApprovedAmount: 0,
      status: 'REJECTED'
    };
  }

  const resolvedVerificationCount = verifiedCount + rejectedAtVerificationCount;
  let status = 'SUBMITTED';

  if (activeCount > 0 && rejectedAtVerificationCount === activeCount) {
    // Case E: All active categories are rejected and none is approved
    status = 'REJECTED';
  } else if (activeCount > 0 && resolvedVerificationCount === activeCount) {
    // All active categories are resolved at verification stage (either VERIFIED or REJECTED)
    const resolvedApprovalCount = approvedCount + rejectedAtApprovalCount;
    if (verifiedCount > 0 && approvedCount === verifiedCount) {
      // Case A: All verified categories are APPROVED (and at least 1 is approved)
      status = 'APPROVED';
    } else if (approvedCount > 0) {
      // Case B: Some categories are APPROVED and some are still pending
      status = 'PARTIALLY_APPROVED';
    } else if (verifiedCount > 0 && resolvedApprovalCount === verifiedCount && approvedCount === 0) {
      // All verified categories were rejected during approval
      status = 'REJECTED';
    } else {
      // Case C: All active categories are VERIFIED or REJECTED, but no category has been approved yet
      status = 'VERIFIED';
    }
  } else if (resolvedVerificationCount > 0) {
    // Case D: Some categories are verified/rejected but others are still pending verification
    status = 'PARTIALLY_VERIFIED';
  } else {
    status = 'SUBMITTED';
  }

  return {
    totalClaimedAmount: totalClaimed,
    totalVerifiedAmount: hasAnyVerified ? totalVerified : 0,
    totalApprovedAmount: hasAnyApproved ? totalApproved : 0,
    status
  };
}

function normalizeBillRecord(bill) {
  if (!bill) return null;
  const b = { ...bill };
  const billDate = b.billDate || b.date || (b.createdAt ? b.createdAt.split('T')[0] : getLocalDateString());
  b.date = billDate;
  b.billDate = billDate;

  const transportationExpense = Math.max(0, Number(b.transportationExpense) || 0);
  const materialExpense = Math.max(0, Number(b.materialExpense) || 0);
  const labourExpense = Math.max(0, Number(b.labourExpense) || 0);
  const accommodationExpense = Math.max(0, Number(b.accommodationExpense) || 0);
  const otherExpense = Math.max(0, Number(b.otherExpense) || 0);

  b.transportationExpense = transportationExpense;
  b.materialExpense = materialExpense;
  b.labourExpense = labourExpense;
  b.accommodationExpense = accommodationExpense;
  b.otherExpense = otherExpense;

  const claimMap = {
    transportation: transportationExpense,
    material: materialExpense,
    labour: labourExpense,
    accommodation: accommodationExpense,
    other: otherExpense
  };

  let categories = b.categories;
  if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
    if (Array.isArray(b.auditLog) && b.auditLog.length > 0) {
      const auditWithCats = b.auditLog.slice().reverse().find(entry => entry && entry.details && entry.details.categories);
      if (auditWithCats && auditWithCats.details && auditWithCats.details.categories) {
        categories = JSON.parse(JSON.stringify(auditWithCats.details.categories));
      }
    }
  }

  if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
    categories = {};
    const isLegacyVerified = b.status === 'VERIFIED' || b.status === 'APPROVED';
    const isLegacyApproved = b.status === 'APPROVED';
    const isLegacyRejected = b.status === 'REJECTED';

    BILL_EXPENSE_CATEGORIES.forEach(cat => {
      const claimed = claimMap[cat];
      if (claimed === 0) {
        categories[cat] = {
          claimedAmount: 0,
          verifiedAmount: 0,
          approvedAmount: 0,
          verificationStatus: 'N/A',
          approvalStatus: 'N/A',
          verificationComment: '',
          approvalComment: '',
          verifiedBy: null,
          verifiedAt: null,
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: ''
        };
      } else if (isLegacyRejected) {
        categories[cat] = {
          claimedAmount: claimed,
          verifiedAmount: 0,
          approvedAmount: 0,
          verificationStatus: 'REJECTED',
          approvalStatus: 'REJECTED',
          verificationComment: '',
          approvalComment: '',
          verifiedBy: null,
          verifiedAt: null,
          approvedBy: null,
          approvedAt: null,
          rejectedBy: b.rejectedBy || 'Admin',
          rejectedAt: b.rejectedAt || b.updatedAt,
          rejectionReason: b.rejectionReason || 'Legacy bill rejection'
        };
      } else {
        categories[cat] = {
          claimedAmount: claimed,
          verifiedAmount: isLegacyVerified ? claimed : null,
          approvedAmount: isLegacyApproved ? claimed : null,
          verificationStatus: isLegacyVerified ? 'VERIFIED' : 'PENDING',
          approvalStatus: isLegacyApproved ? 'APPROVED' : 'PENDING',
          verificationComment: isLegacyVerified ? (b.verificationComment || b.verifiedComment || '') : '',
          approvalComment: isLegacyApproved ? (b.approvalComment || b.approvedComment || '') : '',
          verifiedBy: isLegacyVerified ? (b.verifiedBy || 'Admin') : null,
          verifiedAt: isLegacyVerified ? (b.verifiedAt || b.updatedAt) : null,
          approvedBy: isLegacyApproved ? (b.approvedBy || 'Senior Admin') : null,
          approvedAt: isLegacyApproved ? (b.approvedAt || b.updatedAt) : null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: ''
        };
      }
    });
  } else {
    // Backfill missing fields while preserving existing claims and states
    const existing = { ...categories };
    categories = {};
    BILL_EXPENSE_CATEGORIES.forEach(cat => {
      const claimed = claimMap[cat];
      if (existing[cat]) {
        const item = { ...existing[cat] };
        item.claimedAmount = claimed; // Preserved original claim
        if (claimed === 0) {
          item.verificationStatus = 'N/A';
          item.approvalStatus = 'N/A';
          item.verifiedAmount = 0;
          item.approvedAmount = 0;
        } else {
          item.verificationStatus = item.verificationStatus || 'PENDING';
          item.approvalStatus = item.approvalStatus || 'PENDING';
        }
        categories[cat] = item;
      } else {
        categories[cat] = {
          claimedAmount: claimed,
          verifiedAmount: claimed === 0 ? 0 : null,
          approvedAmount: claimed === 0 ? 0 : null,
          verificationStatus: claimed === 0 ? 'N/A' : 'PENDING',
          approvalStatus: claimed === 0 ? 'N/A' : 'PENDING',
          verificationComment: '',
          approvalComment: '',
          verifiedBy: null,
          verifiedAt: null,
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: ''
        };
      }
    });
  }

  BILL_EXPENSE_CATEGORIES.forEach(cat => {
    const c = categories[cat];
    if (c) {
      if (!c.name) c.name = cat.charAt(0).toUpperCase() + cat.slice(1);
      if (!c.status) {
        if (c.claimedAmount === 0) c.status = 'N/A';
        else if (c.approvalStatus === 'APPROVED') c.status = 'APPROVED';
        else if (c.verificationStatus === 'REJECTED' || c.approvalStatus === 'REJECTED') c.status = 'REJECTED';
        else if (c.verificationStatus === 'VERIFIED') c.status = 'VERIFIED';
        else c.status = 'SUBMITTED';
      }
    }
  });

  b.categories = categories;

  const calc = computeBillTotalsAndStatus(categories, b.status);
  b.totalClaimedAmount = calc.totalClaimedAmount;
  b.totalAmount = calc.totalClaimedAmount;
  b.totalVerifiedAmount = calc.totalVerifiedAmount;
  b.totalApprovedAmount = calc.totalApprovedAmount;
  b.verifiedAmount = calc.totalVerifiedAmount;
  b.approvedAmount = calc.totalApprovedAmount;
  b.status = calc.status;

  return b;
}

// Global Concurrency Mutex for safe sequential operations
let _billLock = Promise.resolve();
function withBillLock(fn) {
  const next = _billLock.then(() => fn(), () => fn());
  _billLock = next;
  return next;
}

function sanitizeAccountsPdfForClient(record) {
  if (!record) return null;
  const clone = JSON.parse(JSON.stringify(record));
  delete clone.pdfData;
  if (Array.isArray(clone.pdfs)) {
    clone.pdfs.forEach(p => {
      delete p.pdfData;
    });
  }
  return clone;
}

module.exports = db;