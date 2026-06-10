const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// Uses global fetch (Node.js 18+ built-in) — no node-fetch import needed
// Path to local fallback JSON file
const LOCAL_DATA_PATH = path.join(__dirname, 'data.json');

// ─── Online Database (JSONBlob) ──────────────────────────────────────────────
// Free, no account needed. Data is stored at jsonblob.com permanently.
// BLOB_ID can be set via .env for persistence across restarts.
const BLOB_ID = process.env.BLOB_ID || '019e9cae-8ba5-7613-9c4d-0a15a944c498';
const BLOB_URL = `https://jsonblob.com/api/jsonBlob/${BLOB_ID}`;

// Read all data from the online database
async function readData() {
  // 1️⃣ Try local file first (fast, works offline)
  try {
    if (fs.existsSync(LOCAL_DATA_PATH)) {
      const raw = fs.readFileSync(LOCAL_DATA_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (localErr) {
    console.error('Local read failed, falling back to remote:', localErr);
  }

  // 2️⃣ Remote JSONBlob fallback (keeps compatibility with existing deployments)
  try {
    const response = await fetch(BLOB_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Read failed: ${response.status}`);
    const data = await response.json();
    // Persist a local copy for future fast reads
    try { fs.writeFileSync(LOCAL_DATA_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
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
  // Write to local file first – ensures immediate persistence without network latency
  try {
    fs.writeFileSync(LOCAL_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (localErr) {
    console.error('Local write failed:', localErr);
    // Continue to remote write so we keep both copies in sync
  }

  // Then push the update to the remote JSONBlob (maintains the original cloud backup)
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
    // Return false only if both writes failed – local succeeded, so we consider the operation successful for the app
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
  // Clock Out with required performance notes and money spent
  async clockOut(employeeId, location, performanceNotes, moneySpent) {
    if (performanceNotes === undefined || performanceNotes === null) {
      throw new Error('Performance notes are required');
    }
    if (moneySpent === undefined || moneySpent === null) {
      throw new Error('Money spent is required');
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
    record.moneySpent = Number(moneySpent);
    employee.status = 'OUT';

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
    if (employeeId) records = records.filter(r => r.employeeId === employeeId);
    if (month) records = records.filter(r => r.month === month);
    return records.sort((a, b) => new Date(a.date) - new Date(b.date));
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
    const payment = record.paymentIssuance;
    const newRecord = {
      id: generateId('wr'),
      employeeId: record.employeeId,
      employeeName: employee ? employee.name : record.employeeName || '',
      month: record.month,
      date: record.date,
      performedWork: String(record.performedWork || '').trim(),
      paymentIssuance: payment === '' || payment == null ? null : Number(payment),
      balancePayment: String(record.balancePayment || '').trim(),
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
    if (updates.paymentIssuance !== undefined) {
      r.paymentIssuance = updates.paymentIssuance === '' || updates.paymentIssuance == null
        ? null
        : Number(updates.paymentIssuance);
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
