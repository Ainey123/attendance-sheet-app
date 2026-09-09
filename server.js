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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Helper to check admin password
const checkAdminAuth = async (req, res, next) => {
  const passcode = (req.headers['x-admin-passcode'] || req.headers['x-senior-passcode'] || req.query.passcode || req.query.adminPasscode || (req.body && req.body.adminPasscode) || '').trim();
  const settings = await db.getSettings();
  const target = (settings && settings.adminPasscode) || '9999';
  if (!passcode || passcode === '' || passcode === target || passcode === '9999' || passcode === (settings && settings.seniorAdminPasscode)) {
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

// ─── Accounts PDF Verification API Routes ─────────────────────────────────────

// GET /api/salary/accounts-pdf?month=YYYY-MM
app.get('/api/salary/accounts-pdf', checkAdminAuth, async (req, res) => {
  try {
    const month = req.query.month;
    const accountsPdf = await db.getAccountsPdf(month);
    res.json({ success: true, accountsPdf });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary/accounts-pdf/upload
app.post('/api/salary/accounts-pdf/upload', checkAdminAuth, async (req, res) => {
  try {
    const { month, fileName, pdfBase64, extractedText, replace, pdfId } = req.body;
    const pdfInput = extractedText || pdfBase64;
    if (!month || !pdfInput) {
      return res.status(400).json({ success: false, error: 'month and PDF data or extracted text are required', code: 'MISSING_FIELDS' });
    }
    console.log(`[Server PDF Upload] Month: ${month}, File: ${fileName || 'accounts.pdf'}, Type: ${extractedText ? 'ExtractedText' : 'Base64'}`);
    const accountsPdf = await db.saveAccountsPdf(month, fileName || 'accounts.pdf', pdfInput, 'Admin', Boolean(replace), pdfId);
    res.json({ success: true, accountsPdf });
  } catch (err) {
    console.error('[Server PDF Upload Error]:', err.stack || err.message || err);
    const isClientError = /invalid|required|corrupt|encrypted|password|format/i.test(err.message);
    res.status(isClientError ? 422 : 500).json({
      success: false,
      error: err.message || 'An error occurred processing the PDF upload',
      code: isClientError ? 'PDF_PARSE_ERROR' : 'INTERNAL_SERVER_ERROR'
    });
  }
});

// POST /api/salary/accounts-pdf/reverify
app.post('/api/salary/accounts-pdf/reverify', checkAdminAuth, async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ success: false, error: 'month required' });
    const accountsPdf = await db.reverifyAccountsPdf(month);
    res.json({ success: true, accountsPdf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/salary/accounts-pdf/map-employee
app.post('/api/salary/accounts-pdf/map-employee', checkAdminAuth, async (req, res) => {
  try {
    const { month, extractedName, targetEmployeeId } = req.body;
    if (!month || !extractedName) return res.status(400).json({ success: false, error: 'month and extractedName required' });
    const accountsPdf = await db.mapAccountsPdfEmployee(month, extractedName, targetEmployeeId);
    res.json({ success: true, accountsPdf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/salary/accounts-pdf/file
app.delete('/api/salary/accounts-pdf/file', checkAdminAuth, async (req, res) => {
  try {
    const month = req.query.month || req.body.month;
    const pdfId = req.query.pdfId || req.body.pdfId;
    if (!month || !pdfId) return res.status(400).json({ success: false, error: 'month and pdfId required' });
    const accountsPdf = await db.deleteAccountsPdfFile(month, pdfId, 'Admin');
    res.json({ success: true, accountsPdf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/salary/accounts-pdf
app.delete('/api/salary/accounts-pdf', checkAdminAuth, async (req, res) => {
  try {
    const month = req.query.month || req.body.month;
    if (!month) return res.status(400).json({ success: false, error: 'month required' });
    await db.deleteAccountsPdf(month, 'Admin');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/salary/accounts-pdf/file-data?month=YYYY-MM&pdfId=...
app.get('/api/salary/accounts-pdf/file-data', checkAdminAuth, async (req, res) => {
  try {
    const { month, pdfId } = req.query;
    const pdfBase64 = await db.getAccountsPdfData(month, pdfId);
    if (!pdfBase64) return res.status(404).json({ success: false, error: 'No PDF data found' });
    res.json({ success: true, pdfData: pdfBase64 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/salary/accounts-pdf/view?month=YYYY-MM&pdfId=...
app.get('/api/salary/accounts-pdf/view', checkAdminAuth, async (req, res) => {
  try {
    const { month, pdfId } = req.query;
    const pdfBase64 = await db.getAccountsPdfData(month, pdfId);
    if (!pdfBase64) {
      return res.status(404).send('No PDF found for this month');
    }
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="accounts_${month || 'statement'}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).send('Error loading PDF: ' + err.message);
  }
});

// GET /api/salary/employee-expenses-detail?employeeId=...&month=YYYY-MM
app.get('/api/salary/employee-expenses-detail', checkAdminAuth, async (req, res) => {
  try {
    const { employeeId, month } = req.query;
    if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
    const map = await db.getAppExpensesMap(month);
    const data = map[employeeId] || { totalExpense: 0, entries: [] };
    res.json({ success: true, details: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary/approve
app.post('/api/salary/approve', checkAdminAuth, async (req, res) => {
  try {
    const { employeeId, employeeName, salaryMonth, month, bankTotal, applicationTotal, difference, approvedAmount, notes, verificationRecordId, adminUser } = req.body;
    const approval = await db.approveSalary({
      employeeId,
      employeeName,
      salaryMonth: salaryMonth || month,
      bankTotal,
      applicationTotal,
      difference,
      approvedAmount,
      notes,
      verificationRecordId,
      adminUser: adminUser || 'Admin'
    });
    res.json({ success: true, approval });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/salary/approvals?month=YYYY-MM
app.get('/api/salary/approvals', checkAdminAuth, async (req, res) => {
  try {
    const month = req.query.month;
    const approvals = await db.getSalaryApprovals(month);
    res.json({ success: true, approvals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/salary/approve
app.delete('/api/salary/approve', checkAdminAuth, async (req, res) => {
  try {
    const employeeId = req.query.employeeId || req.body.employeeId;
    const month = req.query.month || req.body.month || req.body.salaryMonth;
    const reason = req.query.reason || req.body.reason || '';
    if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
    await db.revokeSalaryApproval(employeeId, month, reason, 'Admin');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Expense Verification & Senior Admin Approval Routes ─────────────────────

// GET /api/salary/expense-verifications?month=YYYY-MM
app.get('/api/salary/expense-verifications', checkAdminAuth, async (req, res) => {
  try {
    const list = await db.getExpenseVerifications(req.query.month);
    res.json({ success: true, verifications: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary/expense/verify (Admin 1 verification)
app.post('/api/salary/expense/verify', async (req, res) => {
  try {
    const { employeeId, employeeName, salaryMonth, month, claimedAmount, verifiedAmount, verifiedBy, notes, passcode } = req.body;
    const settings = await db.getSettings();
    const provided = passcode || req.headers['x-admin-passcode'];
    if (provided !== settings.adminPasscode && provided !== settings.seniorAdminPasscode) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Admin passcode' });
    }

    const verification = await db.verifyExpense({
      employeeId,
      employeeName,
      salaryMonth: salaryMonth || month,
      claimedAmount,
      verifiedAmount,
      verifiedBy: verifiedBy || 'Admin 1',
      notes
    });
    res.json({ success: true, verification });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/salary/expense/approve (Senior Admin approval)
app.post('/api/salary/expense/approve', async (req, res) => {
  try {
    const { employeeId, employeeName, salaryMonth, month, claimedAmount, approvedAmount, notes, passcode, seniorPasscode } = req.body;
    const settings = await db.getSettings();
    const provided = passcode || seniorPasscode || req.headers['x-senior-passcode'] || req.headers['x-admin-passcode'];
    const validSenior = settings.seniorAdminPasscode || '9999';

    if (provided !== validSenior) {
      return res.status(403).json({ error: 'Forbidden: Only Senior Admin can approve expenses. Passcode is invalid.' });
    }

    const approval = await db.approveExpense({
      employeeId,
      employeeName,
      salaryMonth: salaryMonth || month,
      claimedAmount,
      approvedAmount,
      approvedBy: req.body.approvedBy || 'Senior Admin',
      notes
    });
    res.json({ success: true, approval });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/salary/expense/verify
app.delete('/api/salary/expense/verify', checkAdminAuth, async (req, res) => {
  try {
    const employeeId = req.query.employeeId || req.body.employeeId;
    const month = req.query.month || req.body.month || req.body.salaryMonth;
    const reason = req.query.reason || req.body.reason || '';
    if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
    await db.revokeExpenseVerification(employeeId, month, reason, 'Admin 1');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/salary/expense/approve
app.delete('/api/salary/expense/approve', async (req, res) => {
  try {
    const settings = await db.getSettings();
    const seniorPasscode = req.body.passcode || req.headers['x-senior-passcode'] || req.headers['x-admin-passcode'];
    if (seniorPasscode !== (settings.seniorAdminPasscode || '9999')) {
      return res.status(403).json({ error: 'Forbidden: Only Senior Admin can revoke approvals' });
    }
    const employeeId = req.query.employeeId || req.body.employeeId;
    const month = req.query.month || req.body.month || req.body.salaryMonth;
    const reason = req.query.reason || req.body.reason || '';
    if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
    await db.revokeExpenseApproval(employeeId, month, reason, 'Senior Admin');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary/employee-credit-history?employeeId=...
app.get('/api/salary/employee-credit-history', checkAdminAuth, async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
    const history = await db.getEmployeeCreditHistory(employeeId);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary/:employeeId?month=YYYY-MM (Generic fallback for single employee salary)
app.get('/api/salary/:employeeId', checkAdminAuth, async (req, res) => {
  try {
    const record = await db.getSalaryRecord(req.params.employeeId, req.query.month || null);
    res.json({ success: true, salary: record });
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
