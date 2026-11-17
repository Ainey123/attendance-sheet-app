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
