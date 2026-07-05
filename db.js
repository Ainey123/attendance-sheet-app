const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─── Supabase PostgreSQL Database (Persistent) ───────────────────────────────
// Free tier with 500MB storage, persistent across serverless restarts
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing Supabase environment variables');
  console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY in your environment');
  console.error('For local development: Create a .env file with these variables');
  console.error('For Vercel: Add these in Project Settings > Environment Variables');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to handle Supabase errors
function handleSupabaseError(error, operation) {
  console.error(`Database error during ${operation}:`, error.message);
  throw new Error(`Failed to ${operation}: ${error.message}`);
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

const db = {
  // --- Employee Methods ---
  async getEmployees() {
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
    try {
    const cleanedPin = String(newPin).trim();
    if (!/^\d{4}$/.test(cleanedPin)) throw new Error('PIN must be exactly 4 digits');
      const { data, error } = await supabase
        .from('employees')
        .update({ pin: cleanedPin })
        .eq('id', employeeId)
        .select()
        .single();
      if (error) handleSupabaseError(error, 'update employee PIN');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update employee PIN');
    }
  },

  // --- Settings Methods ---
  async getSettings() {
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
    try {
      let query = supabase
        .from('attendance')
        .select('*')
        .order('clockInTime', { ascending: false });

    if (filterDate) {
        query = query.eq('date', filterDate);
      }

      const { data, error } = await query;
      if (error) handleSupabaseError(error, 'fetch attendance');
      return data || [];
    } catch (error) {
      handleSupabaseError(error, 'fetch attendance');
    }
  },

  async getTodayAttendanceForEmployee(employeeId) {
    try {
    const today = getLocalDateString();
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('date', today)
        .order('clockInTime', { ascending: false });

      if (error) throw error;
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
    try {
      // Get employee first
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

      // Check if already clocked in
      const { data: activeRecord, error: activeError } = await supabase
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

      if (insertError) handleSupabaseError(insertError, 'clock in');

      // Update employee status
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
  // Clock Out with required performance notes and money spent and optional image
  async clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image) {
    try {
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

      const today = getLocalDateString();
      const { data: todayRecords, error: todayError } = await supabase
        .from('attendance')
        .select('*')
        .eq('employeeId', employeeId)
        .eq('date', today);

      if (todayError) throw todayError;
      if (todayRecords?.some(isLeaveAttendanceRecord)) {
        throw new Error('Employee has a leave request for today');
      }

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

      if (updateError) handleSupabaseError(updateError, 'clock out');

      // Update employee status
      const { data: updatedEmployee, error: empUpdateError } = await supabase
        .from('employees')
        .update({ status: 'OUT' })
        .eq('id', employeeId)
        .select()
        .single();

      if (empUpdateError) handleSupabaseError(empUpdateError, 'update employee status');

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
    } catch (error) {
      handleSupabaseError(error, 'clock out');
    }
  },

  async getDashboardStats() {
    try {
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
    } catch (error) {
      handleSupabaseError(error, 'fetch dashboard stats');
    }
  },

  // --- Monthly Work & Payment Records ---
  async getWorkRecords(employeeId, month = null) {
    try {
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
      if (error) handleSupabaseError(error, 'fetch work records');

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
    } catch (error) {
      handleSupabaseError(error, 'fetch work records');
    }
  },

  async getWorkProfile(employeeId, month) {
    try {
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
    } catch (error) {
      return { fatherName: '' };
    }
  },

  async saveWorkProfile(employeeId, month, fatherName) {
    try {
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
        if (error) handleSupabaseError(error, 'save work profile');
        return data;
      }

      const { data, error } = await supabase
        .from('work_profiles')
        .update({ fatherName: String(fatherName || '').trim() })
        .eq('employeeId', employeeId)
        .eq('month', month)
        .select()
        .single();
      if (error) handleSupabaseError(error, 'save work profile');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'save work profile');
    }
  },

  async addWorkRecord(record) {
    try {
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

      if (error) handleSupabaseError(error, 'add work record');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'add work record');
    }
  },

  async updateWorkRecord(id, employeeId, updates) {
    try {
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

      if (error) handleSupabaseError(error, 'update work record');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update work record');
    }
  },

  async deleteWorkRecord(id, employeeId) {
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

  // --- Form Submissions Methods ---
  async getFormSubmissions(employeeId = null, formType = null) {
    try {
      let query = supabase
        .from('form_submissions')
        .select('*')
        .order('submittedAt', { ascending: false });

      if (employeeId) {
        query = query.eq('employeeId', employeeId);
      }
      if (formType) {
        query = query.eq('formType', formType);
      }

      const { data, error } = await query;
      if (error) handleSupabaseError(error, 'fetch form submissions');
      return data || [];
    } catch (error) {
      handleSupabaseError(error, 'fetch form submissions');
    }
  },

  async getFormSubmission(id) {
    try {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) return null;
      return data;
    } catch (error) {
      return null;
    }
  },

  async saveFormSubmission(employeeId, employeeName, formType, formData) {
    try {
      const newSubmission = {
        id: generateId('form'),
        employeeId,
        employeeName: employeeName || '',
        formType,
        formData: formData || {},
        submittedAt: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('form_submissions')
        .insert([newSubmission])
        .select()
        .single();

      if (error) handleSupabaseError(error, 'save form submission');

      if (formType === 'Leave' && formData?.leaveDate) {
        const leaveDate = String(formData.leaveDate);
        const leaveType = String(formData.leaveType || 'Leave');
        const leaveReason = String(formData.reason || 'Leave');
        const leaveNotes = String(formData.notes || '').trim();
        const leaveText = `LEAVE: ${leaveType} - ${leaveReason}${leaveNotes ? ` | ${leaveNotes}` : ''}`;

        const { data: employeeData, error: empError } = await supabase
          .from('employees')
          .select('role')
          .eq('id', employeeId)
          .single();

        const employeeRole = empError || !employeeData ? 'Staff' : (employeeData.role || 'Staff');

        const { data: existingRecords, error: lookupError } = await supabase
          .from('attendance')
          .select('*')
          .eq('employeeId', employeeId)
          .eq('date', leaveDate);

        if (lookupError) handleSupabaseError(lookupError, 'lookup leave attendance');

        const existingLeaveRecord = (existingRecords || []).find(isLeaveAttendanceRecord) || (existingRecords || [])[0];
        const leavePayload = {
          id: existingLeaveRecord?.id || generateId('att'),
          employeeId,
          employeeName: employeeName || '',
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
    try {
      const { data, error } = await supabase
        .from('form_submissions')
        .update(updates)
        .eq('id', id)
        .eq('employeeId', employeeId)
        .select()
        .single();

      if (error) handleSupabaseError(error, 'update form submission');
      return data;
    } catch (error) {
      handleSupabaseError(error, 'update form submission');
    }
  },

  async deleteFormSubmission(id, employeeId) {
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
