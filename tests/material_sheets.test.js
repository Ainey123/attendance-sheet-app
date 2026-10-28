const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const apiHandler = require('../api/index');

function createMockReqRes({ method = 'GET', url = '/api/health', headers = {}, query = {}, body = null }) {
  const req = {
    method,
    url,
    headers,
    query,
    body,
    on: () => {}
  };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    setHeader() {},
    status(c) { statusCode = c; return res; },
    json(obj) { jsonBody = obj; return res; },
    send(raw) { jsonBody = raw; return res; },
    end() { return res; }
  };
  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
}

(async () => {
  console.log('\n=============================================================');
  console.log('  STARTING FES MATERIAL SHEETS (CONSUMABLE & FIXED) TEST SUITE');
  console.log('=============================================================\n');

  const createdIds = [];

  try {
    // 1. Verify cropped company logo asset exists in public/fes-logo.png
    const logoPath = path.join(__dirname, '..', 'public', 'fes-logo.png');
    assert.ok(fs.existsSync(logoPath), 'public/fes-logo.png must exist');
    assert.ok(fs.statSync(logoPath).size > 5000, 'public/fes-logo.png must be non-empty');
    console.log('  ✓ [PASS] Test 1: Official FES company logo asset exists and is valid');

    // Fetch two real employees from database so foreign key constraints on Supabase are tested end-to-end
    const employees = await db.getEmployees(true);
    assert.ok(employees.length >= 2, 'At least 2 employees expected in database');
    const emp1 = employees[0];
    const emp2 = employees[1];

    // 2. Submit Consumable Material sheet via API with numbered points 1, 2, 3
    {
      const mock = createMockReqRes({
        method: 'POST',
        url: '/api/material-sheets',
        headers: { 'x-employee-id': emp1.id },
        body: {
          employeeId: emp1.id,
          employeeName: emp1.name,
          materialType: 'CONSUMABLE',
          date: '2026-10-10',
          siteName: 'TEST_SITE_DHA_PHASE_6',
          points: [
            { detail: 'PVC Insulation Tape', quantity: '10 Rolls' },
            { detail: '2.5mm Copper Cable', quantity: '2 Coils' },
            { detail: 'Rawal Plugs & Screws', quantity: '4 Boxes' }
          ],
          notes: 'Urgent site wiring consumables'
        }
      });
      await apiHandler(mock.req, mock.res);
      assert.strictEqual(mock.getStatus(), 201, JSON.stringify(mock.getBody()));
      const sheet = mock.getBody().sheet;
      assert.ok(sheet && sheet.id);
      createdIds.push(sheet.id);
      assert.strictEqual(sheet.materialType, 'CONSUMABLE');
      assert.strictEqual(sheet.companyName, 'Fast Engineering Solutions');
      assert.strictEqual(sheet.siteName, 'TEST_SITE_DHA_PHASE_6');
      assert.strictEqual(sheet.points.length, 3);
      assert.deepStrictEqual(sheet.points.map(p => p.pointNo), [1, 2, 3]);
      console.log('  ✓ [PASS] Test 2: Employee Consumable Material sheet persisted to Supabase with Points 1, 2, 3');
    }

    // 3. Submit Fixed Material sheet via API with numbered points 1, 2
    {
      const mock = createMockReqRes({
        method: 'POST',
        url: '/api/material-sheets',
        headers: { 'x-employee-id': emp2.id },
        body: {
          employeeId: emp2.id,
          employeeName: emp2.name,
          materialType: 'FIXED',
          date: '2026-10-25',
          siteName: 'TEST_SITE_BAHRIA_SECTOR_C',
          points: [
            { detail: 'Bosch Hammer Drill Machine', quantity: '1 Unit' },
            { detail: 'Aluminium Folding Ladder 10ft', quantity: '1 Unit' }
          ],
          notes: 'Issued fixed tools for installation'
        }
      });
      await apiHandler(mock.req, mock.res);
      assert.strictEqual(mock.getStatus(), 201, JSON.stringify(mock.getBody()));
      const sheet = mock.getBody().sheet;
      createdIds.push(sheet.id);
      assert.strictEqual(sheet.materialType, 'FIXED');
      assert.strictEqual(sheet.points.length, 2);
      assert.deepStrictEqual(sheet.points.map(p => p.pointNo), [1, 2]);
      console.log('  ✓ [PASS] Test 3: Employee Fixed Material sheet persisted to Supabase with Points 1, 2');
    }

    // 4. Employee scoping: non-admin only sees their own material sheets
    {
      const mock = createMockReqRes({
        method: 'GET',
        url: '/api/material-sheets',
        headers: { 'x-employee-id': emp1.id },
        query: {}
      });
      await apiHandler(mock.req, mock.res);
      assert.strictEqual(mock.getStatus(), 200);
      const sheets = mock.getBody().sheets;
      assert.ok(sheets.every(s => s.employeeId === emp1.id), 'Employee must only see own sheets');
      assert.ok(sheets.some(s => s.id === createdIds[0]));
      console.log('  ✓ [PASS] Test 4: Employee isolation enforced — employee sees only their own sheets');
    }

    // 5. Admin search by Name, Tenurewise search, and Side-wise / Site-wise search
    const settings = await db.getSettings();
    const adminPass = settings.adminPasscode || '1200';

    // 5a. Search by Employee Name
    {
      const mock = createMockReqRes({
        method: 'GET',
        url: '/api/material-sheets',
        headers: { 'x-admin-passcode': adminPass },
        query: { employeeName: emp2.name }
      });
      await apiHandler(mock.req, mock.res);
      assert.strictEqual(mock.getStatus(), 200);
      const sheets = mock.getBody().sheets;
      assert.ok(sheets.some(s => s.id === createdIds[1]));
      if (emp1.name.toLowerCase() !== emp2.name.toLowerCase()) {
        assert.ok(!sheets.some(s => s.id === createdIds[0]));
      }
      console.log('  ✓ [PASS] Test 5a: Admin search by Employee Name works accurately');
    }

    // 5b. Side-wise / Site-wise Search
    {
      const mock = createMockReqRes({
        method: 'GET',
        url: '/api/material-sheets',
        headers: { 'x-admin-passcode': adminPass },
        query: { siteName: 'TEST_SITE_DHA_PHASE_6' }
      });
      await apiHandler(mock.req, mock.res);
      assert.strictEqual(mock.getStatus(), 200);
      const sheets = mock.getBody().sheets;
      assert.ok(sheets.some(s => s.id === createdIds[0]));
      assert.ok(!sheets.some(s => s.id === createdIds[1]));
      console.log('  ✓ [PASS] Test 5b: Admin Side-wise / Site-wise search works accurately');
    }

    // 5c. Tenurewise Search (startDate .. endDate)
    {
      const mock = createMockReqRes({
        method: 'GET',
        url: '/api/material-sheets',
        headers: { 'x-admin-passcode': adminPass },
        query: { startDate: '2026-10-20', endDate: '2026-10-28', siteName: 'TEST_SITE_' }
      });
      await apiHandler(mock.req, mock.res);
      assert.strictEqual(mock.getStatus(), 200);
      const sheets = mock.getBody().sheets;
      assert.ok(sheets.some(s => s.id === createdIds[1]));
      assert.ok(!sheets.some(s => s.id === createdIds[0]));
      console.log('  ✓ [PASS] Test 5c: Admin Tenurewise date-range search works accurately');
    }

    // 6. Verify material_sheet records do NOT leak into Employee Documents (getFormSubmissions)
    {
      const forms = await db.getFormSubmissions(emp1.id, null);
      assert.ok(!forms.some(f => f.formType === 'material_sheet'), 'material_sheet must not appear in document forms');
      console.log('  ✓ [PASS] Test 6: Material sheets isolated cleanly from Employee Document Forms');
    }

    // Cleanup test sheets
    for (const id of createdIds) {
      await db.deleteMaterialSheet(id, null, true);
    }
    createdIds.length = 0;
    console.log('  ✓ [PASS] Test 7: Admin delete & cleanup succeeded cleanly');

    console.log('\n=============================================================');
    console.log('  MATERIAL SHEETS SUITE: ALL 7/7 TESTS PASSED! 🚀');
    console.log('=============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    for (const id of createdIds) {
      await db.deleteMaterialSheet(id, null, true).catch(() => {});
    }
    process.exit(1);
  }
})();
