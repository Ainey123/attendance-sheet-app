const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─── Supabase PostgreSQL Database (Persistent) ───────────────────────────────
// Free tier with 500MB storage, persistent across serverless restarts
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.error('Please set these in your Vercel project settings or local .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

const db = {
  // --- Employee Methods ---
  async getEmployees() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('dateCreated', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getEmployeeByToken(token) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('token', token)
      .single();
    if (error) return null;
    return data;
  },

  async addEmployee(name, role) {
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
    if (error) throw error;
    return data;
  },

  async deleteEmployee(id) {
    const { error } = await supabase
      .from('employees')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  async verifyEmployeePin(employeeId, pin) {
    const { data, error } = await supabase
      .from('employees')
      .select('pin')
      .eq('id', employeeId)
      .single();
    if (error || !data) return false;
    return data.pin === String(pin).trim();
  },

  async updateEmployeePin(employeeId, newPin) {
    const cleanedPin = String(newPin).trim();
    if (!/^\d{4}$/.test(cleanedPin)) throw new Error('PIN must be exactly 4 digits');
    const { data, error } = await supabase
      .from('employees')
      .update({ pin: cleanedPin })
      .eq('id', employeeId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // --- Settings Methods ---
  async getSettings() {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .single();
    if (error || !data) {
      return { adminPasscode: '1234', officeName: 'My Office' };
    }
    return data;
  },

  async updateSettings(newSettings) {
    const { data: existingData, error: fetchError } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (fetchError || !existingData) {
      // Create settings if they don't exist
      const { data, error } = await supabase
        .from('settings')
        .insert([{ ...newSettings, id: 'default' }])
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('settings')
      .update(newSettings)
      .eq('id', 'default')
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async generateAdminToken() {
    const token = crypto.randomBytes(16).toString('hex');
    const { data, error } = await supabase
      .from('settings')
      .update({ adminToken: token })
      .eq('id', 'default')
      .select()
      .single();
    if (error) throw error;
    return token;
  },

  // --- Attendance Methods ---
  async getAttendance(filterDate = null) {
    let query = supabase
      .from('attendance')
      .select('*')
      .order('clockInTime', { ascending: false });

    if (filterDate) {
      query = query.eq('date', filterDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getTodayAttendanceForEmployee(employeeId) {
    const today = getLocalDateString();
    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('employeeId', employeeId)
      .eq('date', today)
      .order('clockInTime', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    const active = data.find(r => !r.clockOutTime);
    if (active) return active;
    return data[0];
  },

  async clockIn(employeeId, location) {
    // Get employee first
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single();

    if (empError || !employee) throw new Error('Employee not found');

    // Check if already clocked in
    const { data: activeRecord, error: activeError } = await supabase
      .from('attendance')
      .select('*')
      .eq('employeeId', employeeId)
      .is('clockOutTime', null)
      .single();

    if (activeRecord) throw new Error('Employee is already clocked in');

    const now = new Date();
    const record = {
      id: generateId('att'),
      employeeId: employee.id,
      employeeName: employee.name,
      role: employee.role,
      date: getLocalDateString(now),
      clockInTime: now.toISOString(),
      clockOutTime: null,
      clockInLocation: location || null,
      clockOutLocation: null,
      duration: null
    };

    // Insert attendance record
    const { data: newRecord, error: insertError } = await supabase
      .from('attendance')
      .insert([record])
      .select()
      .single();

    if (insertError) throw insertError;

    // Update employee status
    const { data: updatedEmployee, error: updateError } = await supabase
      .from('employees')
      .update({ status: 'IN' })
      .eq('id', employeeId)
      .select()
      .single();

    if (updateError) throw updateError;

    return { record: newRecord, employee: updatedEmployee };
  },
  // Clock Out with required performance notes and money spent and optional image
  async clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image) {
    if (performanceNotes === undefined || performanceNotes === null) {
      throw new Error('Performance notes are required');
    }

    // Get employee
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single();

    if (empError || !employee) throw new Error('Employee not found');

    // Get active attendance record
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

    // Update attendance record
    const { data: updatedRecord, error: updateError } = await supabase
      .from('attendance')
      .update({
        clockOutTime: now.toISOString(),
        clockOutLocation: location || null,
        duration: duration,
        performanceNotes: performanceNotes,
        receivedAmount: Number(receivedAmount) || 0,
        expenseAmount: Number(expenseAmount) || 0,
        moneySpent: Number(expenseAmount) || 0,
        image: image || null
      })
      .eq('id', record.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update employee status
    const { data: updatedEmployee, error: empUpdateError } = await supabase
      .from('employees')
      .update({ status: 'OUT' })
      .eq('id', employeeId)
      .select()
      .single();

    if (empUpdateError) throw empUpdateError;

    // Auto-create or update work record for the day
    const dateStr = record.date;
    const monthStr = dateStr.substring(0, 7);

    const { data: existingWr, error: wrError } = await supabase
      .from('work_records')
      .select('*')
      .eq('employeeId', employeeId)
      .eq('date', dateStr)
      .single();

    if (!existingWr) {
      const wr = {
        id: generateId('wr'),
        employeeId: employee.id,
        employeeName: employee.name,
        month: monthStr,
        date: dateStr,
        performedWork: performanceNotes,
        receivedAmount: Number(receivedAmount) || 0,
        expenseAmount: Number(expenseAmount) || 0,
        paymentIssuance: Number(receivedAmount) || 0,
        balancePayment: '',
        materialIssuance: '',
        materialBalance: '',
        otherRemarks: '',
        createdAt: now.toISOString()
      };
      await supabase.from('work_records').insert([wr]);
    } else {
      await supabase
        .from('work_records')
        .update({
          performedWork: performanceNotes,
          receivedAmount: Number(receivedAmount) || 0,
          expenseAmount: Number(expenseAmount) || 0,
          paymentIssuance: Number(receivedAmount) || 0
        })
        .eq('id', existingWr.id);
    }

    return { record: updatedRecord, employee: updatedEmployee };
  },

  async getDashboardStats() {
    const today = getLocalDateString();

    // Get total employees and active count
    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('*');
    if (empError) throw empError;

    const totalEmployees = employees.length;
    const activePresent = employees.filter(e => e.status === 'IN').length;

    // Get today's attendance
    const { data: attendance, error: attError } = await supabase
      .from('attendance')
      .select('employeeId')
      .eq('date', today);
    if (attError) throw attError;

    const todayAttendees = new Set(attendance.map(r => r.employeeId));
    const presentToday = todayAttendees.size;
    const absentToday = Math.max(0, totalEmployees - presentToday);

    // Get settings for office name
    const { data: settings } = await supabase
      .from('settings')
      .select('officeName')
      .single();

    return {
      totalEmployees,
      activePresent,
      presentToday,
      absentToday,
      officeName: settings?.officeName || 'My Office'
    };
  },

  // --- Monthly Work & Payment Records ---
  async getWorkRecords(employeeId, month = null) {
    let query = supabase
      .from('work_records')
      .select('*')
      .order('date', { ascending: true });

    if (employeeId) {
      query = query.eq('employeeId', employeeId);
    }

    if (month) {
      query = query.eq('month', month);
    }

    const { data: records, error } = await query;
    if (error) throw error;

    // Group records by employeeId to compute individual running balances
    const recordsByEmployee = {};
    (records || []).forEach(r => {
      if (!recordsByEmployee[r.employeeId]) {
        recordsByEmployee[r.employeeId] = [];
      }
      recordsByEmployee[r.employeeId].push(r);
    });

    // For each employee, compute the running balance chronologically
    const processedRecords = [];
    for (const empId in recordsByEmployee) {
      let runningBalance = 0;
      recordsByEmployee[empId].forEach(r => {
        const received = Number(r.receivedAmount !== undefined ? r.receivedAmount : (r.paymentIssuance || 0));
        const expense = Number(r.expenseAmount || 0);

        r.carriedOverBalance = runningBalance;
        r.totalReceived = runningBalance + received;
        r.remainingBalance = r.totalReceived - expense;

        r.receivedAmount = r.receivedAmount !== undefined ? r.receivedAmount : (r.paymentIssuance || 0);
        r.expenseAmount = r.expenseAmount || 0;
        r.paymentIssuance = r.receivedAmount;
        r.balancePayment = String(r.remainingBalance);

        runningBalance = r.remainingBalance;
        processedRecords.push(r);
      });
    }

    return processedRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  async getWorkProfile(employeeId, month) {
    const { data, error } = await supabase
      .from('work_profiles')
      .select('*')
      .eq('employeeId', employeeId)
      .eq('month', month)
      .single();

    if (error || !data) {
      return { fatherName: '' };
    }
    return data;
  },

  async saveWorkProfile(employeeId, month, fatherName) {
    const { data: existing, error: fetchError } = await supabase
      .from('work_profiles')
      .select('*')
      .eq('employeeId', employeeId)
      .eq('month', month)
      .single();

    if (fetchError || !existing) {
      const { data, error } = await supabase
        .from('work_profiles')
        .insert([{
          employeeId,
          month,
          fatherName: String(fatherName || '').trim()
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('work_profiles')
      .update({ fatherName: String(fatherName || '').trim() })
      .eq('employeeId', employeeId)
      .eq('month', month)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async addWorkRecord(record) {
    const { data: employee } = await supabase
      .from('employees')
      .select('name')
      .eq('id', record.employeeId)
      .single();

    const payment = record.receivedAmount !== undefined ? record.receivedAmount : record.paymentIssuance;
    const expense = record.expenseAmount !== undefined ? record.expenseAmount : 0;

    const newRecord = {
      id: generateId('wr'),
      employeeId: record.employeeId,
      employeeName: employee ? employee.name : record.employeeName || '',
      month: record.month,
      date: record.date,
      performedWork: String(record.performedWork || '').trim(),
      receivedAmount: payment === '' || payment == null ? 0 : Number(payment),
      expenseAmount: expense === '' || expense == null ? 0 : Number(expense),
      paymentIssuance: payment === '' || payment == null ? null : Number(payment),
      balancePayment: String(record.balancePayment || '').trim(),
      materialIssuance: String(record.materialIssuance || '').trim(),
      materialBalance: String(record.materialBalance || '').trim(),
      otherRemarks: String(record.otherRemarks || '').trim(),
      createdAt: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('work_records')
      .insert([newRecord])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateWorkRecord(id, employeeId, updates) {
    const { data: existing, error: fetchError } = await supabase
      .from('work_records')
      .select('*')
      .eq('id', id)
      .eq('employeeId', employeeId)
      .single();

    if (fetchError || !existing) throw new Error('Record not found');

    const updateData = {};
    if (updates.date !== undefined) updateData.date = updates.date;
    if (updates.performedWork !== undefined) updateData.performedWork = String(updates.performedWork).trim();

    if (updates.receivedAmount !== undefined) {
      updateData.receivedAmount = updates.receivedAmount === '' || updates.receivedAmount == null ? 0 : Number(updates.receivedAmount);
      updateData.paymentIssuance = updateData.receivedAmount;
    } else if (updates.paymentIssuance !== undefined) {
      updateData.receivedAmount = updates.paymentIssuance === '' || updates.paymentIssuance == null ? 0 : Number(updates.paymentIssuance);
      updateData.paymentIssuance = updateData.receivedAmount;
    }

    if (updates.expenseAmount !== undefined) {
      updateData.expenseAmount = updates.expenseAmount === '' || updates.expenseAmount == null ? 0 : Number(updates.expenseAmount);
    }

    if (updates.balancePayment !== undefined) updateData.balancePayment = String(updates.balancePayment).trim();
    if (updates.materialIssuance !== undefined) updateData.materialIssuance = String(updates.materialIssuance).trim();
    if (updates.materialBalance !== undefined) updateData.materialBalance = String(updates.materialBalance).trim();
    if (updates.otherRemarks !== undefined) updateData.otherRemarks = String(updates.otherRemarks).trim();

    const { data, error } = await supabase
      .from('work_records')
      .update(updateData)
      .eq('id', id)
      .eq('employeeId', employeeId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteWorkRecord(id, employeeId) {
    const { error } = await supabase
      .from('work_records')
      .delete()
      .eq('id', id)
      .eq('employeeId', employeeId);

    if (error) throw error;
    return true;
  }
};

module.exports = db;
