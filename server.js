const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Helper to check admin password
const checkAdminAuth = async (req, res, next) => {
  const passcode = req.headers['x-admin-passcode'];
  const settings = await db.getSettings();
  if (passcode === settings.adminPasscode) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Invalid admin passcode.' });
  }
};

// Migration: ensure all employees have a token
(async function ensureEmployeeTokens() {
  const employees = await db.getEmployees();
  let updated = false;
  employees.forEach(emp => {
    if (!emp.token) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let t = '';
      for (let i = 0; i < 8; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
      emp.token = t;
      updated = true;
    }
  });
  if (updated) {
    const fs = require('fs');
    const path = require('path');
    const FILE_PATH = path.join(__dirname, 'data.json');
    const current = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    current.employees = employees;
    fs.writeFileSync(FILE_PATH, JSON.stringify(current, null, 2), 'utf8');
  }
})();

// --- API Endpoints ---

// Get active office name
app.get('/api/settings', async (req, res) => {
  const settings = await db.getSettings();
  res.json({ officeName: settings.officeName });
});

// Verify admin passcode
app.post('/api/settings/verify', async (req, res) => {
  const { passcode } = req.body;
  const settings = await db.getSettings();
  if (passcode === settings.adminPasscode) {
    res.json({ success: true, message: 'Passcode verified.' });
  } else {
    res.status(401).json({ success: false, error: 'Incorrect passcode.' });
  }
});

// Update office settings
app.post('/api/settings/update', checkAdminAuth, async (req, res) => {
  const { officeName, adminPasscode } = req.body;
  const updateData = {};
  if (officeName) updateData.officeName = officeName.trim();
  if (adminPasscode) updateData.adminPasscode = adminPasscode.trim();

  const updated = await db.updateSettings(updateData);
  res.json({ success: true, settings: { officeName: updated.officeName } });
});

// Generate permanent admin token
app.post('/api/settings/generate-admin-token', checkAdminAuth, async (req, res) => {
  try {
    const token = await db.generateAdminToken();
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all employees
app.get('/api/employees', async (req, res) => {
  try {
    const employees = await db.getEmployees();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new employee (admin only)
app.post('/api/employees', checkAdminAuth, async (req, res) => {
  const { name, role } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Employee name is required.' });
  }
  try {
    const employee = await db.addEmployee(name, role);
    res.status(201).json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a permanent share token for an employee (admin only)
app.post('/api/employees/:id/generate-token', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  const employee = db.getEmployees().find(e => e.id === id);
  if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
  // Regenerate token (optional) – ensure it's set
  employee.token = typeof employee.token === 'string' && employee.token.length === 8 ? employee.token : (function(){
    const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let t='';
    for(let i=0;i<8;i++) t+=chars.charAt(Math.floor(Math.random()*chars.length));
    return t;
  })();
  // Persist change
  const data = require('./db'); // force reload of db module (already loaded)
  const fs = require('fs');
  const path = require('path');
  const FILE_PATH = path.join(__dirname, 'data.json');
  const current = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  const idx = current.employees.findIndex(e=>e.id===id);
  if (idx!==-1) current.employees[idx].token = employee.token;
  fs.writeFileSync(FILE_PATH, JSON.stringify(current, null, 2), 'utf8');
  const link = `${req.protocol}://${req.get('host')}/?mode=employee&token=${employee.token}`;
  res.json({ success: true, link });
});



// Delete employee (admin only)
app.delete('/api/employees/:id', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  try {
    const success = db.deleteEmployee(id);
    if (success) {
      res.json({ success: true, message: 'Employee deleted.' });
    } else {
      res.status(404).json({ error: 'Employee not found.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify employee PIN
app.post('/api/employees/verify-pin', (req, res) => {
  const { employeeId, pin } = req.body;
  if (!employeeId || !pin) {
    return res.status(400).json({ success: false, error: 'Employee ID and PIN are required.' });
  }
  try {
    const verified = db.verifyEmployeePin(employeeId, pin);
    if (verified) {
      res.json({ success: true, message: 'PIN verified.' });
    } else {
      res.status(401).json({ success: false, error: 'Incorrect PIN.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update employee PIN (admin option)
app.post('/api/employees/:id/pin', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  const { pin } = req.body;
  try {
    const employee = db.updateEmployeePin(id, pin);
    res.json({ success: true, message: 'Employee PIN updated.', employee: { id: employee.id, name: employee.name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update employee PIN (employee self-update)
app.post('/api/employees/update-pin', (req, res) => {
  const { employeeId, oldPin, newPin } = req.body;
  if (!employeeId || !oldPin || !newPin) {
    return res.status(400).json({ error: 'Employee ID, current PIN, and new PIN are required.' });
  }
  try {
    const verified = db.verifyEmployeePin(employeeId, oldPin);
    if (!verified) {
      return res.status(401).json({ error: 'Incorrect current PIN.' });
    }
    db.updateEmployeePin(employeeId, newPin);
    res.json({ success: true, message: 'PIN updated successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get stats summary (can be public or auth depending on privacy, we allow it for dashboard tiles)
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance logs (admin check)
app.get('/api/attendance', checkAdminAuth, (req, res) => {
  const { date } = req.query; // Expects YYYY-MM-DD
  try {
    const attendance = db.getAttendance(date);
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get daily attendance status of a single employee
app.get('/api/attendance/status/:employeeId', (req, res) => {
  const { employeeId } = req.params;
  try {
    const status = db.getTodayAttendanceForEmployee(employeeId);
    res.json({ activeRecord: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clock In
app.post('/api/attendance/clock-in', (req, res) => {
  const { employeeId, location } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }
  try {
    const result = db.clockIn(employeeId, location);
    res.json({ success: true, message: 'Clocked in successfully!', data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Clock Out
app.post('/api/attendance/clock-out', (req, res) => {
  const { employeeId, location } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }
  try {
    const result = db.clockOut(employeeId, location);
    res.json({ success: true, message: 'Clocked out successfully!', data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// For any other route, serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start express server
app.listen(PORT, () => {
  console.log('\n================================================================');
  console.log(`⏰ Attendance System running locally at: http://localhost:${PORT}`);
  
  // Find local IP addresses
  const nets = os.networkInterfaces();
  let ipFound = false;

  console.log('\n📱 SHAREABLE LINKS FOR EMPLOYEES (On the same Wi-Fi/Network):');
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   👉  http://${net.address}:${PORT}`);
        ipFound = true;
      }
    }
  }

  if (!ipFound) {
    console.log('   ⚠️  No local network connection found. Connect to Wi-Fi to share.');
  }

  console.log('\n🌍 TO SHARE OVER THE INTERNET (Remote clock-in):');
  console.log('   You can expose this port to the internet. Recommendation:');
  console.log(`   Run this in a separate command prompt: npx localtunnel --port ${PORT}`);
  console.log('================================================================\n');

  // Add token-based direct link endpoint
  app.get('/api/employees/token/:token', (req, res) => {
    const { token } = req.params;
    try {
      const employee = db.getEmployeeByToken(token);
      if (employee) {
        res.json({ success: true, employee });
      } else {
        res.status(404).json({ success: false, error: 'Invalid token' });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
});
