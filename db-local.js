// db-local.js - Local file-based DB fallback (for testing without Supabase)
const fs = require('fs');
const path = require('path');

// Load existing data or create default
let data = { employees: [], attendance: [], workRecords: [], workProfiles: {}, settings: { adminPasscode: '1234', officeName: 'My Office' }, formSubmissions: [] };

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      data = { ...data, ...fileData, formSubmissions: fileData.formSubmissions || [] };
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
  async getEmployees(includeArchived = false) {
    const list = data.employees || [];
    return includeArchived ? list : list.filter(e => e.status !== 'DELETED' && !e.isArchived);
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
    return data.settings || { adminPasscode: '1234', officeName: 'My Office' };
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

  async getTodayAttendanceForEmployee(employeeId) {
    const today = getLocalDateString();
    const records = (data.attendance || [])
      .filter(r => r.employeeId === employeeId && r.date === today)
      .sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
    
    if (records.length === 0) return null;
    const leaveRecord = records.find(isLeaveAttendanceRecord);
    if (leaveRecord) return leaveRecord;
    return records[0];
  },

  async clockIn(employeeId, location) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      throw new Error('Please turn on location first');
    }
    const employee = data.employees.find(e => e.id === employeeId);
    if (!employee) throw new Error('Employee not found');

    const today = getLocalDateString();
    const todayRecords = (data.attendance || []).filter(r => r.employeeId === employeeId && r.date === today);
    if (todayRecords.some(isLeaveAttendanceRecord)) {
      throw new Error('Employee has a leave request for today');
    }

    const activeRecord = (data.attendance || []).find(r => r.employeeId === employeeId && !r.clockOutTime);
    if (activeRecord) throw new Error('Employee is already clocked in');

    const record = {
      id: generateId('att'),
      employeeId: employee.id,
      employeeName: employee.name,
      role: employee.role,
      date: today,
      clockInTime: new Date().toISOString(),
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
    const employee = data.employees.find(e => e.id === employeeId);
    if (!employee) throw new Error('Employee not found');

    const today = getLocalDateString();
    const record = (data.attendance || []).find(r => r.employeeId === employeeId && r.date === today && !r.clockOutTime);
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
    const existingWr = data.workRecords.find(w => w.employeeId === employeeId && w.date === today);
    if (!existingWr) {
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

    saveData();
    return { record, employee };
  },

  async getDashboardStats() {
    const today = getLocalDateString();
    const employees = data.employees || [];
    const attendance = data.attendance || [];

    const totalEmployees = employees.length;
    const activePresent = employees.filter(e => e.status === 'IN').length;
    const todayAttendance = attendance.filter(a => a.date === today);
    const todayAttendees = new Set(todayAttendance.map(r => r.employeeId));
    const presentToday = todayAttendees.size;
    const absentToday = Math.max(0, totalEmployees - presentToday);

    return {
      totalEmployees,
      activePresent,
      presentToday,
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

// Load data on module init
loadData();

module.exports = db;