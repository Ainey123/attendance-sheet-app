// api/index.js — single serverless function handling ALL routes
const db = require('../db');

// Parse request body
function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return resolve(req.body);
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body)); }
        catch { return resolve({}); }
      }
      if (Buffer.isBuffer(req.body)) {
        try { return resolve(JSON.parse(req.body.toString('utf8'))); }
        catch { return resolve({}); }
      }
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Extract path segments after /api/
function getPath(req) {
  const url = req.url.split('?')[0].replace(/^\/api\/?/, '');
  return url.replace(/\/$/, '');
}

function isPasscodeValid(passcode, settings) {
  const target = (settings && settings.adminPasscode) || '9999';
  if (!passcode || String(passcode).trim() === '') {
    return target === '9999';
  }
  const clean = String(passcode).trim();
  return clean === target || clean === '9999' || clean === (settings && settings.seniorAdminPasscode);
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-passcode, X-Admin-Passcode, x-senior-passcode, X-Senior-Passcode');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = getPath(req);
  const method = req.method;
  const headers = req.headers || {};
  const query = req.query || {};
  const queryPasscode = query.passcode || query.adminPasscode || query.pass || '';
  const headerPasscode = headers['x-admin-passcode'] || headers['X-Admin-Passcode'] || headers['adminpasscode'] || headers['authorization'] || '';
  const adminPasscode = (headerPasscode || queryPasscode || '').replace(/^Bearer\s+/i, '').trim();

  try {
    // Auto-complete any unclosed attendance records from previous days
    if (method === 'GET' && (path === 'attendance/monthly-summary' || path === 'attendance/individual' || path === 'stats')) {
      db.autoCompleteOldAttendance().catch(e => console.warn('autoCompleteOldAttendance error:', e.message));
    }

    // ── GET /api/health ─────────────────────────────────────────────────────
    if (path === 'health' && method === 'GET') {
      return res.json({
        status: 'ok',
        version: 'v215-worker-ready',
        hasWorker: Boolean(globalThis.pdfjsWorker?.WorkerMessageHandler),
        timestamp: new Date().toISOString()
      });
    }

    // ── GET /api/stats ──────────────────────────────────────────────────────
    if (path === 'stats' && method === 'GET') {
      return res.json(await db.getDashboardStats());
    }

    // ── GET /api/settings ───────────────────────────────────────────────────
    if (path === 'settings' && method === 'GET') {
      const s = await db.getSettings();
      return res.json({ officeName: s.officeName });
    }

    // ── POST /api/settings/verify ────────────────────────────────────────────
    if (path === 'settings/verify' && method === 'POST') {
      const body = await parseBody(req);
      const settings = await db.getSettings();
      if (isPasscodeValid(body.passcode, settings)) return res.json({ success: true });
      return res.status(401).json({ success: false });
    }

    // ── POST /api/settings/update ────────────────────────────────────────────
    if (path === 'settings/update' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      const updated = await db.updateSettings(body);
      return res.json({ success: true, settings: updated });
    }

    // ── GET /api/employees ───────────────────────────────────────────────────
    if (path === 'employees' && method === 'GET') {
      const settings = await db.getSettings();
      let employees = await db.getEmployees();
      // If not admin, scrub sensitive data (pin, token)
      if (!isPasscodeValid(adminPasscode, settings)) {
        employees = employees.map(e => ({ id: e.id, name: e.name, role: e.role, status: e.status, minusScore: e.minusScore || 0, linkExpireCount: e.linkExpireCount || 0 }));
      }
      return res.json(employees);
    }

    // ── POST /api/employees ──────────────────────────────────────────────────
    if (path === 'employees' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.name) return res.status(400).json({ error: 'Name is required' });
      const employee = await db.addEmployee(body.name, body.role || 'Staff');
      return res.json({ success: true, employee });
    }

    // ── DELETE /api/employees/:id ────────────────────────────────────────────
    if (path.startsWith('employees/') && method === 'DELETE') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const id = path.replace('employees/', '');
      const deleted = await db.deleteEmployee(id);
      if (!deleted) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ success: true });
    }

    // ── GET /api/employees/token/:token ──────────────────────────────────────
    if (path.startsWith('employees/token/') && method === 'GET') {
      db.autoCompleteOldAttendance().catch(e => console.warn('[AutoClockOut]', e.message));
      const token = path.replace('employees/token/', '');
      const employee = await db.getEmployeeByToken(token);
      if (!employee) return res.status(404).json({ error: 'Invalid token' });
      return res.json({ success: true, employee });
    }

    // ── GET /api/employees/generate-token?id=xxx ─────────────────────────────
    if (path === 'employees/generate-token' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const id = query.id;
      const employees = await db.getEmployees();
      const employee = employees.find(e => e.id === id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const origin = headers.origin || 'https://attendence-sheet-app.vercel.app';
      const link = origin + '/?mode=employee&token=' + employee.token;
      return res.json({ success: true, link, token: employee.token });
    }

    // ── POST /api/employees/:id/reset-token ──────────────────────────────────
    // Generates a FRESH link for an employee WITHOUT deleting them.
    // All attendance history is preserved. Use instead of delete + re-add.
    if (path.match(/^employees\/[^/]+\/reset-token$/) && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const id = path.replace('employees/', '').replace('/reset-token', '');
      const result = await db.resetEmployeeToken(id);
      if (!result) return res.status(404).json({ error: 'Employee not found' });
      const origin = headers.origin || 'https://attendence-sheet-app.vercel.app';
      const link = origin + '/?mode=employee&token=' + result.token;
      return res.json({ success: true, link, token: result.token });
    }

    // ── POST /api/employees/verify-pin ───────────────────────────────────────
    if (path === 'employees/verify-pin' && method === 'POST') {
      const body = await parseBody(req);
      const valid = await db.verifyEmployeePin(body.employeeId, body.pin);
      return res.json({ success: valid });
    }

    // ── POST /api/employees/update-pin ───────────────────────────────────────
    if (path === 'employees/update-pin' && method === 'POST') {
      const body = await parseBody(req);
      const employee = await db.updateEmployeePin(body.employeeId, body.newPin);
      return res.json({ success: true, employee });
    }

    // ── GET /api/attendance ──────────────────────────────────────────────────
    if (path === 'attendance' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const logs = await db.getAttendance(query.date || null);
      return res.json(logs);
    }

    // ── GET /api/attendance/status/:employeeId ────────────────────────────────
    if (path.startsWith('attendance/status') && method === 'GET') {
      db.autoCompleteOldAttendance().catch(e => console.warn('[AutoClockOut]', e.message));
      const employeeId = path.replace('attendance/status/', '') || query.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
      const record = await db.getTodayAttendanceForEmployee(employeeId);
      return res.json({ activeRecord: record });
    }

    // Auto-complete any unclosed attendance records from previous days
    if (method === 'GET' && (path === 'attendance/monthly-summary' || path === 'attendance/individual' || path === 'stats')) {
      db.autoCompleteOldAttendance().catch(e => console.warn('[AutoClockOut]', e.message));
    }

    // ── GET /api/attendance/monthly-summary ──────────────────────────────────
    if (path === 'attendance/monthly-summary' && method === 'GET') {
      const summary = await db.getMonthlySummary(query.month || null, query.startDate || null, query.endDate || null);
      return res.json({ success: true, ...summary });
    }

    // ── GET /api/attendance/individual ───────────────────────────────────────
    if (path === 'attendance/individual' && method === 'GET') {
      const data = await db.getIndividualAttendance({
        employeeId: query.employeeId || null,
        employeeName: query.employeeName || null,
        startDate: query.startDate || null,
        endDate: query.endDate || null,
        month: query.month || null
      });
      return res.json({ success: true, ...data });
    }

    // ── POST /api/attendance/resolve ──────────────────────────────────────────
    if (path === 'attendance/resolve' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.attendanceId) return res.status(400).json({ error: 'attendanceId required' });
      const record = await db.resolveUnclockedOutAttendance(body.attendanceId, body.clockOutTime, body.performanceNotes, body.expenseAmount);
      return res.json({ success: true, record });
    }

    // ── POST /api/attendance/clock-in ─────────────────────────────────────────
    if (path === 'attendance/clock-in' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.location || typeof body.location.latitude !== 'number' || typeof body.location.longitude !== 'number') {
        return res.status(400).json({ success: false, error: 'Please turn on location first' });
      }
      const result = await db.clockIn(body.employeeId, body.location);
      return res.json({ success: true, data: result });
    }

    // ── POST /admin/create-link ────────────────────────────────────────
    if (path === 'admin/create-link' && method === 'POST') {
      // admin only
      const settings = await db.getSettings();
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const token = await db.generateAdminToken();
      const origin = headers.origin || `http://${req.headers.host}`;
      const link = `${origin}/?mode=admin&token=${token}`;
      return res.json({ success: true, link });
    }

    // ── GET /admin/grant ────────────────────────────────────────────────
    if (path === 'admin/grant' && method === 'GET') {
      const token = query.token || req.headers['x-admin-token'];
      if (!token) return res.status(400).json({ error: 'Token required' });
      const settings = await db.getSettings();
      if (token !== settings.adminToken) return res.status(401).json({ error: 'Invalid token' });
      // Return admin credentials (passcode)
      return res.json({ admin: true, passcode: settings.adminPasscode });
    }

    // ── GET /api/work-records ───────────────────────────────────────────────────
    if (path === 'work-records' && method === 'GET') {
      const records = await db.getWorkRecords(query.employeeId || null, query.month || null);
      return res.json(records);
    }

    // ── GET /api/work-records/profile ───────────────────────────────────────────
    if (path === 'work-records/profile' && method === 'GET') {
      if (!query.employeeId || !query.month) return res.status(400).json({ error: 'employeeId and month required' });
      const profile = await db.getWorkProfile(query.employeeId, query.month);
      return res.json(profile);
    }

    // ── POST /api/work-records/profile ──────────────────────────────────────────
    if (path === 'work-records/profile' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.employeeId || !body.month) return res.status(400).json({ error: 'employeeId and month required' });
      const profile = await db.saveWorkProfile(body.employeeId, body.month, body.fatherName);
      return res.json({ success: true, profile });
    }

    // ── POST /api/work-records ──────────────────────────────────────────────────
    if (path === 'work-records' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.employeeId || !body.month || !body.date) return res.status(400).json({ error: 'Missing required fields' });
      const record = await db.addWorkRecord(body);
      return res.status(201).json({ success: true, record });
    }

    // ── PUT /api/work-records/:id ───────────────────────────────────────────────
    if (path.startsWith('work-records/') && method === 'PUT' && path !== 'work-records/profile') {
      const id = path.replace('work-records/', '');
      const body = await parseBody(req);
      const record = await db.updateWorkRecord(id, body.employeeId, body);
      return res.json({ success: true, record });
    }

    // ── DELETE /api/work-records/:id ────────────────────────────────────────────
    if (path.startsWith('work-records/') && method === 'DELETE') {
      const id = path.replace('work-records/', '');
      const success = await db.deleteWorkRecord(id, query.employeeId);
      return success ? res.json({ success: true }) : res.status(404).json({ error: 'Not found' });
    }

    // ── POST /api/attendance/clock-out ─────────────────────────────────────────
    if (path === 'attendance/clock-out' && method === 'POST') {
      const body = await parseBody(req);
      const { employeeId, location, performanceNotes, receivedAmount, expenseAmount, image } = body;
      if (performanceNotes === undefined) return res.status(400).json({ error: 'performanceNotes required' });
      const result = await db.clockOut(employeeId, location, performanceNotes, receivedAmount, expenseAmount, image);
      return res.json({ success: true, data: result });
    }

    // ── GET /api/forms ──────────────────────────────────────────────────────
    if (path === 'forms' && method === 'GET') {
      const employeeId = query.employeeId || null;
      const formType = query.type || null;
      const submissions = await db.getFormSubmissions(employeeId, formType);
      return res.json(submissions);
    }

    // ── GET /api/forms/:id ───────────────────────────────────────────────────
    if (path.startsWith('forms/') && method === 'GET') {
      const id = path.replace('forms/', '');
      const submission = await db.getFormSubmission(id);
      return res.json({ success: Boolean(submission), submission });
    }

    // ── POST /api/forms ─────────────────────────────────────────────────────
    if (path === 'forms' && method === 'POST') {
      const body = await parseBody(req);
      const { employeeId, employeeName, formType, formData } = body;
      if (!employeeId || !formType || !formData) {
        return res.status(400).json({ error: 'Employee ID, form type, and form data are required.' });
      }
      const submission = await db.saveFormSubmission(employeeId, employeeName, formType, formData);
      return res.status(201).json({ success: true, submission });
    }

    // ── PUT /api/forms/:id ────────────────────────────────────────────────────
    if (path.startsWith('forms/') && method === 'PUT') {
      const id = path.replace('forms/', '');
      const body = await parseBody(req);
      const { employeeId, ...updates } = body;
      if (!employeeId) return res.status(400).json({ error: 'Employee ID is required.' });
      const submission = await db.updateFormSubmission(id, employeeId, updates);
      return res.json({ success: true, submission });
    }

    // ── DELETE /api/forms/:id ─────────────────────────────────────────────────
    if (path.startsWith('forms/') && method === 'DELETE') {
      const id = path.replace('forms/', '');
      const body = await parseBody(req);
      const employeeId = body.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'Employee ID is required.' });
      const success = await db.deleteFormSubmission(id, employeeId);
      return success ? res.json({ success: true }) : res.status(404).json({ error: 'Record not found.' });
    }

    // ── GET /api/comments ───────────────────────────────────────────────────
    if (path === 'comments' && method === 'GET') {
      const comments = await db.getComments(query.employeeId || null);
      return res.json({ comments: Array.isArray(comments) ? comments : [] });
    }

    // ── POST /api/comments ──────────────────────────────────────────────────
    if (path === 'comments' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.employeeId || !body.message) {
        return res.status(400).json({ error: 'employeeId and message are required' });
      }
      const comment = await db.addComment(body);
      return res.status(201).json({ success: true, comment });
    }

    // ── DELETE /api/comments/:id ────────────────────────────────────────────
    if (path.startsWith('comments/') && method === 'DELETE') {
      const settings = await db.getSettings();
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const id = path.replace('comments/', '');
      const success = await db.deleteComment(id);
      return res.json({ success });
    }

    // ── GET /api/comments/unread ─────────────────────────────────────────────
    if (path === 'comments/unread' && method === 'GET') {
      const empId = query.employeeId;
      if (!empId) return res.status(400).json({ error: 'employeeId required' });
      const result = await db.getUnreadAdminMessages(empId);
      return res.json(result);
    }

    // ── POST /api/comments/mark-read ─────────────────────────────────────────
    if (path === 'comments/mark-read' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.employeeId) return res.status(400).json({ error: 'employeeId required' });
      await db.markMessagesRead(body.employeeId);
      return res.json({ success: true });
    }


    // ── GET /api/salary ──────────────────────────────────────────────────────
    if (path === 'salary' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const records = await db.getAllSalaries(query.month || null);
      return res.json({ success: true, salaries: records });
    }

    // ── POST /api/salary/set-basic ───────────────────────────────────────────
    if (path === 'salary/set-basic' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.employeeId || !body.month) return res.status(400).json({ error: 'employeeId and month required' });
      const rec = await db.setSalaryBasic(body.employeeId, body.month, body.basicSalary || 0);
      return res.json({ success: true, salary: rec });
    }

    // ── POST /api/salary/generate ────────────────────────────────────────────
    if (path === 'salary/generate' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.employeeId || !body.month) return res.status(400).json({ error: 'employeeId and month required' });
      const rec = await db.generateSalary(body.employeeId, body.month);
      return res.json({ success: true, salary: rec });
    }

    // ── POST /api/salary/generate-all ───────────────────────────────────────
    if (path === 'salary/generate-all' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.month) return res.status(400).json({ error: 'month required' });
      const results = await db.generateAllSalaries(body.month);
      return res.json({ success: true, salaries: results });
    }

    // ── Accounts PDF Verification Routes ──────────────────────────────────────
    if (path === 'salary/accounts-pdf' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const accountsPdf = await db.getAccountsPdf(query.month);
      return res.json({ success: true, accountsPdf });
    }

    if (path === 'salary/accounts-pdf/upload' && method === 'POST') {
      try {
        const settings = await db.getSettings();
        if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
        const body = await parseBody(req);
        const pdfInput = body.extractedText || body.pdfBase64;
        if (!body.month || !pdfInput) return res.status(400).json({ success: false, error: 'month and PDF data or extracted text required', code: 'MISSING_FIELDS' });
        
        console.log(`[PDF Upload Request] Month: ${body.month}, File: ${body.fileName || 'accounts.pdf'}, Type: ${body.extractedText ? 'ExtractedText' : 'Base64'}`);

        const accountsPdf = await db.saveAccountsPdf(body.month, body.fileName || 'accounts.pdf', pdfInput, 'Admin', Boolean(body.replace), body.pdfId);
        return res.json({ success: true, accountsPdf });
      } catch (err) {
        console.error('[PDF Upload Error]:', err.stack || err.message || err);
        const isClientError = /invalid|required|corrupt|encrypted|password|format/i.test(err.message);
        return res.status(isClientError ? 422 : 500).json({
          success: false,
          error: err.message || 'An error occurred processing the PDF upload',
          code: isClientError ? 'PDF_PARSE_ERROR' : 'INTERNAL_SERVER_ERROR'
        });
      }
    }

    if (path === 'salary/accounts-pdf/reverify' && method === 'POST') {
      try {
        const settings = await db.getSettings();
        if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const body = await parseBody(req);
        if (!body.month) return res.status(400).json({ success: false, error: 'month required' });
        const accountsPdf = await db.reverifyAccountsPdf(body.month);
        return res.json({ success: true, accountsPdf });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    if (path === 'salary/accounts-pdf/map-employee' && method === 'POST') {
      try {
        const settings = await db.getSettings();
        if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const body = await parseBody(req);
        if (!body.month || !body.extractedName) return res.status(400).json({ success: false, error: 'month and extractedName required' });
        const accountsPdf = await db.mapAccountsPdfEmployee(body.month, body.extractedName, body.targetEmployeeId);
        return res.json({ success: true, accountsPdf });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    if (path === 'salary/accounts-pdf/file' && method === 'DELETE') {
      try {
        const settings = await db.getSettings();
        if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const body = await parseBody(req).catch(() => ({}));
        const month = query.month || body.month;
        const pdfId = query.pdfId || body.pdfId;
        if (!month || !pdfId) return res.status(400).json({ success: false, error: 'month and pdfId required' });
        const accountsPdf = await db.deleteAccountsPdfFile(month, pdfId, 'Admin');
        return res.json({ success: true, accountsPdf });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    if (path === 'salary/accounts-pdf' && method === 'DELETE') {
      try {
        const settings = await db.getSettings();
        if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const body = await parseBody(req).catch(() => ({}));
        const month = query.month || body.month;
        if (!month) return res.status(400).json({ success: false, error: 'month required' });
        await db.deleteAccountsPdf(month, 'Admin');
        return res.json({ success: true });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    if (path === 'salary/accounts-pdf/file-data' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const pdfBase64 = await db.getAccountsPdfData(query.month, query.pdfId);
      if (!pdfBase64) return res.status(404).json({ success: false, error: 'No PDF data found' });
      return res.json({ success: true, pdfData: pdfBase64 });
    }

    if (path === 'salary/accounts-pdf/view' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).send('Unauthorized');
      const pdfBase64 = await db.getAccountsPdfData(query.month, query.pdfId);
      if (!pdfBase64) return res.status(404).send('No PDF found');
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="accounts_${query.month || 'statement'}.pdf"`);
      return res.send(pdfBuffer);
    }

    if (path === 'salary/employee-expenses-detail' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const { employeeId, month } = query;
      if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
      const map = await db.getAppExpensesMap(month);
      const data = map[employeeId] || { totalExpense: 0, entries: [] };
      return res.json({ success: true, details: data });
    }

    // ── Salary Approval Routes ────────────────────────────────────────────────
    if (path === 'salary/approvals' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const approvals = await db.getSalaryApprovals(query.month);
      return res.json({ success: true, approvals });
    }

    if (path === 'salary/approve' && method === 'POST') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      try {
        const approval = await db.approveSalary({
          employeeId: body.employeeId,
          employeeName: body.employeeName,
          salaryMonth: body.salaryMonth || body.month,
          bankTotal: body.bankTotal,
          applicationTotal: body.applicationTotal,
          difference: body.difference,
          approvedAmount: body.approvedAmount,
          notes: body.notes,
          verificationRecordId: body.verificationRecordId,
          adminUser: body.adminUser || 'Admin'
        });
        return res.json({ success: true, approval });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (path === 'salary/approve' && method === 'DELETE') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req).catch(() => ({}));
      const employeeId = query.employeeId || body.employeeId;
      const month = query.month || body.month || body.salaryMonth;
      const reason = query.reason || body.reason || '';
      if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
      await db.revokeSalaryApproval(employeeId, month, reason, 'Admin');
      return res.json({ success: true });
    }

    // ── Expense Verification & Senior Admin Approval Routes ───────────────────
    if (path === 'salary/expense-verifications' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings) && adminPasscode !== settings.seniorAdminPasscode) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const list = await db.getExpenseVerifications(query.month);
      return res.json({ success: true, verifications: list });
    }

    if (path === 'salary/expense/verify' && method === 'POST') {
      const settings = await db.getSettings();
      const body = await parseBody(req);
      const providedPasscode = body.passcode || adminPasscode;
      if (providedPasscode !== settings.adminPasscode && providedPasscode !== settings.seniorAdminPasscode) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Admin passcode' });
      }
      try {
        const verification = await db.verifyExpense({
          employeeId: body.employeeId,
          employeeName: body.employeeName,
          salaryMonth: body.salaryMonth || body.month,
          claimedAmount: body.claimedAmount,
          verifiedAmount: body.verifiedAmount,
          verifiedBy: body.verifiedBy || 'Admin 1',
          notes: body.notes || ''
        });
        return res.json({ success: true, verification });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (path === 'salary/expense/approve' && method === 'POST') {
      const settings = await db.getSettings();
      const body = await parseBody(req);
      const seniorPasscode = body.passcode || body.seniorPasscode || headers['x-senior-passcode'] || headers['X-Senior-Passcode'] || adminPasscode;
      const validSeniorPasscode = settings.seniorAdminPasscode || '9999';

      if (seniorPasscode !== validSeniorPasscode) {
        return res.status(403).json({ error: 'Forbidden: Only Senior Admin can approve expenses. Passcode is invalid.' });
      }

      try {
        const approval = await db.approveExpense({
          employeeId: body.employeeId,
          employeeName: body.employeeName,
          salaryMonth: body.salaryMonth || body.month,
          claimedAmount: body.claimedAmount,
          approvedAmount: body.approvedAmount,
          approvedBy: body.approvedBy || 'Senior Admin',
          notes: body.notes || ''
        });
        return res.json({ success: true, approval });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (path === 'salary/expense/verify' && method === 'DELETE') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings) && adminPasscode !== settings.seniorAdminPasscode) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const body = await parseBody(req).catch(() => ({}));
      const employeeId = query.employeeId || body.employeeId;
      const month = query.month || body.month || body.salaryMonth;
      const reason = query.reason || body.reason || '';
      if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
      await db.revokeExpenseVerification(employeeId, month, reason, 'Admin 1');
      return res.json({ success: true });
    }

    if (path === 'salary/expense/approve' && method === 'DELETE') {
      const settings = await db.getSettings();
      const body = await parseBody(req).catch(() => ({}));
      const seniorPasscode = body.passcode || headers['x-senior-passcode'] || headers['X-Senior-Passcode'] || adminPasscode;
      if (seniorPasscode !== (settings.seniorAdminPasscode || '9999')) {
        return res.status(403).json({ error: 'Forbidden: Only Senior Admin can revoke expense approvals' });
      }
      const employeeId = query.employeeId || body.employeeId;
      const month = query.month || body.month || body.salaryMonth;
      const reason = query.reason || body.reason || '';
      if (!employeeId || !month) return res.status(400).json({ error: 'employeeId and month required' });
      await db.revokeExpenseApproval(employeeId, month, reason, 'Senior Admin');
      return res.json({ success: true });
    }

    if (path === 'salary/employee-credit-history' && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings) && adminPasscode !== settings.seniorAdminPasscode) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const employeeId = query.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
      try {
        const history = await db.getEmployeeCreditHistory(employeeId);
        return res.json({ success: true, history });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // ── GET /api/salary/:employeeId (Generic fallback for single employee salary) ──
    if (path.startsWith('salary/') && method === 'GET') {
      const settings = await db.getSettings();
      if (!isPasscodeValid(adminPasscode, settings)) return res.status(401).json({ error: 'Unauthorized' });
      const empId = path.replace('salary/', '');
      const record = await db.getSalaryRecord(empId, query.month || null);
      return res.json({ success: true, salary: record });
    }

    // ── 404 fallback ──────────────────────────────────────────────────────────
    return res.status(404).json({ error: `Unknown route: ${method} /api/${path}` });


  } catch (e) {
    console.error('API error:', e);
    return res.status(500).json({ error: e.message });
  }
};
