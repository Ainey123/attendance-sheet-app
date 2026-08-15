const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config();

const db = require('./db');

// Initialize Supabase client only if credentials exist
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

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

// Migration: ensure all employees have a token (now handled by Supabase)
// Tokens are generated at employee creation time in db.js

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

// Get employee by share token (public)
app.get('/api/employees/token/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const employee = await db.getEmployeeByToken(token);
    if (employee) {
      res.json({ success: true, employee });
    } else {
      res.status(404).json({ success: false, error: 'Invalid token' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate a permanent share token for an employee (admin only)
app.post('/api/employees/:id/generate-token', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const employees = await db.getEmployees();
    const employee = employees.find(e => e.id === id);
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // If employee has no valid token, generate one
    if (!employee.token || employee.token.length !== 8) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let token = '';
      for (let i = 0; i < 8; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
      employee.token = token;
      // Update using db module (handles both Supabase and local)
      await db.updateEmployeeToken(id, token);
    }

    const link = `${req.protocol}://${req.get('host')}/?mode=employee&token=${employee.token}`;
    res.json({ success: true, link });
  } catch (err) {
    console.error('Token generation error:', err);
    // Return existing employee link anyway
    const employees = await db.getEmployees();
    const employee = employees.find(e => e.id === id);
    if (employee && employee.token) {
      const link = `${req.protocol}://${req.get('host')}/?mode=employee&token=${employee.token}`;
      res.json({ success: true, link });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Reset employee token (admin only)
app.post('/api/employees/:id/reset-token', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.resetEmployeeToken(id);
    const origin = `${req.protocol}://${req.get('host')}`;
    const link = `${origin}/?mode=employee&token=${result.token}`;
    res.json({ success: true, link, token: result.token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete employee (admin only)
app.delete('/api/employees/:id', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const success = await db.deleteEmployee(id);
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
app.post('/api/employees/verify-pin', async (req, res) => {
  const { employeeId, pin } = req.body;
  if (!employeeId || !pin) {
    return res.status(400).json({ success: false, error: 'Employee ID and PIN are required.' });
  }
  try {
    const verified = await db.verifyEmployeePin(employeeId, pin);
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
app.post('/api/employees/:id/pin', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { pin } = req.body;
  try {
    const employee = await db.updateEmployeePin(id, pin);
    res.json({ success: true, message: 'Employee PIN updated.', employee: { id: employee.id, name: employee.name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update employee PIN (employee self-update)
app.post('/api/employees/update-pin', async (req, res) => {
  const { employeeId, oldPin, newPin } = req.body;
  if (!employeeId || !oldPin || !newPin) {
    return res.status(400).json({ error: 'Employee ID, current PIN, and new PIN are required.' });
  }
  try {
    const verified = await db.verifyEmployeePin(employeeId, oldPin);
    if (!verified) {
      return res.status(401).json({ error: 'Incorrect current PIN.' });
    }
    await db.updateEmployeePin(employeeId, newPin);
    res.json({ success: true, message: 'PIN updated successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get stats summary (can be public or auth depending on privacy, we allow it for dashboard tiles)
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance logs (admin check)
app.get('/api/attendance', checkAdminAuth, async (req, res) => {
  const { date } = req.query;
  try {
    const attendance = await db.getAttendance(date);
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get daily attendance status of a single employee
app.get('/api/attendance/status/:employeeId', async (req, res) => {
  const { employeeId } = req.params;
  try {
    const status = await db.getTodayAttendanceForEmployee(employeeId);
    res.json({ activeRecord: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get monthly attendance summary across all staff with optional tenure date range filter
app.get('/api/attendance/monthly-summary', async (req, res) => {
  const { month, startDate, endDate } = req.query;
  db.autoCompleteOldAttendance().catch(e => console.warn('autoCompleteOldAttendance error:', e.message));
  try {
    const summary = await db.getMonthlySummary(month || null, startDate || null, endDate || null);
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get detailed individual attendance history by employee ID or full name with tenure filter
app.get('/api/attendance/individual', async (req, res) => {
  const { employeeId, employeeName, startDate, endDate, month } = req.query;
  try {
    const data = await db.getIndividualAttendance({ employeeId, employeeName, startDate, endDate, month });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resolve unclocked-out attendance record (admin action)
app.post('/api/attendance/resolve', checkAdminAuth, async (req, res) => {
  const { attendanceId, clockOutTime, performanceNotes, expenseAmount } = req.body;
  if (!attendanceId) return res.status(400).json({ error: 'attendanceId required' });
  try {
    const record = await db.resolveUnclockedOutAttendance(attendanceId, clockOutTime, performanceNotes, expenseAmount);
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clock In
app.post('/api/attendance/clock-in', async (req, res) => {
  const { employeeId, location } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return res.status(400).json({ success: false, error: 'Please turn on location first' });
  }
  try {
    const result = await db.clockIn(employeeId, location);
    res.json({ success: true, message: 'Clocked in successfully!', data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Clock Out
app.post('/api/attendance/clock-out', async (req, res) => {
  const { employeeId, location, performanceNotes, receivedAmount, expenseAmount, image } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }
  try {
    const result = await db.clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image);
    res.json({ success: true, message: 'Clocked out successfully!', data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- Work & Payment Records ---

app.get('/api/work-records', async (req, res) => {
  const { employeeId, month } = req.query;
  try {
    const records = await db.getWorkRecords(employeeId || null, month || null);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/work-records/profile', async (req, res) => {
  const { employeeId, month } = req.query;
  if (!employeeId || !month) {
    return res.status(400).json({ error: 'employeeId and month are required.' });
  }
  try {
    const profile = await db.getWorkProfile(employeeId, month);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/work-records/profile', async (req, res) => {
  const { employeeId, month, fatherName } = req.body;
  if (!employeeId || !month) {
    return res.status(400).json({ error: 'employeeId and month are required.' });
  }
  try {
    const profile = await db.saveWorkProfile(employeeId, month, fatherName);
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/work-records', async (req, res) => {
  const { employeeId, month, date, performedWork } = req.body;
  if (!employeeId || !month || !date) {
    return res.status(400).json({ error: 'employeeId, month, and date are required.' });
  }
  if (!performedWork || !String(performedWork).trim()) {
    return res.status(400).json({ error: 'Performed work description is required.' });
  }
  try {
    const record = await db.addWorkRecord(req.body);
    res.status(201).json({ success: true, record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-records/:id', async (req, res) => {
  const { id } = req.params;
  const { employeeId, ...updates } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'employeeId is required.' });
  }
  try {
    const record = await db.updateWorkRecord(id, employeeId, updates);
    res.json({ success: true, record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/work-records/:id', async (req, res) => {
  const { id } = req.params;
  const { employeeId } = req.query;
  if (!employeeId) {
    return res.status(400).json({ error: 'employeeId is required.' });
  }
  try {
    const success = await db.deleteWorkRecord(id, employeeId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Record not found.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Form Submissions ---

// Get form submissions (public endpoint for employee to see their own)
app.get('/api/forms', async (req, res) => {
  const { employeeId, type } = req.query;
  try {
    const submissions = await db.getFormSubmissions(employeeId || null, type || null);
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single form submission
app.get('/api/forms/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const submission = await db.getFormSubmission(id);
    if (submission) {
      res.json({ success: true, submission });
    } else {
      res.status(404).json({ success: false, error: 'Form submission not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new form submission (employee submits)
app.post('/api/forms', async (req, res) => {
  const { employeeId, employeeName, formType, formData } = req.body;
  if (!employeeId || !formType || !formData) {
    return res.status(400).json({ error: 'Employee ID, form type, and form data are required.' });
  }
  try {
    const submission = await db.saveFormSubmission(employeeId, employeeName, formType, formData);
    res.status(201).json({ success: true, submission });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update form submission (employee can update their own)
app.put('/api/forms/:id', async (req, res) => {
  const { id } = req.params;
  const { employeeId, ...updates } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }
  try {
    const submission = await db.updateFormSubmission(id, employeeId, updates);
    res.json({ success: true, submission });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete form submission (employee can delete their own)
app.delete('/api/forms/:id', async (req, res) => {
  const { id } = req.params;
  const { employeeId } = req.body;
  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }
  try {
    const success = await db.deleteFormSubmission(id, employeeId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Record not found.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Comments API ---
app.get('/api/comments', async (req, res) => {
  try {
    const comments = await db.getComments(req.query.employeeId || null);
    res.json({ comments: Array.isArray(comments) ? comments : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/comments', async (req, res) => {
  const { employeeId, employeeName, sender, senderName, message } = req.body;
  if (!employeeId || !message) {
    return res.status(400).json({ error: 'employeeId and message required' });
  }
  try {
    const comment = await db.addComment({ employeeId, employeeName, sender, senderName, message });
    res.status(201).json({ success: true, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/comments/:id', checkAdminAuth, async (req, res) => {
  try {
    const success = await db.deleteComment(req.params.id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/comments/unread — unread admin messages for an employee
app.get('/api/comments/unread', async (req, res) => {
  try {
    const empId = req.query.employeeId;
    if (!empId) return res.status(400).json({ error: 'employeeId required' });
    const result = await db.getUnreadAdminMessages(empId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comments/mark-read — mark all admin messages as read for an employee
app.post('/api/comments/mark-read', async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
    await db.markMessagesRead(employeeId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ─── Salary Routes ─────────────────────────────────────────────────────────

// GET /api/salary?month=YYYY-MM — list all salary records for a month
app.get('/api/salary', checkAdminAuth, async (req, res) => {
  try {
    const records = await db.getAllSalaries(req.query.month || null);
    res.json({ success: true, salaries: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary/:employeeId?month=YYYY-MM
app.get('/api/salary/:employeeId', checkAdminAuth, async (req, res) => {
  try {
    const record = await db.getSalaryRecord(req.params.employeeId, req.query.month || null);
    res.json({ success: true, salary: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary/set-basic — admin sets basic salary
app.post('/api/salary/set-basic', checkAdminAuth, async (req, res) => {
  try {
    const { employeeId, month, basicSalary } = req.body;
    if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
    const rec = await db.setSalaryBasic(employeeId, month, basicSalary || 0);
    res.json({ success: true, salary: rec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary/generate — generate/recalculate salary for one employee
app.post('/api/salary/generate', checkAdminAuth, async (req, res) => {
  try {
    const { employeeId, month } = req.body;
    if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
    const rec = await db.generateSalary(employeeId, month);
    res.json({ success: true, salary: rec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary/generate-all — generate salary for every active employee
app.post('/api/salary/generate-all', checkAdminAuth, async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ error: 'month required' });
    const results = await db.generateAllSalaries(month);
    res.json({ success: true, salaries: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

  const nets = os.networkInterfaces();
  let ipFound = false;

  console.log('\n📱 SHAREABLE LINKS FOR EMPLOYEES (On the same Wi-Fi/Network):');
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
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
});
