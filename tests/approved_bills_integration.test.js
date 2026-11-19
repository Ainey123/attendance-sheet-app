/**
 * Automated Tests for Read-Only Approved Bills Integration (Attendance App Side)
 *
 * Verifies:
 *  1. buildApprovedBillIntegrationDto & sanitizeAuditLogForIntegration strip Base64 blobs & retain all bill info
 *  2. db.getApprovedBillsForIntegration returns ONLY APPROVED & PARTIALLY_APPROVED bills (both LINKED & UNLINKED)
 *  3. db.getApprovedBillByIdForIntegration returns full detail for approved bills and 403 for unapproved/rejected bills
 *  4. Live HTTP routes GET /api/integration/bills/approved & GET /api/integration/bills/:id enforce HMAC-SHA256 auth
 *  5. Attachment binary streaming works on approved bills via GET /api/integration/bills/:id/attachments/:index
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Force isolated local fallback so tests never write synthetic records to live Supabase
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.FES_INTEGRATION_ENABLED = 'true';
process.env.FES_INTEGRATION_API_KEY = 'fes_test_approved_bills_api_key_2026';
process.env.FES_INTEGRATION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const dataJsonPath = path.resolve(__dirname, '../data.json');
const originalDataJson = fs.existsSync(dataJsonPath) ? fs.readFileSync(dataJsonPath, 'utf8') : null;

const integration = require('../integration-client');
const db = require('../db');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`           ${err.stack || err.message}`);
    failed++;
  }
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log('  FES ATTENDANCE APP — APPROVED BILLS INTEGRATION TEST SUITE');
  console.log('====================================================================\n');

  const samplePngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const samplePdfBase64 = 'data:application/pdf;base64,JVBERi0xLjQK';

  let approvedLinkedId = null;
  let partialUnlinkedId = null;
  let pendingId = null;
  let rejectedId = null;

  try {
    await runTest('Test 1: Create mixed bills (Approved Linked, Partially Approved Unlinked, Submitted, Rejected)', async () => {
      const snap = {
        ticketId: 101,
        serialNo: '1050',
        jobMetadataId: 501,
        branchName: 'Gulberg III Branch',
        clientName: 'Meezan Bank',
        workNature: 'ELECTRICAL',
        subject: 'Generator ATS Repair',
      };

      const b1 = await db.createBill({
        employeeId: 'emp-ap-1',
        employeeName: 'Bilal Ahmed',
        siteName: snap.branchName,
        branchName: snap.branchName,
        billDate: '2026-11-15',
        transportationExpense: 1500,
        materialExpense: 5000,
        description: 'Generator relay & transport',
        attachments: [
          { name: 'receipt-1.png', type: 'image/png', dataUrl: samplePngBase64 },
          { name: 'invoice.pdf', type: 'application/pdf', dataUrl: samplePdfBase64 },
        ],
        ticketSelectionMode: 'LINKED',
        externalTicketId: snap.ticketId,
        externalTicketSerialNo: snap.serialNo,
        externalJobMetadataId: snap.jobMetadataId,
        clientName: snap.clientName,
        workNature: snap.workNature,
        ticketSubject: snap.subject,
        ticketSelectionToken: integration.signAuthoritativeTicketSelection(snap),
        _autoSync: false,
      });
      await db.verifyBill(b1.id, { verifiedAmount: 6500, verificationComment: 'All receipts verified', verifiedBy: 'Admin 1' });
      const b1App = await db.approveBill(b1.id, { approvedAmount: 6200, approvalComment: 'Approved in full minus misc', approvedBy: 'Senior Admin' });
      assert.strictEqual(b1App.status, 'APPROVED');
      approvedLinkedId = b1App.id;

      const b2 = await db.createBill({
        employeeId: 'emp-ap-2',
        employeeName: 'Hamza Khan',
        siteName: 'Model Town Site',
        billDate: '2026-11-16',
        labourExpense: 3000,
        otherExpense: 1000,
        description: 'Unlinked emergency labour bill',
        attachments: [
          { name: 'labour-voucher.png', type: 'image/png', dataUrl: samplePngBase64 },
        ],
        ticketSelectionMode: 'UNLINKED',
        _autoSync: false,
      });
      await db.verifyBillCategory(b2.id, { category: 'labour', verifiedAmount: 2800, verificationComment: 'Labour verified', verifiedBy: 'Admin 1' });
      await db.verifyBillCategory(b2.id, { category: 'other', verifiedAmount: 800, verificationComment: 'Other verified', verifiedBy: 'Admin 1' });
      const b2Part = await db.approveBillCategory(b2.id, { category: 'labour', approvedAmount: 2800, approvalComment: 'Labour approved', approvedBy: 'Senior Admin' });
      assert.strictEqual(b2Part.status, 'PARTIALLY_APPROVED');
      partialUnlinkedId = b2Part.id;

      const b3 = await db.createBill({
        employeeId: 'emp-ap-3',
        employeeName: 'Usman Tariq',
        siteName: 'Johar Town',
        billDate: '2026-11-16',
        materialExpense: 2000,
        description: 'Still pending bill',
        ticketSelectionMode: 'UNLINKED',
        _autoSync: false,
      });
      pendingId = b3.id;

      const b4 = await db.createBill({
        employeeId: 'emp-ap-4',
        employeeName: 'Ali Raza',
        siteName: 'Wapda Town',
        billDate: '2026-11-16',
        otherExpense: 1200,
        description: 'Rejected bill',
        ticketSelectionMode: 'UNLINKED',
        _autoSync: false,
      });
      await db.rejectBill(b4.id, { rejectionReason: 'Duplicate receipt', rejectedBy: 'Admin' });
      rejectedId = b4.id;
    });

    await runTest('Test 2: db.getApprovedBillsForIntegration returns ONLY approved/partially approved bills without Base64 blobs', async () => {
      const res = await db.getApprovedBillsForIntegration();
      const ids = res.bills.map((b) => b.id);
      assert(ids.includes(approvedLinkedId), 'Approved linked bill must be included');
      assert(ids.includes(partialUnlinkedId), 'Partially approved unlinked bill must be included');
      assert(!ids.includes(pendingId), 'Pending/submitted bill must NOT be included');
      assert(!ids.includes(rejectedId), 'Rejected bill must NOT be included');

      const serialized = JSON.stringify(res);
      assert(!serialized.includes('data:image/png;base64'), 'Response must NOT contain Base64 dataUrl strings');
      assert(!serialized.includes('data:application/pdf;base64'), 'Response must NOT contain Base64 PDF strings');

      const linkedDto = res.bills.find((b) => b.id === approvedLinkedId);
      assert.strictEqual(linkedDto.attachmentsCount, 2);
      assert.strictEqual(linkedDto.attachmentsMeta[0].name, 'receipt-1.png');
      assert.strictEqual(linkedDto.attachmentsMeta[0].hasBinary, true);
      assert.strictEqual(linkedDto.attachmentsMeta[1].isPdf, true);
      assert.strictEqual(linkedDto.externalTicketSerialNo, '1050');
      assert.strictEqual(linkedDto.clientName, 'Meezan Bank');
      assert.ok(Array.isArray(linkedDto.auditLog) && linkedDto.auditLog.length >= 2);
    });

    await runTest('Test 3: db.getApprovedBillByIdForIntegration enforces approved-only visibility', async () => {
      const okRes = await db.getApprovedBillByIdForIntegration(approvedLinkedId);
      assert.strictEqual(okRes.found, true);
      assert.strictEqual(okRes.bill.id, approvedLinkedId);
      assert.strictEqual(okRes.bill.attachmentsMeta.length, 2);

      const pendingRes = await db.getApprovedBillByIdForIntegration(pendingId);
      assert.strictEqual(pendingRes.found, false);
      assert.strictEqual(pendingRes.status, 403);

      const rejRes = await db.getApprovedBillByIdForIntegration(rejectedId);
      assert.strictEqual(rejRes.found, false);
      assert.strictEqual(rejRes.status, 403);
    });

    await runTest('Test 4: Live HTTP api/index.js HMAC protection + approved list + detail + attachment stream', async () => {
      const apiHandler = require('../api/index');
      const server = http.createServer((req, res) => {
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (obj) => {
          if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        res.send = (buf) => res.end(buf);
        apiHandler(req, res);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        // Unsigned request rejected with 401
        const unauth = await fetch(`http://127.0.0.1:${port}/api/integration/bills/approved`);
        assert.strictEqual(unauth.status, 401);

        // Signed request for approved bills list
        const listPath = '/api/integration/bills/approved';
        const listHeaders = integration.createSignedHeaders({
          method: 'GET',
          path: listPath,
          body: '',
        });
        const listResp = await fetch(`http://127.0.0.1:${port}${listPath}`, { headers: listHeaders });
        assert.strictEqual(listResp.status, 200);
        const listData = await listResp.json();
        assert.strictEqual(listData.success, true);
        assert(listData.bills.some((b) => b.id === approvedLinkedId));
        assert(listData.bills.some((b) => b.id === partialUnlinkedId));

        // Signed request for single approved bill detail
        const detailPath = `/api/integration/bills/${encodeURIComponent(partialUnlinkedId)}`;
        const detailHeaders = integration.createSignedHeaders({
          method: 'GET',
          path: detailPath,
          body: '',
        });
        const detailResp = await fetch(`http://127.0.0.1:${port}${detailPath}`, { headers: detailHeaders });
        assert.strictEqual(detailResp.status, 200);
        const detailData = await detailResp.json();
        assert.strictEqual(detailData.bill.id, partialUnlinkedId);
        assert.strictEqual(detailData.bill.categories.labour.approvedAmount, 2800);

        // Signed request for pending bill blocked with 403
        const pendingPath = `/api/integration/bills/${encodeURIComponent(pendingId)}`;
        const pendingHeaders = integration.createSignedHeaders({
          method: 'GET',
          path: pendingPath,
          body: '',
        });
        const pendingResp = await fetch(`http://127.0.0.1:${port}${pendingPath}`, { headers: pendingHeaders });
        assert.strictEqual(pendingResp.status, 403);

        // Signed attachment stream works for approved bill
        const attPath = `/api/integration/bills/${encodeURIComponent(approvedLinkedId)}/attachments/1`;
        const attHeaders = integration.createSignedHeaders({
          method: 'GET',
          path: attPath,
          body: '',
        });
        const attResp = await fetch(`http://127.0.0.1:${port}${attPath}`, { headers: attHeaders });
        assert.strictEqual(attResp.status, 200);
        assert.strictEqual(attResp.headers.get('content-type'), 'application/pdf');
      } finally {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    await runTest('Test 5: Active Attendance roster employees appear in employees filter even without bills', async () => {
      const rosterEmp = await db.addEmployee('Roster Only Technician', 'Field Engineer');
      const res = await db.getApprovedBillsForIntegration();
      assert.ok(Array.isArray(res.employees), 'employees must be an array');
      assert.ok(
        res.employees.some((e) => e.employeeId === rosterEmp.id && e.employeeName === 'Roster Only Technician'),
        'Active Attendance roster employee without approved bills must still appear in employees filter list'
      );
      // Verify bill employees are also present cleanly without empty names
      assert.ok(
        res.employees.some((e) => e.employeeName === 'Bilal Ahmed'),
        'Bill employee Bilal Ahmed must remain in employees list'
      );
    });

    await runTest('Test 6: Full Bill Management HTTP routes (list all statuses, detail pending, verify/approve/reject/override/link)', async () => {
      const apiHandler = require('../api/index');
      const server = http.createServer((req, res) => {
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (obj) => {
          if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        res.send = (buf) => res.end(buf);
        apiHandler(req, res);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        // Unsigned rejected
        const unauth = await fetch(`http://127.0.0.1:${port}/api/integration/bill-management`);
        assert.strictEqual(unauth.status, 401);

        // Signed full Bill Management list includes SUBMITTED & REJECTED & APPROVED
        const listPath = '/api/integration/bill-management';
        const listHeaders = integration.createSignedHeaders({ method: 'GET', path: listPath, body: '' });
        const listResp = await fetch(`http://127.0.0.1:${port}${listPath}`, { headers: listHeaders });
        assert.strictEqual(listResp.status, 200);
        const listData = await listResp.json();
        assert.strictEqual(listData.success, true);
        assert(listData.bills.some((b) => b.id === approvedLinkedId), 'Includes approved bill');
        assert(listData.bills.some((b) => b.id === pendingId), 'Includes pending bill');
        assert(listData.bills.some((b) => b.id === rejectedId), 'Includes rejected bill');
        assert(listData.stats && listData.stats.totalBills >= 4, 'Includes full stats summary');
        assert(listData.syncHealth && typeof listData.syncHealth.linkedCount === 'number', 'Includes syncHealth');
        assert(listData.employees.some((e) => e.employeeName === 'Roster Only Technician'), 'Includes roster employees');

        // Detail endpoint works for pending bill (whereas /api/integration/bills/:id keeps 403)
        const detPath = `/api/integration/bill-management/${encodeURIComponent(pendingId)}`;
        const detHeaders = integration.createSignedHeaders({ method: 'GET', path: detPath, body: '' });
        const detResp = await fetch(`http://127.0.0.1:${port}${detPath}`, { headers: detHeaders });
        assert.strictEqual(detResp.status, 200);
        const detData = await detResp.json();
        assert.strictEqual(detData.bill.id, pendingId);

        // Verify category on pending bill via integration endpoint
        const verPath = `/api/integration/bill-management/${encodeURIComponent(pendingId)}/verify-category`;
        const verBody = JSON.stringify({
          category: 'material',
          verifiedAmount: 1800,
          verificationComment: 'Verified from Accounts',
          verifiedBy: 'Batch 1 (Ali)'
        });
        const verHeaders = integration.createSignedHeaders({ method: 'POST', path: verPath, body: verBody });
        const verResp = await fetch(`http://127.0.0.1:${port}${verPath}`, {
          method: 'POST',
          headers: { ...verHeaders, 'Content-Type': 'application/json' },
          body: verBody
        });
        assert.strictEqual(verResp.status, 200);
        const verData = await verResp.json();
        assert.strictEqual(verData.bill.status, 'VERIFIED');
        assert.strictEqual(verData.bill.totalVerifiedAmount, 1800);

        // Approve category via integration endpoint (HMAC-verified, no local passcode needed)
        const appPath = `/api/integration/bill-management/${encodeURIComponent(pendingId)}/approve-category`;
        const appBody = JSON.stringify({
          category: 'material',
          approvedAmount: 1750,
          approvalComment: 'Approved by Accounts Admin',
          approvedBy: 'Fatma (Accounts Admin)'
        });
        const appHeaders = integration.createSignedHeaders({ method: 'POST', path: appPath, body: appBody });
        const appResp = await fetch(`http://127.0.0.1:${port}${appPath}`, {
          method: 'POST',
          headers: { ...appHeaders, 'Content-Type': 'application/json' },
          body: appBody
        });
        assert.strictEqual(appResp.status, 200);
        const appData = await appResp.json();
        assert.strictEqual(appData.bill.status, 'APPROVED');
        assert.strictEqual(appData.bill.totalApprovedAmount, 1750);

        // Link unlinked bill via integration endpoint
        const linkPath = `/api/integration/bill-management/${encodeURIComponent(pendingId)}/link-ticket`;
        const linkBody = JSON.stringify({
          ticketId: 102,
          serialNo: '1051',
          jobMetadataId: 502,
          branchName: 'Johar Town Branch',
          clientName: 'MCB',
          workNature: 'SOLAR',
          subject: 'Solar Inverter Check',
          linkedBy: 'Admin',
          verifyWithAccounts: false
        });
        const linkHeaders = integration.createSignedHeaders({ method: 'POST', path: linkPath, body: linkBody });
        const linkResp = await fetch(`http://127.0.0.1:${port}${linkPath}`, {
          method: 'POST',
          headers: { ...linkHeaders, 'Content-Type': 'application/json' },
          body: linkBody
        });
        assert.strictEqual(linkResp.status, 200);
        const linkData = await linkResp.json();
        assert.strictEqual(linkData.bill.ticketSelectionMode, 'LINKED');
        assert.strictEqual(linkData.bill.externalTicketSerialNo, '1051');
      } finally {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    await runTest('Test 7: Employees can attach/submit bills anytime without being bound to Clock Out', async () => {
      const indexHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
      const appJs = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');

      // Anytime entry points exist across header, sub-navigation, and portal
      assert.ok(indexHtml.includes('id="btn-header-submit-bill"'), 'Header Attach Bill button missing');
      assert.ok(indexHtml.includes('id="btn-subnav-submit-bill"'), 'Employee subnav Attach/Submit Bill button missing');
      assert.ok(indexHtml.includes('id="btn-portal-submit-bill"'), 'Attendance pane Attach/Submit Bill button missing');

      // Bill date is editable (type="date", not readonly) for submitting bills anytime
      assert.ok(
        /<input[^>]*type="date"[^>]*id="bill-date-display"/.test(indexHtml) &&
        !/id="bill-date-display"[^>]*readonly/.test(indexHtml),
        'bill-date-display must be an editable date input'
      );

      // No duplicate inline handlers alongside addEventListener bindings in initBillEventListeners
      assert.ok(!/id="btn-bill-add-pictures"[^>]*onclick=/.test(indexHtml), 'Duplicate onclick on btn-bill-add-pictures');
      assert.ok(!/id="bill-file-input"[^>]*onchange=/.test(indexHtml), 'Duplicate onchange on bill-file-input');
      assert.ok(!/id="btn-submit-bill-final"[^>]*onclick=/.test(indexHtml), 'Duplicate onclick on btn-submit-bill-final');

      // Clock out submission must NOT force/trigger openClockOutBillPrompt()
      const clockOutStart = appJs.indexOf('async function submitClockOutDetails(');
      assert.ok(clockOutStart !== -1, 'submitClockOutDetails not found');
      const clockOutEnd = appJs.indexOf('\nfunction ', clockOutStart + 1);
      const clockOutBody = appJs.slice(clockOutStart, clockOutEnd !== -1 ? clockOutEnd : clockOutStart + 1800);
      assert.ok(!clockOutBody.includes('openClockOutBillPrompt('), 'submitClockOutDetails still invokes openClockOutBillPrompt');

      // Database allows any employee to attach & submit a bill even with zero attendance / clock-out records
      const independentBill = await db.createBill({
        employeeId: 'emp-no-attendance-anytime',
        employeeName: 'Usman Tariq',
        siteName: 'Ferozepur Road Site',
        billDate: '2026-11-18',
        transportationExpense: 400,
        description: 'Standalone bill without clocking in/out',
        attachments: [
          { name: 'fuel-slip.png', type: 'image/png', dataUrl: samplePngBase64 },
        ],
        ticketSelectionMode: 'UNLINKED',
        _autoSync: false,
      });
      assert.ok(independentBill && independentBill.id, 'Expected bill id for standalone submission');
      assert.strictEqual(independentBill.status, 'SUBMITTED');
      assert.strictEqual(independentBill.attachments.length, 1);
    });

    await runTest('Test 8: Bidirectional verification/approval persists attribution, awaits sync, distinct idem keys & no duplicate button onclicks', async () => {
      const indexHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
      assert.ok(!/id="btn-submit-cat-verification"[^>]*onclick=/.test(indexHtml), 'Duplicate onclick on btn-submit-cat-verification');
      assert.ok(!/id="btn-submit-cat-approval"[^>]*onclick=/.test(indexHtml), 'Duplicate onclick on btn-submit-cat-approval');
      assert.ok(!/id="btn-submit-cat-rejection"[^>]*onclick=/.test(indexHtml), 'Duplicate onclick on btn-submit-cat-rejection');

      const origAccountsUrl = process.env.ACCOUNTS_APP_BASE_URL;
      process.env.ACCOUNTS_APP_BASE_URL = origAccountsUrl || 'https://accounts-management.vercel.app';

      const snap = {
        ticketId: 101,
        serialNo: '1050',
        jobMetadataId: 501,
        branchName: 'Model Town Branch',
        clientName: 'Meezan Bank',
        workNature: 'ELECTRICAL',
        subject: 'UPS Overhaul',
      };

      const bill = await db.createBill({
        employeeId: 'emp-bidir-1',
        employeeName: 'Sajid Mahmood',
        siteName: 'Model Town Branch',
        branchName: 'Model Town Branch',
        billDate: '2026-11-19',
        transportationExpense: 800,
        materialExpense: 2200,
        description: 'Bidirectional category sync test',
        ticketSelectionMode: 'LINKED',
        externalTicketId: snap.ticketId,
        externalTicketSerialNo: snap.serialNo,
        externalJobMetadataId: snap.jobMetadataId,
        clientName: snap.clientName,
        workNature: snap.workNature,
        ticketSubject: snap.subject,
        ticketSelectionToken: integration.signAuthoritativeTicketSelection(snap),
        _autoSync: false,
      });

      const origSync = db.syncBillToAccounts.bind(db);
      const syncCalls = [];
      db.syncBillToAccounts = async (billObj, opts) => {
        syncCalls.push({ id: billObj.id, status: billObj.status, opts });
        return { ok: true, skipped: true };
      };

      try {
        // 1. Category verification without skipAccountsSync awaits syncBillToAccounts and sets top-level verifiedBy
        const afterVer1 = await db.verifyBillCategory(bill.id, {
          category: 'transportation',
          verifiedAmount: 800,
          verificationComment: 'Verified by Accounts Emp',
          verifiedBy: 'Ahsan Ali (Batch 1 - Accounts)',
        });
        assert.strictEqual(afterVer1.verifiedBy, 'Ahsan Ali (Batch 1 - Accounts)');
        assert.strictEqual(afterVer1.status, 'PARTIALLY_VERIFIED');
        assert.strictEqual(syncCalls.length, 1, 'verifyBillCategory must await syncBillToAccounts by default');

        // 2. Category verification with skipAccountsSync: true skips outbound callback
        const afterVer2 = await db.verifyBillCategory(bill.id, {
          category: 'material',
          verifiedAmount: 2100,
          verificationComment: 'Verified by Admin',
          verifiedBy: 'Attendance Admin',
          skipAccountsSync: true,
        });
        assert.strictEqual(afterVer2.verifiedBy, 'Attendance Admin');
        assert.strictEqual(afterVer2.status, 'VERIFIED');
        assert.strictEqual(syncCalls.length, 1, 'skipAccountsSync: true must skip outbound syncBillToAccounts');

        // 3. Category approvals update status -> PARTIALLY_APPROVED -> APPROVED and persist approvedBy
        const afterApp1 = await db.approveBillCategory(bill.id, {
          category: 'transportation',
          approvedAmount: 750,
          approvalComment: 'Partial approve',
          approvedBy: 'Fatma (Accounts Admin)',
        });
        assert.strictEqual(afterApp1.status, 'PARTIALLY_APPROVED');
        assert.strictEqual(afterApp1.approvedBy, 'Fatma (Accounts Admin)');
        assert.strictEqual(syncCalls.length, 2, 'approveBillCategory must await syncBillToAccounts');

        const afterApp2 = await db.approveBillCategory(bill.id, {
          category: 'material',
          approvedAmount: 2100,
          approvalComment: 'Full approve',
          approvedBy: 'Fatma (Accounts Admin)',
        });
        assert.strictEqual(afterApp2.status, 'APPROVED');
        assert.strictEqual(afterApp2.approvedBy, 'Fatma (Accounts Admin)');
        assert.strictEqual(syncCalls.length, 3);

        // 4. Deterministic idempotency key changes whenever category verification/approval state changes
        const seenKeys = [];
        const spyFetch = async (_url, init) => {
          const h = init.headers || {};
          seenKeys.push(h['X-FES-Idempotency-Key'] || h['x-fes-idempotency-key']);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, expenseId: 777 }),
          };
        };
        const cfg = {
          enabled: true,
          accountsBaseUrl: 'https://accounts-management.vercel.app',
          apiKey: process.env.FES_INTEGRATION_API_KEY,
          secret: process.env.FES_INTEGRATION_SECRET,
        };
        await integration.syncBillExpenseToAccounts(afterVer1, { config: cfg, fetchFn: spyFetch });
        await integration.syncBillExpenseToAccounts(afterVer2, { config: cfg, fetchFn: spyFetch });
        assert.strictEqual(seenKeys.length, 2);
        assert.notStrictEqual(seenKeys[0], seenKeys[1], 'Distinct category verification states must produce distinct deterministic idempotency keys');
      } finally {
        db.syncBillToAccounts = origSync;
        if (origAccountsUrl === undefined) delete process.env.ACCOUNTS_APP_BASE_URL;
        else process.env.ACCOUNTS_APP_BASE_URL = origAccountsUrl;
      }
    });
  } finally {
    if (originalDataJson !== null) {
      fs.writeFileSync(dataJsonPath, originalDataJson, 'utf8');
    } else if (fs.existsSync(dataJsonPath)) {
      fs.unlinkSync(dataJsonPath);
    }
  }

  console.log('\n====================================================================');
  console.log(`  APPROVED BILLS INTEGRATION TESTS: ${passed} / ${passed + failed} PASSED`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
