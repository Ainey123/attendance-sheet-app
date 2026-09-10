// db-local.js - Local file-based DB fallback (for testing without Supabase)
const fs = require('fs');
const path = require('path');

// Load existing data or create default
let data = { employees: [], attendance: [], workRecords: [], workProfiles: {}, settings: { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' }, formSubmissions: [], comments: [], salaries: [], accountsPdfs: [], salaryApprovals: [], expenseVerifications: [] };

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      data = { ...data, ...fileData, formSubmissions: fileData.formSubmissions || [], comments: fileData.comments || [], salaries: fileData.salaries || [], accountsPdfs: fileData.accountsPdfs || [], salaryApprovals: fileData.salaryApprovals || [], expenseVerifications: fileData.expenseVerifications || [] };
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving data:', e.message);
  }
}

function generateId(prefix = '') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 8; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}

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

const db = {
  // --- Employee Methods ---
  async getEmployees(includeArchived = false) {
    const list = data.employees || [];
    const result = includeArchived ? list : list.filter(e => e.status !== 'DELETED' && !e.isArchived);
    let changed = false;
    for (const emp of result) {
      if (!emp.token || emp.token.startsWith('EXPIRED_')) {
        emp.token = generateToken();
        changed = true;
      }
    }
    if (changed) saveData();
    return result;
  },

  async getEmployeeByToken(token) {
    const emp = (data.employees || []).find(e => e.token === token) || null;
    if (emp && (emp.status === 'DELETED' || emp.isArchived)) return null;
    return emp;
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
    data.employees.push(newEmployee);
    saveData();
    return newEmployee;
  },

  async deleteEmployee(id) {
    const emp = data.employees.find(e => e.id === id);
    if (emp) {
      emp.status = 'DELETED';
      emp.isArchived = true;
      emp.token = 'EXPIRED_' + Date.now();
      saveData();
    }
    return true;
  },

  async resetEmployeeToken(id) {
    const emp = data.employees.find(e => e.id === id);
    if (!emp) throw new Error('Employee not found');
    const newToken = generateToken();
    const nowIso = new Date().toISOString();
    emp.token = newToken;
    emp.tokenCreatedAt = nowIso;
    saveData();
    return { token: newToken, tokenCreatedAt: nowIso };
  },

  async verifyEmployeePin(employeeId, pin) {
    const emp = data.employees.find(e => e.id === employeeId);
    return emp && emp.pin === String(pin).trim();
  },

  async updateEmployeePin(employeeId, newPin) {
    const emp = data.employees.find(e => e.id === employeeId);
    if (!emp) throw new Error('Employee not found');
    emp.pin = String(newPin).trim();
    saveData();
    return emp;
  },

  // --- Settings Methods ---
  async getSettings() {
    const s = data.settings || {};
    return {
      adminPasscode: s.adminPasscode || '1234',
      seniorAdminPasscode: s.seniorAdminPasscode || '9999',
      officeName: s.officeName || 'My Office',
      adminToken: s.adminToken || null
    };
  },

  async updateSettings(newSettings) {
    data.settings = { ...data.settings, ...newSettings };
    saveData();
    return data.settings;
  },

  async generateAdminToken() {
    const token = Math.random().toString(36).substr(2, 16);
    data.settings.adminToken = token;
    saveData();
    return token;
  },

  // --- Attendance Methods ---
  async getAttendance(filterDate = null) {
    let records = data.attendance || [];
    if (filterDate) {
      records = records.filter(r => r.date === filterDate);
    }
    return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
  },

  async autoCompleteOldAttendance(targetEmployeeId = null) {
    const now = new Date();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    let changed = false;
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
          changed = true;

          const emp = (data.employees || []).find(e => e.id === r.employeeId);
          if (emp && emp.status === 'IN') {
            emp.status = 'OUT';
          }
        }
      }
    });
    if (changed) saveData();
  },

  async getTodayAttendanceForEmployee(employeeId) {
    await this.autoCompleteOldAttendance(employeeId).catch(() => {});
    const today = getLocalDateString();
    const empRecords = (data.attendance || [])
      .filter(r => r.employeeId === employeeId)
      .sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
    
    if (empRecords.length === 0) return null;
    
    // First check for active unclosed record
    const active = empRecords.find(r => !r.clockOutTime);
    if (active) {
      const emp = (data.employees || []).find(e => e.id === employeeId);
      if (emp && emp.status !== 'IN') { emp.status = 'IN'; saveData(); }
      return active;
    }

    const todayRecords = empRecords.filter(r => r.date === today);
    if (todayRecords.length > 0) {
      const leaveRecord = todayRecords.find(isLeaveAttendanceRecord);
      if (leaveRecord) return leaveRecord;
      return todayRecords[0];
    }
    return null;
  },

  async clockIn(employeeId, location) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      throw new Error('Please turn on location first');
    }

    await this.autoCompleteOldAttendance(employeeId).catch(() => {});

    const employee = data.employees.find(e => e.id === employeeId);
    if (!employee) throw new Error('Employee not found');

    const now = new Date();
    const today = getLocalDateString(now);

    // Auto-close any unclosed prior shift from previous days so it never blocks new shift
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
      saveData();
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
    saveData();
    return { record, employee };
  },

  async clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image) {
    await this.autoCompleteOldAttendance(employeeId).catch(() => {});

    const employee = data.employees.find(e => e.id === employeeId);
    if (!employee) throw new Error('Employee not found');

    const now = new Date();
    const today = getLocalDateString(now);
    const finalNotes = (performanceNotes && String(performanceNotes).trim()) || 'Shift Completed';
    const finalReceived = Number(receivedAmount) || 0;
    const finalExpense = Number(expenseAmount) || 0;

    // 1. Look for active unclosed record for this employee
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

    // Auto-create/sync work record
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

    saveData();
    return { record, employee };
  },

  async getDashboardStats() {
    const today = getLocalDateString();
    const employees = (data.employees || []).filter(e => e.status !== 'DELETED' && !e.isArchived && (!e.token || !e.token.startsWith('EXPIRED_')));
    const activeEmpIds = new Set(employees.map(e => e.id));

    // Helper: is leave record?
    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));

    // Today's valid attendance records for active employees
    const todayAttendance = (data.attendance || []).filter(a => a.date === today && activeEmpIds.has(a.employeeId) && !isLeave(a));

    const totalEmployees = employees.length;
    // Currently Clocked In = today's records where clockInTime IS NOT NULL and clockOutTime IS NULL
    const currentlyClockedIn = todayAttendance.filter(r => r.clockInTime && !r.clockOutTime).length;
    // Present Today = distinct employees who clocked in today
    const presentToday = new Set(todayAttendance.map(r => r.employeeId)).size;
    // Clocked Out Today = today's records where clockOutTime IS NOT NULL
    const clockedOutToday = todayAttendance.filter(r => r.clockOutTime).length;
    const absentToday = Math.max(0, totalEmployees - presentToday);

    return {
      totalEmployees,
      activePresent: currentlyClockedIn,
      currentlyClockedIn,
      presentToday,
      clockedOutToday,
      absentToday,
      officeName: data.settings?.officeName || 'My Office'
    };
  },

  // --- Work Records ---
  async getWorkRecords(employeeId = null, month = null) {
    let records = data.workRecords || [];
    if (employeeId) records = records.filter(r => r.employeeId === employeeId);
    if (month) records = records.filter(r => r.month === month);
    return records.sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  async getWorkProfile(employeeId, month) {
    const key = `${employeeId}:${month}`;
    return data.workProfiles?.[key] || { fatherName: '' };
  },

  async saveWorkProfile(employeeId, month, fatherName) {
    const key = `${employeeId}:${month}`;
    if (!data.workProfiles) data.workProfiles = {};
    data.workProfiles[key] = { fatherName };
    saveData();
    return { employeeId, month, fatherName };
  },

  async addWorkRecord(record) {
    data.workRecords = data.workRecords || [];
    const newRecord = { ...record, id: generateId('wr'), createdAt: new Date().toISOString() };
    data.workRecords.push(newRecord);
    saveData();
    return newRecord;
  },

  async updateWorkRecord(id, employeeId, updates) {
    const record = data.workRecords.find(r => r.id === id && r.employeeId === employeeId);
    if (!record) throw new Error('Record not found');
    Object.assign(record, updates);
    saveData();
    return record;
  },

  async deleteWorkRecord(id, employeeId) {
    data.workRecords = data.workRecords.filter(r => !(r.id === id && r.employeeId === employeeId));
    saveData();
    return true;
  },

  // --- Form Submissions ---
  async getFormSubmissions(employeeId = null, formType = null) {
    let records = data.formSubmissions || [];
    if (employeeId) records = records.filter(r => r.employeeId === employeeId);
    if (formType) records = records.filter(r => r.formType === formType);
    else records = records.filter(r => r.formType !== 'manual_present_days' && r.formType !== 'manual_sunday_bonus');
    return records.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  },

  async getFormSubmission(id) {
    return data.formSubmissions.find(r => r.id === id) || null;
  },

  async saveFormSubmission(employeeId, employeeName, formType, formData) {
    if (formType !== 'Leave') {
      const exists = (data.formSubmissions || []).some(r => r.employeeId === employeeId && r.formType !== 'Leave');
      if (exists) throw new Error('Document submission already completed for this employee.');
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

      if (existing) {
        Object.assign(existing, leavePayload);
      } else {
        data.attendance.push(leavePayload);
      }
    }

    saveData();
    return submission;
  },

  async updateFormSubmission(id, employeeId, updates) {
    const submission = data.formSubmissions.find(r => r.id === id && r.employeeId === employeeId);
    if (!submission) throw new Error('Record not found');
    Object.assign(submission, updates);
    saveData();
    return submission;
  },

  async deleteFormSubmission(id, employeeId) {
    data.formSubmissions = data.formSubmissions.filter(r => !(r.id === id && r.employeeId === employeeId));
    saveData();
    return true;
  },

  // --- Manual Present Days Override Methods ---
  async getManualPresentDays(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const resultMap = {};
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

    data.formSubmissions = data.formSubmissions || [];
    const localIdx = data.formSubmissions.findIndex(s => s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_present_days' && s.formData?.month === month));
    if (localIdx >= 0) {
      data.formSubmissions[localIdx] = record;
    } else {
      data.formSubmissions.push(record);
    }
    saveData();

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
    if (data.formSubmissions) {
      data.formSubmissions = data.formSubmissions.filter(s => !(s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_present_days' && s.formData?.month === month)));
      saveData();
    }

    await this.generateSalary(employeeId, month);

    return {
      success: true,
      employeeId,
      month
    };
  },

  async getManualSundayBonuses(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const resultMap = {};
    const subs = data.formSubmissions || [];
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
    return resultMap;
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
    const perDay = basicSalary > 0 ? Math.round(basicSalary / 30) : 0;
    const originalAutoSundayBonus = perDay * sundayDays;

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

    data.formSubmissions = data.formSubmissions || [];
    const localIdx = data.formSubmissions.findIndex(s => s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_sunday_bonus' && s.formData?.month === month));
    if (localIdx >= 0) {
      data.formSubmissions[localIdx] = record;
    } else {
      data.formSubmissions.push(record);
    }
    saveData();

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
    if (data.formSubmissions) {
      data.formSubmissions = data.formSubmissions.filter(s => !(s.id === recordId || (s.employeeId === employeeId && s.formType === 'manual_sunday_bonus' && s.formData?.month === month)));
      saveData();
    }

    await this.generateSalary(employeeId, month);

    return {
      success: true,
      employeeId,
      month
    };
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
    const daysEvaluated = totalDaysInMonth;

    // Count Sundays in evaluated period
    let sundaysInEvaluatedPeriod = 0;
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dt = new Date(year, monthNum - 1, d);
      if (dt.getDay() === 0) sundaysInEvaluatedPeriod++;
    }
    const workingDaysToEvaluate = Math.max(0, totalDaysInMonth - sundaysInEvaluatedPeriod);

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
    const empNameMap = new Map();

    (allEmployees || []).forEach(emp => {
      if (!emp || !emp.id) return;
      const normName = emp.name ? emp.name.trim().toLowerCase() : '';
      const summaryObj = {
        employeeId: emp.id,
        employeeName: emp.name ? emp.name.trim() : 'Staff Member',
        role: emp.role || 'Staff',
        isArchived: emp.status === 'DELETED' || Boolean(emp.isArchived),
        presentDates: new Set(),
        leaveDates: new Set(),
        workDoneDetails: [],
        totalExpensesAdded: 0
      };
      summaryMap.set(emp.id, summaryObj);
      if (normName) empNameMap.set(normName, summaryObj);
    });

    monthLogs.forEach(log => {
      if (!log) return;
      let empSummary = null;
      if (log.employeeId) empSummary = summaryMap.get(log.employeeId);
      if (!empSummary && log.employeeName) {
        empSummary = empNameMap.get(log.employeeName.trim().toLowerCase());
      }
      if (!empSummary && log.employeeId) {
        empSummary = {
          employeeId: log.employeeId,
          employeeName: log.employeeName ? log.employeeName.trim() : 'Staff Member',
          role: log.role || 'Staff',
          isArchived: true,
          presentDates: new Set(),
          leaveDates: new Set(),
          workDoneDetails: [],
          totalExpensesAdded: 0
        };
        summaryMap.set(log.employeeId, empSummary);
      }
      if (!empSummary) return;

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
      if (!wr || !wr.employeeId) return;
      let empSummary = summaryMap.get(wr.employeeId);
      if (empSummary) {
        if (wr.performedWork && wr.performedWork.trim() !== '') {
          empSummary.workDoneDetails.push(wr.performedWork.trim());
        }
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
  },

  // --- Comments / Messaging Methods ---
  async getComments(employeeId = null) {
    let list = data.comments || [];
    if (employeeId) list = list.filter(c => c.employeeId === employeeId);
    return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  async addComment({ employeeId, employeeName, sender, senderName, message }) {
    if (!data.comments) data.comments = [];
    const senderNorm = (sender || 'employee').toLowerCase();
    const newComment = {
      id: generateId('comm'),
      employeeId,
      employeeName: employeeName || 'Employee',
      sender: senderNorm,
      senderName: senderName || (senderNorm === 'admin' ? 'Admin' : (employeeName || 'Employee')),
      message: message.trim(),
      isRead: senderNorm === 'admin' ? false : true, // admin messages start as unread for employee
      createdAt: new Date().toISOString()
    };
    data.comments.push(newComment);
    saveData();
    return newComment;
  },


  async deleteComment(id) {
    if (data.comments) {
      data.comments = data.comments.filter(c => c.id !== id);
      saveData();
    }
    return true;
  },

  async getUnreadAdminMessages(employeeId) {
    const list = (data.comments || []).filter(c =>
      c.employeeId === employeeId && c.sender === 'admin' && c.isRead === false
    );
    return { count: list.length, messages: list };
  },

  async markMessagesRead(employeeId) {
    (data.comments || []).forEach(c => {
      if (c.employeeId === employeeId && c.sender === 'admin') c.isRead = true;
    });
    saveData();
  },

  // --- Salary Methods ---
  async getSalaryRecord(employeeId, month) {
    if (!data.salaries) data.salaries = [];
    return data.salaries.find(s => s.employeeId === employeeId && s.month === month) || null;
  },

  // --- Salary Methods ---
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
    if (!data.salaries) data.salaries = [];
    let rec = data.salaries.find(s => s.employeeId === employeeId && s.month === month);
    if (!rec) {
      const emp = (data.employees || []).find(e => e.id === employeeId);
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
    rec.basicSalary = Number(basicSalary) || 0;
    saveData();
    // Auto-calculate full salary immediately after setting basic salary
    return await this.generateSalary(employeeId, month);
  },

  async generateSalary(employeeId, month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [yearStr, mStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(mStr, 10);
    const totalDaysInMonth = new Date(year, monthNum, 0).getDate();

    // Get or create salary record
    if (!data.salaries) data.salaries = [];
    let salRec = data.salaries.find(s => s.employeeId === employeeId && s.month === month);
    const employees = await this.getEmployees(true);
    const emp = employees.find(e => e.id === employeeId);
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

    // Get attendance logs for this employee this month
    const empNameNorm = emp && emp.name ? emp.name.trim().toLowerCase() : '';
    const allAttendance = await this.getAttendance();
    const attendanceLogs = (allAttendance || []).filter(a => {
      if (!a || !a.date || !a.date.startsWith(month) || isLeaveAttendanceRecord(a)) return false;
      const matchId = a.employeeId && a.employeeId === employeeId;
      const matchName = empNameNorm && a.employeeName && a.employeeName.trim().toLowerCase() === empNameNorm;
      return matchId || matchName;
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

    let workRecords = [];
    try {
      workRecords = await this.getWorkRecords(null, month);
    } catch (e) {
      workRecords = [];
    }
    (workRecords || []).forEach(wr => {
      if (!wr || !wr.date || !wr.date.startsWith(month)) return;
      const matchId = wr.employeeId && wr.employeeId === employeeId;
      const matchName = empNameNorm && wr.employeeName && wr.employeeName.trim().toLowerCase() === empNameNorm;
      if ((matchId || matchName) && !processedDates.has(wr.date)) {
        const exp = Number(wr.expenseAmount) || 0;
        if (exp > 0) totalExpenses += exp;
      }
    });

    const basicSalary = salRec.basicSalary || 0;

    // FORMULA: Per Day = Basic ÷ 30 (fixed 30-day divisor per office policy)
    const perDaySalary = basicSalary > 0 ? Math.round(basicSalary / 30) : 0;

    // Regular earned = per day × regular present days
    const regularEarned = perDaySalary * effectiveRegularDays;

    // Sunday bonus = manual override or auto-calculate
    const sunOverride = manualSundayOverrides[employeeId];
    const isManualSunday = Boolean(sunOverride && typeof sunOverride.manualSundayBonus === 'number');
    const autoSundayBonus = perDaySalary * effectiveSundayDays;
    const sundayBonus = isManualSunday ? sunOverride.manualSundayBonus : autoSundayBonus;

    // Total earned = regular + sunday bonus
    const earnedSalary = regularEarned + sundayBonus;

    // Net salary = earned - total clock-out expenses
    const netSalary = earnedSalary - Math.round(totalExpenses);

    Object.assign(salRec, {
      employeeName: emp ? emp.name : salRec.employeeName,
      role: emp ? (emp.role || 'Staff') : salRec.role,
      totalDaysInMonth,
      workingDays: 30, // fixed 30-day divisor
      regularPresentDays: effectiveRegularDays,
      sundayPresentDays: effectiveSundayDays,
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

    saveData();
    return salRec;
  },

  async generateAllSalaries(month) {
    const employees = await this.getEmployees(false);
    const results = [];
    for (const emp of employees) {
      const rec = await this.generateSalary(emp.id, month);
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

  async getAccountsPdf(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const list = data.accountsPdfs || [];
    let found = list.find(p => p.salaryMonth === month);
    if (!found) {
      return null;
    }

    if (found.fileName && /Accounts_Department|User_Manual|User Manual|Documentation|Sample|Demo|Default|Initial|Mock/i.test(found.fileName)) {
      return null;
    }

    return await this.reverifyAccountsPdf(month);
  },

  async saveAccountsPdf(month, fileName, pdfBase64, uploadedBy = 'Admin', replace = false, pdfId = null) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('Invalid salary month format (expected YYYY-MM)');
    }
    if (!pdfBase64) {
      throw new Error('PDF data is required');
    }

    const cleanBase64 = String(pdfBase64).replace(/^data:.*?;base64,/, '').replace(/\s+/g, '');
    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    const fileSize = pdfBuffer.length;
    const newPdfId = pdfId || generateId('pdf_file');

    const { parseAccountsPdf, matchAndVerifyExpenses } = require('./pdf-parser-helper');
    let parsed;
    try {
      parsed = await parseAccountsPdf(pdfBuffer, fileName || 'accounts.pdf', newPdfId);
    } catch (err) {
      throw new Error('PDF Parsing failed: ' + err.message);
    }

    const employees = await this.getEmployees(false);
    const appExpensesMap = await this.getAppExpensesMap(month);

    if (!data.accountsPdfs) data.accountsPdfs = [];
    let existing = data.accountsPdfs.find(p => p.salaryMonth === month);
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
        id: generateId('pdf'),
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
        summary: {},
        verificationResults: [],
        unmatchedPdfEntries: [],
        manualMappings: {},
        auditLog: [{
          action: 'UPLOADED',
          by: uploadedBy,
          at: nowIso,
          fileName
        }]
      };
      data.accountsPdfs.push(existing);
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
      existing.pdfData = cleanBase64;
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
      month
    );

    existing.extractedData = allEntries;
    existing.summary = summary;
    existing.verificationResults = verificationResults;
    existing.unmatchedPdfEntries = unmatchedPdfEntries;

    saveData();
    return existing;
  },

  async deleteAccountsPdfFile(month, pdfId, deletedBy = 'Admin') {
    if (!month || !pdfId) {
      throw new Error('month and pdfId required');
    }

    if (!data.accountsPdfs) data.accountsPdfs = [];
    let existing = data.accountsPdfs.find(p => p.salaryMonth === month);

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
        month
      );

      existing.extractedData = allEntries;
      existing.summary = summary;
      existing.verificationResults = verificationResults;
    }

    saveData();
    return existing;
  },

  async reverifyAccountsPdf(month) {
    const pdfRecord = (data.accountsPdfs || []).find(p => p.salaryMonth === month);
    if (!pdfRecord) return null;

    const { matchAndVerifyExpenses } = require('./pdf-parser-helper');
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
    saveData();

    return pdfRecord;
  },

  async mapAccountsPdfEmployee(month, extractedName, targetEmployeeId) {
    const pdfRecord = (data.accountsPdfs || []).find(p => p.salaryMonth === month);
    if (!pdfRecord) throw new Error(`No Accounts PDF found for month ${month}`);

    if (!pdfRecord.manualMappings) pdfRecord.manualMappings = {};
    if (targetEmployeeId) {
      pdfRecord.manualMappings[targetEmployeeId] = extractedName;
    } else {
      for (const [k, v] of Object.entries(pdfRecord.manualMappings)) {
        if (v === extractedName) delete pdfRecord.manualMappings[k];
      }
    }

    return await this.reverifyAccountsPdf(month);
  },

  async deleteAccountsPdf(month, deletedBy = 'Admin') {
    const idx = (data.accountsPdfs || []).findIndex(p => p.salaryMonth === month);
    if (idx === -1) return true;

    data.accountsPdfs.splice(idx, 1);
    saveData();
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

    saveData();
    return existing;
  },

  async getSalaryApprovals(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return (data.salaryApprovals || []).filter(a => a.salaryMonth === month);
  },

  async getSalaryApproval(employeeId, month) {
    const list = await this.getSalaryApprovals(month);
    return list.find(a => a.employeeId === employeeId) || null;
  },

  async revokeSalaryApproval(employeeId, month, reason = '', adminUser = 'Admin') {
    const nowIso = new Date().toISOString();
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
    saveData();
    return true;
  },

  // ─── Expense Verification & Approval Methods ────────────────────────────────
  async verifyExpense({ employeeId, employeeName, salaryMonth, claimedAmount, verifiedAmount, verifiedBy = 'Admin 1', notes = '' }) {
    if (!employeeId || !salaryMonth) {
      throw new Error('employeeId and salaryMonth are required');
    }
    const vAmt = parseFloat(verifiedAmount);
    if (isNaN(vAmt) || vAmt < 0) {
      throw new Error('Valid verifiedAmount is required');
    }

    const nowIso = new Date().toISOString();
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

    saveData();
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

    saveData();
    return existing;
  },

  async getExpenseVerifications(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return (data.expenseVerifications || []).filter(v => v.salaryMonth === month);
  },

  async getExpenseVerification(employeeId, month) {
    const list = await this.getExpenseVerifications(month);
    return list.find(v => v.employeeId === employeeId) || null;
  },

  async revokeExpenseVerification(employeeId, month, reason = '', adminUser = 'Admin') {
    const nowIso = new Date().toISOString();
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
    saveData();
    return true;
  },

  async revokeExpenseApproval(employeeId, month, reason = '', adminUser = 'Senior Admin') {
    const nowIso = new Date().toISOString();
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
    saveData();
    return true;
  },

  async getEmployeeCreditHistory(employeeId) {
    if (!employeeId) throw new Error('employeeId is required');
    const employees = await this.getEmployees(true);
    const emp = employees.find(e => e.id === employeeId);
    const empName = emp ? emp.name : 'Unknown';

    const list = data.accountsPdfs || [];
    const allEntries = [];
    const seenTxKeys = new Set();
    const { isNameMatch } = require('./pdf-parser-helper');

    list.forEach(pdf => {
      const entries = Array.isArray(pdf.extractedEntries) ? pdf.extractedEntries : [];
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

    const verifications = (data.expenseVerifications || []).filter(v => v.employeeId === employeeId);
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

      const monthlySalary = sal.basicSalary || 0;
      const appCredit = sal.earnedSalary || 0;
      const bankCredit = pdfVerif.bankCreditTotal !== undefined ? pdfVerif.bankCreditTotal : 0;
      const matchedTxList = pdfVerif.matchedCredits || [];
      const monthExpense = expData.totalExpense || (sal.totalExpenses || 0);

      let verifiedCredit = bankCredit;
      if (dbVerif.verifiedAmount !== null && dbVerif.verifiedAmount !== undefined) {
        verifiedCredit = Number(dbVerif.verifiedAmount);
      }

      const difference = Math.round(Math.abs(appCredit - bankCredit) * 100) / 100;

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

      const isCreditEligible = (verificationStatus === 'VERIFIED' || dbVerif.approvalStatus === 'APPROVED' || (dbVerif.verifiedAmount !== null && dbVerif.verifiedAmount !== undefined));
      const creditDeduction = isCreditEligible ? verifiedCredit : 0;

      const calculatedFinal = Math.max(0, monthlySalary - creditDeduction - monthExpense);
      const finalSalary = dbVerif.approvedAmount !== null && dbVerif.approvedAmount !== undefined ? Number(dbVerif.approvedAmount) : calculatedFinal;

      const approvalStatus = dbVerif.approvalStatus || 'PENDING';

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
    const list = (data.salaryPdfRuns || []).filter(r => r.salaryMonth === month);
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

    if (!data.salaryPdfRuns) data.salaryPdfRuns = [];
    data.salaryPdfRuns.unshift(newRun);
    saveData();

    return newRun;
  },

  async getFinalizedSalaryReport(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [employees, allAttendance, workRecords, rawSalaries, accountsPdf, approvals, verifications, settings, manualOverrides, manualSundayOverrides] = await Promise.all([
      this.getEmployees(false),
      this.getAttendance().catch(() => []),
      this.getWorkRecords(null, month).catch(() => []),
      this.getAllSalaries(month).catch(() => []),
      this.getAccountsPdf(month).catch(() => null),
      this.getSalaryApprovals(month).catch(() => []),
      this.getExpenseVerifications(month).catch(() => []),
      this.getSettings().catch(() => ({})),
      this.getManualPresentDays(month).catch(() => ({})),
      this.getManualSundayBonuses(month).catch(() => ({}))
    ]);

    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));

    const monthAttendance = (allAttendance || []).filter(a => a.date && a.date.startsWith(month) && !isLeave(a));

    const salariesMap = {};
    (rawSalaries || []).forEach(s => { salariesMap[s.employeeId] = s; });

    const approvalsMap = {};
    (approvals || []).forEach(a => { approvalsMap[a.employeeId] = a; });

    const verificationsMap = {};
    (verifications || []).forEach(v => { verificationsMap[v.employeeId] = v; });

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

      const salRec = salariesMap[empId] || {};
      const basicSalary = Number(salRec.basicSalary) || Number(emp.baseSalary) || Number(emp.basicSalary) || 0;
      const perDaySalary = basicSalary > 0 ? Math.round(basicSalary / 30) : 0;
      const regularEarned = perDaySalary * effectiveRegularDays;

      const sunOverride = manualSundayOverrides[empId] || null;
      const isManualSundayBonus = Boolean(sunOverride && typeof sunOverride.manualSundayBonus === 'number');
      const autoSundayBonus = perDaySalary * effectiveSundayDays;
      const sundayBonus = isManualSundayBonus ? sunOverride.manualSundayBonus : autoSundayBonus;
      const earnedSalary = regularEarned + sundayBonus;

      const itemizedExpenses = [];
      const processedExpenseKeys = new Set();

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

// Load data on module init
loadData();

module.exports = db;