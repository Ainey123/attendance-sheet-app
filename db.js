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
  async getEmployees() {
    if (useLocalFallback) {
      const data = loadLocalData();
      return data.employees || [];
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('dateCreated', { ascending: false });
      if (error) handleSupabaseError(error, 'fetch employees');
      return data || [];
    } catch (error) {
      handleSupabaseError(error, 'fetch employees');
    }
  },

  async getEmployeeByToken(token) {
    if (useLocalFallback) {
      const data = loadLocalData();
      return data.employees.find(e => e.token === token) || null;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('token', token)
        .single();
      if (error) return null;
      return data;
    } catch (error) {
      return null;
    }
  },

  async addEmployee(name, role) {
    if (useLocalFallback) {
      const data = loadLocalData();
      const newEmployee = {
        id: generateId('emp'),
        name: name.trim(),
        role: role.trim() || 'Staff',
        status: 'OUT',
        pin: '1234',
        token: generateToken(),
        dateCreated: new Date().toISOString()
      };
      data.employees.push(newEmployee);
      saveLocalData(data);
      return newEmployee;
    }
    try {
      const newEmployee = {
        id: generateId('emp'),
        name: name.trim(),
        role: role.trim() || 'Staff',
        status: 'OUT',
        pin: '1234',
        token: generateToken(),
        dateCreated: new Date().toISOString()
      };
      const { data, error } = await supabase
        .from('employees')
        .insert([newEmployee])
        .select()
        .single();
      if (error) handleSupabaseError(error, 'add employee');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'add employee');
    }
  },

  async deleteEmployee(id) {
    if (useLocalFallback) {
      const data = loadLocalData();
      data.employees = data.employees.filter(e => e.id !== id);
      data.attendance = data.attendance.filter(a => a.employeeId !== id);
      data.workRecords = data.workRecords.filter(w => w.employeeId !== id);
      saveLocalData(data);
      return true;
    }
    try {
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', id);
      if (error) handleSupabaseError(error, 'delete employee');
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
    if (useLocalFallback) {
      const data = loadLocalData();
      const today = getLocalDateString();
      const employees = data.employees || [];
      const attendance = data.attendance || [];

      return {
        totalEmployees: employees.length,
        activePresent: employees.filter(e => e.status === 'IN').length,
        presentToday: new Set(attendance.filter(a => a.date === today).map(r => r.employeeId)).size,
        absentToday: Math.max(0, employees.length - new Set(attendance.filter(a => a.date === today).map(r => r.employeeId)).size),
        officeName: data.settings?.officeName || 'My Office'
      };
    }
    try {
      const today = getLocalDateString();
      const { data: employees } = await supabase.from('employees').select('*');
      const { data: attendance } = await supabase.from('attendance').select('employeeId').eq('date', today);
      const { data: settings } = await supabase.from('settings').select('officeName').single();

      const totalEmployees = employees?.length || 0;
      const activePresent = employees?.filter(e => e.status === 'IN').length || 0;
      const presentToday = attendance?.length || 0;
      const absentToday = Math.max(0, totalEmployees - presentToday);

      return {
        totalEmployees,
        activePresent,
        presentToday,
        absentToday,
        officeName: settings?.officeName || 'My Office'
      };
    } catch (error) {
      handleSupabaseError(error, 'fetch dashboard stats');
    }
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
  }
};

module.exports = db;