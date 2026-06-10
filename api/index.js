// api/index.js — single serverless function handling ALL routes
const db = require('../db');

// Parse request body
function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
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

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-passcode, X-Admin-Passcode');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = getPath(req);
  const method = req.method;
  const query = req.query || {};
  const headers = req.headers;
  const adminPasscode = headers['x-admin-passcode'] || headers['X-Admin-Passcode'] || '';

  try {

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
      if (body.passcode === settings.adminPasscode) return res.json({ success: true });
      return res.status(401).json({ success: false });
    }

    // ── POST /api/settings/update ────────────────────────────────────────────
    if (path === 'settings/update' && method === 'POST') {
      const settings = await db.getSettings();
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      const updated = await db.updateSettings(body);
      return res.json({ success: true, settings: updated });
    }

    // ── GET /api/employees ───────────────────────────────────────────────────
    if (path === 'employees' && method === 'GET') {
      const settings = await db.getSettings();
      let employees = await db.getEmployees();
      // If not admin, scrub sensitive data (pin, token)
      if (adminPasscode !== settings.adminPasscode) {
        employees = employees.map(e => ({ id: e.id, name: e.name, role: e.role, status: e.status }));
      }
      return res.json(employees);
    }

    // ── POST /api/employees ──────────────────────────────────────────────────
    if (path === 'employees' && method === 'POST') {
      const settings = await db.getSettings();
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.name) return res.status(400).json({ error: 'Name is required' });
      const employee = await db.addEmployee(body.name, body.role || 'Staff');
      return res.json({ success: true, employee });
    }

    // ── DELETE /api/employees/:id ────────────────────────────────────────────
    if (path.startsWith('employees/') && method === 'DELETE') {
      const settings = await db.getSettings();
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const id = path.replace('employees/', '');
      const deleted = await db.deleteEmployee(id);
      if (!deleted) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ success: true });
    }

    // ── GET /api/employees/token/:token ──────────────────────────────────────
    if (path.startsWith('employees/token/') && method === 'GET') {
      const token = path.replace('employees/token/', '');
      const employee = await db.getEmployeeByToken(token);
      if (!employee) return res.status(404).json({ error: 'Invalid token' });
      return res.json({ success: true, employee });
    }

    // ── GET /api/employees/generate-token?id=xxx ─────────────────────────────
    if (path === 'employees/generate-token' && method === 'GET') {
      const settings = await db.getSettings();
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const id = query.id;
      const employees = await db.getEmployees();
      const employee = employees.find(e => e.id === id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const origin = headers.origin || 'https://attendence-sheet-app.vercel.app';
      const link = origin + '/?mode=employee&token=' + employee.token;
      return res.json({ success: true, link, token: employee.token });
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
      if (adminPasscode !== settings.adminPasscode) return res.status(401).json({ error: 'Unauthorized' });
      const logs = await db.getAttendance(query.date || null);
      return res.json(logs);
    }

    // ── GET /api/attendance/status/:employeeId ────────────────────────────────
    if (path.startsWith('attendance/status') && method === 'GET') {
      const employeeId = path.replace('attendance/status/', '') || query.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
      const record = await db.getTodayAttendanceForEmployee(employeeId);
      return res.json({ activeRecord: record });
    }

    // ── POST /api/attendance/clock-in ─────────────────────────────────────────
    if (path === 'attendance/clock-in' && method === 'POST') {
      const body = await parseBody(req);
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
      const { employeeId, location, performanceNotes, moneySpent } = body;
      if (performanceNotes === undefined) return res.status(400).json({ error: 'performanceNotes required' });
      if (moneySpent === undefined) return res.status(400).json({ error: 'moneySpent required' });
      const result = await db.clockOut(employeeId, location, performanceNotes, moneySpent);
      return res.json({ success: true, data: result });
    }

    // ── 404 fallback ──────────────────────────────────────────────────────────
    return res.status(404).json({ error: `Unknown route: ${method} /api/${path}` });

  } catch (e) {
    console.error('API error:', e);
    return res.status(500).json({ error: e.message });
  }
};
