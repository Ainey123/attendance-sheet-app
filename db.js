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
        `
      });
      if (rpcError) {
        console.log('Auto-migration via rpc not available (safe to ignore):', rpcError.message);
      } else {
        console.log('Auto-migration: status constraint removed, isArchived column ensured.');
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
        settings: file.settings || { adminPasscode: '1234', officeName: 'My Office' },
        formSubmissions: file.formSubmissions || [],
        employeeEvaluations: file.employeeEvaluations || []
      };
    }
  } catch (e) {}
  return { employees: [], attendance: [], workRecords: [], workProfiles: {}, settings: { adminPasscode: '1234', officeName: 'My Office' }, formSubmissions: [], employeeEvaluations: [] };
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

// Format date to local YYYY-MM-DD
function getLocalDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
  return adjustedDate.toISOString().split('T')[0];
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
      emps = includeArchived ? emps : emps.filter(e => e.status !== 'DELETED' && !e.isArchived && (!e.token || !e.token.startsWith('EXPIRED_')));
      for (let i = 0; i < emps.length; i++) {
        emps[i] = await this.checkAndUpdateLinkCycle(emps[i]);
      }
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
        list = list.filter(e => e.status !== 'DELETED' && !e.isArchived && (!e.token || !e.token.startsWith('EXPIRED_')));
      }
      for (let i = 0; i < list.length; i++) {
        list[i] = await this.checkAndUpdateLinkCycle(list[i]);
      }
      return list;
    } catch (error) {
      handleSupabaseError(error, 'fetch employees');
    }
  },

  async getEmployeeByToken(token) {
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
      return data.settings || { adminPasscode: '1234', officeName: 'My Office' };
    }
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .single();
      if (error || !data) {
        return { adminPasscode: '1234', officeName: 'My Office' };
      }
      return data;
    } catch (error) {
      return { adminPasscode: '1234', officeName: 'My Office' };
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
    if (useLocalFallback) {
      const data = loadLocalData();
      const today = getLocalDateString();
      const records = (data.attendance || [])
        .filter(r => r.employeeId === employeeId && r.date === today)
        .sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
      
      if (records.length === 0) return null;
      const leaveRecord = records.find(isLeaveAttendanceRecord);
      if (leaveRecord) return leaveRecord;
      return records.find(r => !r.clockOutTime) || records[0];
    }
    try {
      const today = getLocalDateString();
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('date', today)
        .order('clockInTime', { ascending: false });

      if (error) return null;
      if (!data || data.length === 0) return null;

      const leaveRecord = data.find(isLeaveAttendanceRecord);
      if (leaveRecord) return leaveRecord;
      const active = data.find(r => !r.clockOutTime);
      if (active) return active;
      return data[0];
    } catch (error) {
      return null;
    }
  },

  async clockIn(employeeId, location) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      throw new Error('Please turn on location first');
    }
    if (useLocalFallback) {
      const data = loadLocalData();
      const employee = data.employees.find(e => e.id === employeeId);
      if (!employee) throw new Error('Employee not found');

      const now = new Date();
      const today = getLocalDateString(now);
      const todayRecords = data.attendance.filter(r => r.employeeId === employeeId && r.date === today);
      if (todayRecords.some(isLeaveAttendanceRecord)) {
        throw new Error('Employee has a leave request for today');
      }
      const activeRecord = data.attendance.find(r => r.employeeId === employeeId && !r.clockOutTime);
      if (activeRecord) throw new Error('Employee is already clocked in');

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

      const now = new Date();
      const today = getLocalDateString(now);
      const { data: todayRecords, error: todayError } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('date', today);

      if (todayError) throw todayError;
      if (todayRecords?.some(isLeaveAttendanceRecord)) {
        throw new Error('Employee has a leave request for today');
      }

      const { data: activeRecord } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .is('clockOutTime', null)
        .single();

      if (activeRecord) throw new Error('Employee is already clocked in');

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
    if (useLocalFallback) {
      const data = loadLocalData();
      const employee = data.employees.find(e => e.id === employeeId);
      if (!employee) throw new Error('Employee not found');

      const today = getLocalDateString();
      const record = data.attendance.find(r => r.employeeId === employeeId && r.date === today && !r.clockOutTime);
      if (!record) throw new Error('Employee is not clocked in');

      const now = new Date();
      const inTime = new Date(record.clockInTime);
      const duration = Math.round((now - inTime) / (1000 * 60));

      Object.assign(record, {
        clockOutTime: now.toISOString(),
        clockOutLocation: location || null,
        duration,
        performanceNotes,
        receivedAmount: Number(receivedAmount) || 0,
        expenseAmount: Number(expenseAmount) || 0,
        moneySpent: Number(expenseAmount) || 0,
        image: image || null
      });

      employee.status = 'OUT';

      // Auto-create work record
      const monthStr = today.substring(0, 7);
      if (!data.workRecords.find(w => w.employeeId === employeeId && w.date === today)) {
        data.workRecords.push({
          id: generateId('wr'),
          employeeId,
          employeeName: employee.name,
          month: monthStr,
          date: today,
          performedWork: performanceNotes,
          receivedAmount: Number(receivedAmount) || 0,
          expenseAmount: Number(expenseAmount) || 0,
          paymentIssuance: Number(receivedAmount) || 0,
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

      const today = getLocalDateString();
      const { data: record, error: recordError } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .is('clockOutTime', null)
        .single();

      if (recordError || !record) throw new Error('Employee is not clocked in');

      const now = new Date();
      const inTime = new Date(record.clockInTime);
      const duration = Math.round((now - inTime) / (1000 * 60));

      const { data: updatedRecord, error: updateError } = await supabase
        .from('attendance')
        .update({
          clockOutTime: now.toISOString(),
          clockOutLocation: location || null,
          duration,
          performanceNotes,
          receivedAmount: Number(receivedAmount) || 0,
          expenseAmount: Number(expenseAmount) || 0,
          moneySpent: Number(expenseAmount) || 0,
          image: image || null
        })
        .eq('id', record.id)
        .select()
        .single();

      if (updateError) handleSupabaseError(updateError, 'clock out');

      const { data: updatedEmployee, error: empUpdateError } = await supabase
        .from('employees')
        .update({ status: 'OUT' })
        .eq('id', employeeId)
        .select()
        .single();

      if (empUpdateError) handleSupabaseError(empUpdateError, 'update employee status');
      return { record: updatedRecord, employee: updatedEmployee };
    } catch (error) {
      handleSupabaseError(error, 'clock out');
    }
  },

  async getDashboardStats() {
    const today = getLocalDateString();
    const activeEmployees = await this.getEmployees(false);
    const activeEmpIds = new Set(activeEmployees.map(e => e.id));

    let attendanceLogs = [];
    let officeName = 'My Office';

    if (useLocalFallback) {
      const data = loadLocalData();
      attendanceLogs = (data.attendance || []).filter(a => a.date === today && activeEmpIds.has(a.employeeId));
      officeName = data.settings?.officeName || 'My Office';
    } else {
      try {
        const { data: attendance } = await supabase.from('attendance').select('employeeId').eq('date', today);
        if (attendance) {
          attendanceLogs = attendance.filter(a => activeEmpIds.has(a.employeeId));
        }
        const { data: settings } = await supabase.from('settings').select('officeName').single();
        if (settings && settings.officeName) officeName = settings.officeName;
      } catch (error) {
        console.warn('Error fetching Supabase dashboard stats details:', error.message);
      }
    }

    const totalEmployees = activeEmployees.length;
    const activePresent = activeEmployees.filter(e => e.status === 'IN').length;
    const presentToday = new Set(attendanceLogs.map(r => r.employeeId)).size;
    const absentToday = Math.max(0, totalEmployees - presentToday);

    return {
      totalEmployees,
      activePresent,
      presentToday,
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
      return records.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    }
    try {
      let query = supabase.from('form_submissions').select('*').order('submittedAt', { ascending: false });
      if (employeeId) query = query.eq('employeeId', employeeId);
      if (formType) query = query.eq('formType', formType);

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

  async getMonthlySummary(monthStr) {
    if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
      const now = new Date();
      monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [yearStr, mStr] = monthStr.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(mStr, 10);
    const totalDaysInMonth = new Date(year, monthNum, 0).getDate();

    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let daysToEvaluate = totalDaysInMonth;
    if (monthStr === currentMonthStr) {
      daysToEvaluate = now.getDate();
    }
    const daysEvaluated = daysToEvaluate;

    // Count Sundays in evaluated period
    let sundaysInEvaluatedPeriod = 0;
    for (let d = 1; d <= daysToEvaluate; d++) {
      const dt = new Date(year, monthNum - 1, d);
      if (dt.getDay() === 0) sundaysInEvaluatedPeriod++;
    }
    const workingDaysToEvaluate = Math.max(0, daysToEvaluate - sundaysInEvaluatedPeriod);

    const allEmployees = await this.getEmployees(true);
    const allAttendance = await this.getAttendance();
    const monthLogs = (allAttendance || []).filter(a => a.date && a.date.startsWith(monthStr));
    
    let workRecords = [];
    try {
      workRecords = await this.getWorkRecords(null, monthStr);
    } catch (e) {
      workRecords = [];
    }

    const summaryMap = new Map();

    (allEmployees || []).forEach(emp => {
      summaryMap.set(emp.id, {
        employeeId: emp.id,
        employeeName: emp.name,
        role: emp.role || 'Staff',
        isArchived: emp.status === 'DELETED' || Boolean(emp.isArchived),
        minusScore: emp.minusScore || 0,
        linkExpireCount: emp.linkExpireCount || 0,
        presentDates: new Set(),
        leaveDates: new Set(),
        workDoneDetails: [],
        totalExpensesAdded: 0
      });
    });

    monthLogs.forEach(log => {
      let empSummary = summaryMap.get(log.employeeId);
      if (!empSummary) {
        empSummary = {
          employeeId: log.employeeId || 'emp_' + String(log.employeeName).toLowerCase().replace(/\s+/g, ''),
          employeeName: log.employeeName || 'Staff Member',
          role: log.role || 'Staff',
          isArchived: true,
          presentDates: new Set(),
          leaveDates: new Set(),
          workDoneDetails: [],
          totalExpensesAdded: 0
        };
        summaryMap.set(empSummary.employeeId, empSummary);
      }

      const isLeave = isLeaveAttendanceRecord(log);
      if (isLeave) {
        empSummary.leaveDates.add(log.date);
      } else {
        empSummary.presentDates.add(log.date);
      }

      if (log.expenseAmount && !isNaN(Number(log.expenseAmount))) {
        empSummary.totalExpensesAdded += Number(log.expenseAmount);
      }
      if (log.performanceNotes && !isLeave) {
        empSummary.workDoneDetails.push(log.performanceNotes.trim());
      }
    });

    (workRecords || []).forEach(wr => {
      let empSummary = summaryMap.get(wr.employeeId);
      if (!empSummary) {
        empSummary = {
          employeeId: wr.employeeId || 'emp_' + String(wr.employeeName).toLowerCase().replace(/\s+/g, ''),
          employeeName: wr.employeeName || 'Staff Member',
          role: 'Staff',
          isArchived: true,
          presentDates: new Set(),
          leaveDates: new Set(),
          workDoneDetails: [],
          totalExpensesAdded: 0
        };
        summaryMap.set(empSummary.employeeId, empSummary);
      }

      if (wr.performedWork && wr.performedWork.trim() !== '') {
        empSummary.workDoneDetails.push(wr.performedWork.trim());
      }
      if (wr.expenseAmount && !isNaN(Number(wr.expenseAmount))) {
        empSummary.totalExpensesAdded += Number(wr.expenseAmount);
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
      const missingAttendance = Math.max(0, workingDaysToEvaluate - regularPresentCount - regularLeaveCount);
      const workDoneCount = emp.workDoneDetails.length;

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
          totalDaysInMonth,
          daysEvaluated,
          sundaysInEvaluatedPeriod,
          workingDaysToEvaluate,
          totalAttendance,
          sundayPresentCount,
          missingAttendance,
          leaveDays,
          totalWorkDone: workDoneCount > 0 ? `${workDoneCount} Work Items` : '0 Work Items',
          totalWorkDoneCount: workDoneCount,
          workDoneSummary: emp.workDoneDetails.length > 0 ? emp.workDoneDetails.slice(0, 3).join('; ') : 'None',
          totalExpensesAdded: Math.round(emp.totalExpensesAdded)
        });
      }
    });

    return {
      month: monthStr,
      daysInMonth: totalDaysInMonth,
      daysEvaluated,
      sundaysInEvaluatedPeriod,
      workingDaysToEvaluate,
      summaries
    };
  }
};

module.exports = db;