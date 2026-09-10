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

// Check if Supabase is configured
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Using Supabase database for persistent storage');

  // Auto-migrate: remove the status CHECK constraint so soft-delete works
  // and add isArchived column if missing. Uses raw SQL via rpc if available.
  (async () => {
    try {
      // Use supabase.rpc if the project has the exec_sql function,
      // otherwise fall back to individual update probing.
      // We run a benign update first — if it fails with constraint error we know
      // the fix is needed and we apply via the REST alter approach.
      // Note: Supabase anon key cannot run DDL directly; we run it via rpc 'exec_sql'
      // which must exist. If not available, the fallback in deleteEmployee handles it.
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
        `
      });
      if (rpcError) {
        console.log('Auto-migration via rpc not available (safe to ignore):', rpcError.message);
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
        expenseVerifications: file.expenseVerifications || []
      };
    }
  } catch (e) {}
  return { employees: [], attendance: [], workRecords: [], workProfiles: {}, settings: { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' }, formSubmissions: [], employeeEvaluations: [], comments: [], salaries: [], accountsPdfs: [], salaryApprovals: [], expenseVerifications: [] };
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

// Helper function to handle Supabase errors
function handleSupabaseError(error, operation) {
  console.error(`Database error during ${operation}:`, error.message);
  throw new Error(`Failed to ${operation}: ${error.message}`);
}

const db = {
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
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .single();
      if (error || !data) {
        return { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' };
      }
      return {
        ...data,
        seniorAdminPasscode: data.seniorAdminPasscode || '9999'
      };
    } catch (error) {
      return { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' };
    }
  },

  async updateSettings(newSettings) {
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
      if (filterDate) records = records.filter(r => r.date === filterDate);
      return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
    }
    try {
      let query = supabase
        .from('attendance')
        .select('*')
        .order('clockInTime', { ascending: false });

      if (filterDate) query = query.eq('date', filterDate);

      const { data, error } = await query;
      if (error) handleSupabaseError(error, 'fetch attendance');
      return data || [];
    } catch (error) {
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

      // 1. Check for active unclosed record for this employee (regardless of whether it started today or yesterday)
      const { data: activeRecords } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .is('clockOutTime', null)
        .order('clockInTime', { ascending: false })
        .limit(1);

      let record = activeRecords && activeRecords.length > 0 ? activeRecords[0] : null;

      if (!record) {
        // 2. Fall back to any completed record today to update
        const { data: completedRecords } = await supabase
          .from('attendance')
          .select('*')
          .eq('employeeId', employeeId)
          .eq('date', today)
          .order('clockInTime', { ascending: false })
          .limit(1);

        if (completedRecords && completedRecords.length > 0) {
          record = completedRecords[0];
        }
      }

      let updatedRecord;
      if (record) {
        const inTime = new Date(record.clockInTime || now);
        const duration = Math.max(0, Math.round((now - inTime) / (1000 * 60)));
        const { data: upd, error: updateError } = await supabase
          .from('attendance')
          .update({
            clockOutTime: now.toISOString(),
            clockOutLocation: location || record.clockOutLocation || null,
            duration,
            performanceNotes: finalNotes || record.performanceNotes || 'Shift Completed',
            receivedAmount: finalReceived,
            expenseAmount: finalExpense,
            moneySpent: finalExpense,
            image: image || record.image || null
          })
          .eq('id', record.id)
          .select()
          .single();

        if (updateError) handleSupabaseError(updateError, 'update attendance record on clock out');
        updatedRecord = upd;
      } else {
        // 3. Create fresh completed record if none existed today
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
            .eq('date', today)
            .limit(1);

          if (wrs && wrs.length > 0) {
            await supabase.from('work_records').update({
              performedWork: finalNotes,
              receivedAmount: finalReceived,
              expenseAmount: finalExpense,
              paymentIssuance: finalReceived
            }).eq('id', wrs[0].id);
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

      // Supabase: find unclosed records
      let query = supabase
        .from('attendance')
        .select('*')
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
        const { data: attendance } = await supabase.from('attendance').select('*').eq('date', today);
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
      else records = records.filter(r => r.formType !== 'manual_present_days');
      return records.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    }
    try {
      let query = supabase.from('form_submissions').select('*').order('submittedAt', { ascending: false });
      if (employeeId) query = query.eq('employeeId', employeeId);
      if (formType) query = query.eq('formType', formType);
      else query = query.neq('formType', 'manual_present_days');

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

    if (useLocalFallback) {
      const data = loadLocalData();
      const subs = data.formSubmissions || [];
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
      if (error) {
        console.warn('Supabase fetch comments error:', error.message);
        // If table doesn't exist, try to create it via RPC
        if (error.message && (error.message.includes('does not exist') || error.message.includes('relation') || error.code === '42P01')) {
          try {
            await supabase.rpc('exec_sql', {
              sql: `CREATE TABLE IF NOT EXISTS comments (
                "id" TEXT PRIMARY KEY,
                "employeeId" TEXT NOT NULL,
                "employeeName" TEXT NOT NULL,
                "sender" TEXT NOT NULL,
                "senderName" TEXT NOT NULL,
                "message" TEXT NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "isRead" BOOLEAN DEFAULT TRUE
              );
              ALTER TABLE comments ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN DEFAULT TRUE;`
            });
            console.log('comments table created via fallback RPC');
          } catch (rpcErr) {
            console.warn('Could not auto-create comments table:', rpcErr.message);
          }
        }
        // Always fall through to local fallback on error
        const dataLocal = loadLocalData();
        let list = dataLocal.comments || [];
        if (employeeId) list = list.filter(c => c.employeeId === employeeId);
        return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
      return data || [];
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

    // Separate regular days vs Sunday days worked
    let regularPresentDays = 0;
    let sundayPresentDays = 0;
    presentDates.forEach(dateStr => {
      const parts = dateStr.split('-');
      const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      if (dt.getDay() === 0) sundayPresentDays++;
      else regularPresentDays++;
    });

    const autoTotalDays = regularPresentDays + sundayPresentDays;

    // Check for manual present days override
    let manualOverrides = {};
    try {
      manualOverrides = await this.getManualPresentDays(month);
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

    // FORMULA: Per Day = Basic ÷ 30 (fixed 30-day divisor per office policy)
    const perDaySalary = basicSalary > 0 ? Math.round(basicSalary / 30) : 0;

    // Regular earned = per day × regular weekday present days
    const regularEarned = perDaySalary * effectiveRegularDays;

    // Sunday bonus = per day × Sunday days worked
    const sundayBonus = perDaySalary * effectiveSundayDays;

    // Total earned salary
    const earnedSalary = perDaySalary * effectivePresentDays;

    // Net salary = earned − expenses (expenses recorded at clock-out are deducted)
    const netSalary = earnedSalary - Math.round(totalExpenses);

    Object.assign(salRec, {
      employeeName: emp ? emp.name : salRec.employeeName,
      role: emp ? (emp.role || 'Staff') : salRec.role,
      totalDaysInMonth,
      workingDays: 30,           // fixed 30-day divisor
      regularPresentDays: effectiveRegularDays,
      sundayPresentDays: effectiveSundayDays,
      presentDays: effectivePresentDays,
      autoPresentDays: autoTotalDays,
      isManualPresentDays: isManual,
      manualPresentDays: isManual ? override.manualPresentDays : null,
      editedBy: isManual ? override.editedBy : null,
      editedAt: isManual ? override.editedAt : null,
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
    
    const [allAttendance, allWorkRecords, employees] = await Promise.all([
      this.getAttendance().catch(() => []),
      this.getWorkRecords(null, month).catch(() => []),
      this.getEmployees(true).catch(() => [])
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
            source: 'Work Record'
          });
        }
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

    const [employees, allAttendance, workRecords, rawSalaries, accountsPdf, approvals, verifications, settings, manualOverrides] = await Promise.all([
      this.getEmployees(false),
      this.getAttendance().catch(() => []),
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
      this.getManualPresentDays(month).catch(() => ({}))
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
      presentDates.forEach(dateStr => {
        const parts = dateStr.split('-');
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
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
      const perDaySalary = basicSalary > 0 ? Math.round(basicSalary / 30) : 0;
      const regularEarned = perDaySalary * effectiveRegularDays;
      const sundayBonus = perDaySalary * effectiveSundayDays;
      const earnedSalary = perDaySalary * effectivePresentDays;

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

      itemizedExpenses.sort((a, b) => a.date.localeCompare(b.date));
      const totalExpenses = itemizedExpenses.reduce((sum, e) => sum + e.amount, 0);

      // Two-level verification: Admin 1 Verification & Senior Admin Approval
      const expVer = verificationsMap[empId] || null;
      const appr = approvalsMap[empId] || null;

      const isExpVerified = Boolean(expVer && (expVer.verificationStatus === 'VERIFIED' || (expVer.verifiedAmount !== null && expVer.verifiedAmount !== undefined)));
      const verifiedAmount = isExpVerified ? Number(expVer.verifiedAmount) : null;
      const verifiedBy = isExpVerified ? (expVer.verifiedBy || 'Admin 1') : null;
      const verifiedAt = isExpVerified ? expVer.verifiedAt : null;

      const isExpApproved = Boolean((expVer && (expVer.approvalStatus === 'APPROVED' || (expVer.approvedAmount !== null && expVer.approvedAmount !== undefined))) || (appr && appr.approvalStatus === 'APPROVED'));
      const approvedAmount = (expVer && expVer.approvedAmount !== null && expVer.approvedAmount !== undefined) ? Number(expVer.approvedAmount) : (appr ? Number(appr.approvedAmount) : null);
      const approvedBy = isExpApproved ? (expVer?.approvedBy || appr?.approvedBy || 'Senior Admin') : null;
      const approvedAt = isExpApproved ? (expVer?.approvedAt || appr?.approvedAt) : null;

      let effectiveExpense = totalExpenses;
      if (isExpApproved && approvedAmount !== null) {
        effectiveExpense = approvedAmount;
      } else if (isExpVerified && verifiedAmount !== null) {
        effectiveExpense = verifiedAmount;
      }

      const netSalary = earnedSalary - Math.round(effectiveExpense);

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
        presentDays: effectivePresentDays,
        autoPresentDays: autoTotalDays,
        isManualPresentDays,
        manualPresentDays: isManualPresentDays ? override.manualPresentDays : null,
        editedBy: override ? override.editedBy : null,
        editedAt: override ? override.editedAt : null,
        perDaySalary,
        regularEarned,
        sundayBonus,
        earnedSalary,
        itemizedExpenses,
        totalExpenses,
        isExpVerified,
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
        totalBaseSalary,
        totalEarnedSalary,
        totalClaimedExpenses,
        totalEffectiveExpenses,
        totalNetSalary,
        totalBankCredits,
        totalVerifiedCount,
        totalApprovedCount
      },
      employees: employeeReports
    };
  }
};

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