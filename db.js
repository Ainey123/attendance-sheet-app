const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// Reverted to fix app

// Path to local fallback JSON file
const LOCAL_DATA_PATH = path.join(__dirname, 'data.json');

// ─── Online Database (JSONBlob) ──────────────────────────────────────────────
// Free, no account needed. Data is stored at jsonblob.com permanently.
// BLOB_ID can be set via .env for persistence across restarts.
const BLOB_ID = process.env.BLOB_ID || '019eba6c-e6b7-7b7e-b29e-a9c709180f8e';
const BLOB_URL = `https://jsonblob.com/api/jsonBlob/${BLOB_ID}`;

async function readData() {
  // 1️⃣ Try local file first (fast, works offline) 
  // BUT ONLY IF NOT ON VERCEL. Vercel always has a stale data.json file from GitHub,
  // which causes the "data lost after 3 days" bug by ignoring the remote JSONBlob.
  if (!process.env.VERCEL) {
    try {
      if (fs.existsSync(LOCAL_DATA_PATH)) {
        const raw = fs.readFileSync(LOCAL_DATA_PATH, 'utf8');
        return JSON.parse(raw);
      }
    } catch (localErr) {
      console.error('Local read failed, falling back to remote:', localErr);
    }
  }

  // 2️⃣ Remote JSONBlob fallback (Primary database for Vercel)
  try {
    const response = await fetch(BLOB_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Read failed: ${response.status}`);
    const data = await response.json();
    
    // Persist a local copy for future fast reads (only useful locally, ignored on Vercel)
    if (!process.env.VERCEL) {
      try { fs.writeFileSync(LOCAL_DATA_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
    }
    return data;
  } catch (err) {
    console.error('Error reading database (remote):', err);
    // Return a clean default structure so the app continues to work
    return {
      employees: [],
      attendance: [],
      workRecords: [],
      workProfiles: {},
      settings: { adminPasscode: '1234', officeName: 'My Office' }
    };
  }
}

// Write all data to the online database
async function writeData(data) {
  // Write to local file first (only if not on Vercel)
  if (!process.env.VERCEL) {
    try {
      fs.writeFileSync(LOCAL_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (localErr) {
      console.error('Local write failed:', localErr);
    }
  }

  // Push the update to the remote JSONBlob (this is the permanent cloud backup)
  try {
    const response = await fetch(BLOB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`Write failed: ${response.status}`);
    return true;
  } catch (err) {
    console.error('Remote write failed (JSONBlob):', err);
    return false;
  }
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

const db = {
  // --- Employee Methods ---
  async getEmployees() {
    const data = await readData();
    return data.employees;
  },

  async getEmployeeByToken(token) {
    const data = await readData();
    return data.employees.find(e => e.token === token) || null;
  },

  async addEmployee(name, role) {
    const data = await readData();
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
    await writeData(data);
    return newEmployee;
  },

  async deleteEmployee(id) {
    const data = await readData();
    const index = data.employees.findIndex(e => e.id === id);
    if (index !== -1) {
      data.employees.splice(index, 1);
      await writeData(data);
      return true;
    }
    return false;
  },

  async verifyEmployeePin(employeeId, pin) {
    const data = await readData();
    const employee = data.employees.find(e => e.id === employeeId);
    if (!employee) return false;
    return employee.pin === String(pin).trim();
  },

  async updateEmployeePin(employeeId, newPin) {
    const data = await readData();
    const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
    if (employeeIndex === -1) throw new Error('Employee not found');
    const cleanedPin = String(newPin).trim();
    if (!/^\d{4}$/.test(cleanedPin)) throw new Error('PIN must be exactly 4 digits');
    data.employees[employeeIndex].pin = cleanedPin;
    await writeData(data);
    return data.employees[employeeIndex];
  },

  // --- Settings Methods ---
  async getSettings() {
    const data = await readData();
    return data.settings || { adminPasscode: '1234', officeName: 'My Office' };
  },

  async updateSettings(newSettings) {
    const data = await readData();
    data.settings = { ...data.settings, ...newSettings };
    await writeData(data);
    return data.settings;
  },

  async generateAdminToken() {
    const token = crypto.randomBytes(16).toString('hex');
    const data = await readData();
    data.settings.adminToken = token;
    await writeData(data);
    return token;
  },

  // --- Attendance Methods ---
  async getAttendance(filterDate = null) {
    const data = await readData();
    let records = data.attendance;
    if (filterDate) {
      records = records.filter(r => r.date === filterDate);
    }
    return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
  },

  async getTodayAttendanceForEmployee(employeeId) {
    const data = await readData();
    const today = getLocalDateString();
    const records = data.attendance.filter(r => r.employeeId === employeeId && r.date === today);
    if (records.length === 0) return null;
    const active = records.find(r => !r.clockOutTime);
    if (active) return active;
    return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime))[0];
  },

  async clockIn(employeeId, location) {
    const data = await readData();
    const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
    if (employeeIndex === -1) throw new Error('Employee not found');

    const employee = data.employees[employeeIndex];
    const activeRecord = data.attendance.find(r => r.employeeId === employeeId && !r.clockOutTime);
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

    data.attendance.push(record);
    employee.status = 'IN';
    await writeData(data);
    return { record, employee };
  },
  // Clock Out with required performance notes and money spent and optional image
  async clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image) {
    if (performanceNotes === undefined || performanceNotes === null) {
      throw new Error('Performance notes are required');
    }
    const data = await readData();
    const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
    if (employeeIndex === -1) throw new Error('Employee not found');

    const employee = data.employees[employeeIndex];
    const recordIndex = data.attendance.findIndex(r => r.employeeId === employeeId && !r.clockOutTime);
    if (recordIndex === -1) throw new Error('Employee is not clocked in');

    const record = data.attendance[recordIndex];
    const now = new Date();
    record.clockOutTime = now.toISOString();
    record.clockOutLocation = location || null;
    const inTime = new Date(record.clockInTime);
    record.duration = Math.round((now - inTime) / (1000 * 60));
    record.performanceNotes = performanceNotes;
    record.receivedAmount = Number(receivedAmount) || 0;
    record.expenseAmount = Number(expenseAmount) || 0;
    record.moneySpent = record.expenseAmount; // back-compat
    record.image = image || null;
    employee.status = 'OUT';

    // Auto-create a work record for the day
    if (!data.workRecords) data.workRecords = [];
    const dateStr = record.date;
    const monthStr = dateStr.substring(0, 7);
    
    let wr = data.workRecords.find(w => w.employeeId === employeeId && w.date === dateStr);
    if (!wr) {
       wr = {
         id: generateId('wr'),
         employeeId: employee.id,
         employeeName: employee.name,
         month: monthStr,
         date: dateStr,
         performedWork: performanceNotes,
         receivedAmount: record.receivedAmount,
         expenseAmount: record.expenseAmount,
         paymentIssuance: record.receivedAmount,
         balancePayment: '',
         materialIssuance: '',
         materialBalance: '',
         otherRemarks: '',
         createdAt: now.toISOString()
       };
       data.workRecords.push(wr);
    } else {
       wr.performedWork = performanceNotes;
       wr.receivedAmount = record.receivedAmount;
       wr.expenseAmount = record.expenseAmount;
       wr.paymentIssuance = record.receivedAmount;
    }

    await writeData(data);
    return { record, employee };
  },

  async getDashboardStats() {
    const data = await readData();
    const today = getLocalDateString();
    const totalEmployees = data.employees.length;
    const activePresent = data.employees.filter(e => e.status === 'IN').length;
    const todayAttendees = new Set(
      data.attendance.filter(r => r.date === today).map(r => r.employeeId)
    );
    const presentToday = todayAttendees.size;
    const absentToday = Math.max(0, totalEmployees - presentToday);
    return {
      totalEmployees,
      activePresent,
      presentToday,
      absentToday,
      officeName: data.settings.officeName
    };
  },

  // --- Monthly Work & Payment Records ---
  async getWorkRecords(employeeId, month = null) {
    const data = await readData();
    let records = data.workRecords || [];
    
    // Sort all records chronologically first to ensure correct balance calculations
    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Group records by employeeId to compute individual running balances
    const recordsByEmployee = {};
    records.forEach(r => {
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
        // Backwards compatibility with paymentIssuance
        const received = Number(r.receivedAmount !== undefined ? r.receivedAmount : (r.paymentIssuance || 0));
        const expense = Number(r.expenseAmount || 0);
        
        r.carriedOverBalance = runningBalance;
        r.totalReceived = runningBalance + received;
        r.remainingBalance = r.totalReceived - expense;
        
        // Update r's properties so the client receives computed values
        r.receivedAmount = r.receivedAmount !== undefined ? r.receivedAmount : (r.paymentIssuance || 0);
        r.expenseAmount = r.expenseAmount || 0;
        
        // Also update legacy fields for older code if any
        r.paymentIssuance = r.receivedAmount;
        r.balancePayment = String(r.remainingBalance);
        
        runningBalance = r.remainingBalance;
        processedRecords.push(r);
      });
    }
    
    // Now filter by employeeId if requested
    let result = processedRecords;
    if (employeeId) {
      result = result.filter(r => r.employeeId === employeeId);
    }
    
    // Filter by month if requested
    if (month) {
      result = result.filter(r => r.month === month);
    }
    
    // Sort final result chronologically
    return result.sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  async getWorkProfile(employeeId, month) {
    const data = await readData();
    const profiles = data.workProfiles || {};
    return profiles[`${employeeId}:${month}`] || { fatherName: '' };
  },

  async saveWorkProfile(employeeId, month, fatherName) {
    const data = await readData();
    if (!data.workProfiles) data.workProfiles = {};
    data.workProfiles[`${employeeId}:${month}`] = { fatherName: String(fatherName || '').trim() };
    await writeData(data);
    return data.workProfiles[`${employeeId}:${month}`];
  },

  async addWorkRecord(record) {
    const data = await readData();
    if (!data.workRecords) data.workRecords = [];
    const employee = data.employees.find(e => e.id === record.employeeId);
    
    // Use receivedAmount (or fall back to paymentIssuance for safety)
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
      paymentIssuance: payment === '' || payment == null ? null : Number(payment), // back-compat
      balancePayment: String(record.balancePayment || '').trim(), // back-compat
      materialIssuance: String(record.materialIssuance || '').trim(),
      materialBalance: String(record.materialBalance || '').trim(),
      otherRemarks: String(record.otherRemarks || '').trim(),
      createdAt: new Date().toISOString()
    };
    data.workRecords.push(newRecord);
    await writeData(data);
    return newRecord;
  },

  async updateWorkRecord(id, employeeId, updates) {
    const data = await readData();
    const idx = (data.workRecords || []).findIndex(r => r.id === id && r.employeeId === employeeId);
    if (idx === -1) throw new Error('Record not found');
    const r = data.workRecords[idx];
    if (updates.date !== undefined) r.date = updates.date;
    if (updates.performedWork !== undefined) r.performedWork = String(updates.performedWork).trim();
    
    if (updates.receivedAmount !== undefined) {
      r.receivedAmount = updates.receivedAmount === '' || updates.receivedAmount == null ? 0 : Number(updates.receivedAmount);
      r.paymentIssuance = r.receivedAmount; // back-compat
    } else if (updates.paymentIssuance !== undefined) {
      r.receivedAmount = updates.paymentIssuance === '' || updates.paymentIssuance == null ? 0 : Number(updates.paymentIssuance);
      r.paymentIssuance = r.receivedAmount;
    }
    
    if (updates.expenseAmount !== undefined) {
      r.expenseAmount = updates.expenseAmount === '' || updates.expenseAmount == null ? 0 : Number(updates.expenseAmount);
    }
    
    if (updates.balancePayment !== undefined) r.balancePayment = String(updates.balancePayment).trim();
    if (updates.materialIssuance !== undefined) r.materialIssuance = String(updates.materialIssuance).trim();
    if (updates.materialBalance !== undefined) r.materialBalance = String(updates.materialBalance).trim();
    if (updates.otherRemarks !== undefined) r.otherRemarks = String(updates.otherRemarks).trim();
    await writeData(data);
    return r;
  },

  async deleteWorkRecord(id, employeeId) {
    const data = await readData();
    const idx = (data.workRecords || []).findIndex(r => r.id === id && r.employeeId === employeeId);
    if (idx === -1) return false;
    data.workRecords.splice(idx, 1);
    await writeData(data);
    return true;
  }
};

module.exports = db;
