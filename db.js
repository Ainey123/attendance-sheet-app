const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'data.json');
const CSV_FILE_PATH = path.join(__dirname, 'attendance_sheet.csv');

// Auto-generate Excel-compatible CSV list of all attendance logs
function regenerateCSV(data) {
  try {
    const headers = [
      'Employee Name',
      'Role',
      'Date',
      'Clock In Time',
      'Clock Out Time',
      'Duration (Mins)',
      'Clock In Location',
      'Clock Out Location'
    ];
    
    // Sort attendance by clock in time descending (newest at the top)
    const sortedAttendance = [...data.attendance].sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
    
    const rows = [headers.join(',')];
    
    sortedAttendance.forEach(log => {
      const formatLocation = (loc) => {
        if (!loc) return 'No GPS';
        return `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
      };

      const formatTime = (isoString) => {
        if (!isoString) return '';
        const d = new Date(isoString);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      };

      const durationText = log.duration !== null ? log.duration : 'Active';

      const row = [
        `"${log.employeeName.replace(/"/g, '""')}"`,
        `"${(log.role || 'Staff').replace(/"/g, '""')}"`,
        log.date,
        formatTime(log.clockInTime),
        log.clockOutTime ? formatTime(log.clockOutTime) : 'Active',
        durationText,
        `"${formatLocation(log.clockInLocation)}"`,
        `"${formatLocation(log.clockOutLocation)}"`
      ];
      rows.push(row.join(','));
    });
    
    fs.writeFileSync(CSV_FILE_PATH, rows.join('\r\n'), 'utf8');
  } catch (err) {
    console.error('Error generating CSV sheet:', err);
  }
}

// Initialize database file if it doesn't exist or is empty
function initDb() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      const initialData = {
        employees: [
          { id: 'emp_demo1', name: 'John Doe', role: 'Developer', status: 'OUT', pin: '1234', dateCreated: new Date().toISOString() },
          { id: 'emp_demo2', name: 'Jane Smith', role: 'Designer', status: 'OUT', pin: '1234', dateCreated: new Date().toISOString() }
        ],
        attendance: [],
        settings: {
          adminPasscode: '1234',
          officeName: 'My Office'
        }
      };
      fs.writeFileSync(FILE_PATH, JSON.stringify(initialData, null, 2), 'utf8');
      regenerateCSV(initialData);
    } else {
      // Validate that it contains valid JSON
      const content = fs.readFileSync(FILE_PATH, 'utf8');
      const parsed = JSON.parse(content);
      // Migrate existing employees to have a default PIN if missing
      let migrated = false;
      parsed.employees.forEach(emp => {
        if (!emp.pin) {
          emp.pin = '1234';
          migrated = true;
        }
      });
      if (migrated) {
        fs.writeFileSync(FILE_PATH, JSON.stringify(parsed, null, 2), 'utf8');
      }
      regenerateCSV(parsed);
    }
  } catch (err) {
    console.error('Database initialization failed, resetting database:', err);
    const initialData = {
      employees: [],
      attendance: [],
      settings: {
        adminPasscode: '1234',
        officeName: 'My Office'
      }
    };
    fs.writeFileSync(FILE_PATH, JSON.stringify(initialData, null, 2), 'utf8');
    regenerateCSV(initialData);
  }
}

// Read database helper
function readData() {
  try {
    initDb();
    const content = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading database:', err);
    return { employees: [], attendance: [], settings: { adminPasscode: '1234', officeName: 'My Office' } };
  }
}

// Write database helper
function writeData(data) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    regenerateCSV(data);
    return true;
  } catch (err) {
    console.error('Error writing database:', err);
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
  getEmployees() {
    const data = readData();
    return data.employees;
  },

  getEmployeeByToken(token) {
    const data = readData();
    return data.employees.find(e => e.token === token) || null;
  },

  // Add token to new employee
  addEmployee(name, role) {
    const data = readData();
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
    writeData(data);
    return newEmployee;
  },

  deleteEmployee(id) {
    const data = readData();
    const index = data.employees.findIndex(e => e.id === id);
    if (index !== -1) {
      data.employees.splice(index, 1);
      // Clean up outstanding checkins
      writeData(data);
      return true;
    }
    return false;
  },

  verifyEmployeePin(employeeId, pin) {
    const data = readData();
    const employee = data.employees.find(e => e.id === employeeId);
    if (!employee) {
      return false;
    }
    return employee.pin === String(pin).trim();
  },

  updateEmployeePin(employeeId, newPin) {
    const data = readData();
    const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
    if (employeeIndex === -1) {
      throw new Error('Employee not found');
    }
    const cleanedPin = String(newPin).trim();
    if (!/^\d{4}$/.test(cleanedPin)) {
      throw new Error('PIN must be exactly 4 digits');
    }
    data.employees[employeeIndex].pin = cleanedPin;
    writeData(data);
    return data.employees[employeeIndex];
  },

  // --- Settings Methods ---
  getSettings() {
    const data = readData();
    return data.settings || { adminPasscode: '1234', officeName: 'My Office' };
  },

  updateSettings(newSettings) {
    const data = readData();
    data.settings = { ...data.settings, ...newSettings };
    writeData(data);
    return data.settings;
  },

  // --- Attendance Methods ---
  getAttendance(filterDate = null) {
    const data = readData();
    let records = data.attendance;
    
    if (filterDate) {
      records = records.filter(r => r.date === filterDate);
    }
    
    // Sort by clock-in time descending
    return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime));
  },

  getTodayAttendanceForEmployee(employeeId) {
    const data = readData();
    const today = getLocalDateString();
    // Find a record for today where clockOutTime is null (active checkin) or the most recent checkin
    const records = data.attendance.filter(r => r.employeeId === employeeId && r.date === today);
    if (records.length === 0) return null;
    
    // Return active check-in if it exists
    const active = records.find(r => !r.clockOutTime);
    if (active) return active;

    // Otherwise return the most recent completed check-in of today
    return records.sort((a, b) => new Date(b.clockInTime) - new Date(a.clockInTime))[0];
  },

  clockIn(employeeId, location) {
    const data = readData();
    const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
    
    if (employeeIndex === -1) {
      throw new Error('Employee not found');
    }

    const employee = data.employees[employeeIndex];

    // Check if employee is already clocked in
    // Note: We check if there's any active record (clockOutTime is null) regardless of date
    const activeRecord = data.attendance.find(r => r.employeeId === employeeId && !r.clockOutTime);
    if (activeRecord) {
      throw new Error('Employee is already clocked in');
    }

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
    
    writeData(data);
    return { record, employee };
  },

  clockOut(employeeId, location) {
    const data = readData();
    const employeeIndex = data.employees.findIndex(e => e.id === employeeId);
    
    if (employeeIndex === -1) {
      throw new Error('Employee not found');
    }

    const employee = data.employees[employeeIndex];

    // Find the active check-in record
    const recordIndex = data.attendance.findIndex(r => r.employeeId === employeeId && !r.clockOutTime);
    if (recordIndex === -1) {
      throw new Error('Employee is not clocked in');
    }

    const record = data.attendance[recordIndex];
    const now = new Date();
    
    record.clockOutTime = now.toISOString();
    record.clockOutLocation = location || null;

    // Calculate duration in minutes
    const inTime = new Date(record.clockInTime);
    const diffMs = now - inTime;
    record.duration = Math.round(diffMs / (1000 * 60)); // In minutes

    employee.status = 'OUT';

    writeData(data);
    return { record, employee };
  },

  // Get active dashboard statistics
  getDashboardStats() {
    const data = readData();
    const today = getLocalDateString();
    
    const totalEmployees = data.employees.length;
    const activePresent = data.employees.filter(e => e.status === 'IN').length;
    
    // Count unique employees who clocked in today at least once
    const todayAttendees = new Set(
      data.attendance
        .filter(r => r.date === today)
        .map(r => r.employeeId)
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
  }
};

// Initialize DB file immediately on load
initDb();

module.exports = db;
