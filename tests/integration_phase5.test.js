/**
 * FES Phase 5 Automated Test Suite — Attendance App Recovery, Bi-Directional Status Sync & Health Monitoring
 *
 * Covers:
 *  1. Office-side recovery linking an UNLINKED bill -> validates active Ticket + complete JobMetadata, prevents fake tickets
 *  2. Prevents silent overwrite on already LINKED bills (409 Conflict)
 *  3. HTTP auth protection on POST /api/bills/:id/link-ticket, POST /api/bills/retry-failed-syncs, GET /api/integration/health
 *  4. Inbound Accounts status update webhook (POST /api/integration/bills/status-update) HMAC auth, idempotency, conflict safety
 *  5. Integration health counters & bulk retry recovering SYNC_FAILED linked bills cleanly
 *  6. Admin UI DOM hooks for Sync Health Panel, Retry Failed button, and Office Ticket Linking
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const integration = require('../integration-client');
const db = require('../db');

db.useLocalFallback = true;

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`           ${err.message}`);
    failed++;
  }
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log('  FES ATTENDANCE APP — PHASE 5 RECOVERY, BIDIR SYNC & HEALTH SUITE');
  console.log('====================================================================\n');

  const testConfig = {
    enabled: true,
    accountsBaseUrl: 'https://accounts-management.vercel.app',
    apiKey: 'fes_att_phase5_key',
    secret: 'a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8',
    timeoutMs: 2000
  };

  await runTest('Test 1: Office-side recovery links UNLINKED bill to verified Accounts ticket and blocks fake tickets', async () => {
    const unlinkedBill = await db.createBill({
      employeeId: 'test-emp-p5-recover',
      employeeName: 'Recovery Tester',
      siteName: 'Rough Roadside Location',
      billDate: '2026-11-16',
      materialExpense: 4000,
      transportationExpense: 1000,
      description: 'Emergency work before ticket lookup',
      ticketSelectionMode: 'UNLINKED'
    });
    assert.strictEqual(unlinkedBill.ticketSelectionMode, 'UNLINKED');

    // Attempt to link using FAKE / nonexistent ticket when Accounts lookup does NOT return it -> 422 rejected!
    let fakeRejected = false;
    try {
      await db.linkBillToAccountsTicket(
        unlinkedBill.id,
        {
          ticketId: 99999,
          serialNo: 'FAKE-9999',
          jobMetadataId: 88888,
          branchName: 'Fake Branch',
          clientName: 'Fake Client',
          workNature: 'ELECTRICAL'
        },
        {
          config: testConfig,
          fetchFn: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, count: 0, tickets: [] })
          })
        }
      );
    } catch (err) {
      fakeRejected = err.status === 422;
    }
    assert.strictEqual(fakeRejected, true, 'Fake or nonexistent ticket numbers must be rejected');

    // Now link to REAL active Ticket + complete JobMetadata verified from Accounts lookup
    const authoritativeTicket = {
      ticketId: 201,
      serialNo: '3055',
      jobMetadataId: 901,
      branchName: 'DHA Phase 5 Branch',
      clientName: 'Askari Bank',
      workNature: 'MAINTENANCE',
      subject: 'Inverter fault',
      personOfContact: 'Mr. Tariq'
    };

    const linkRes = await db.linkBillToAccountsTicket(
      unlinkedBill.id,
      {
        ...authoritativeTicket,
        ticketSelectionToken: integration.signAuthoritativeTicketSelection(authoritativeTicket)
      },
      {
        config: testConfig,
        fetchFn: async (url) => {
          if (url.includes('/tickets/lookup')) {
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ success: true, tickets: [authoritativeTicket] })
            };
          }
          // Expense sync endpoint
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, expenseId: 8801, syncedAt: '2026-11-16T06:00:00Z' })
          };
        }
      }
    );

    assert.strictEqual(linkRes.ok, true);
    assert.strictEqual(linkRes.bill.ticketSelectionMode, 'LINKED');
    assert.strictEqual(linkRes.bill.externalTicketSerialNo, '3055');
    assert.strictEqual(linkRes.bill.siteName, 'DHA Phase 5 Branch');
    assert.strictEqual(linkRes.bill.clientName, 'Askari Bank');
    assert.strictEqual(linkRes.bill.integrationSyncStatus, 'SYNCED');

    // Re-linking an already LINKED bill must be rejected (409)
    let overwriteBlocked = false;
    try {
      await db.linkBillToAccountsTicket(
        unlinkedBill.id,
        authoritativeTicket,
        { verifyWithAccounts: false, autoSync: false }
      );
    } catch (err) {
      overwriteBlocked = err.status === 409;
    }
    assert.strictEqual(overwriteBlocked, true, 'Already LINKED bill cannot be overwritten via recovery link');
  });

  await runTest('Test 2: Inbound applyAccountsStatusUpdate progresses RECEIVED -> VERIFIED -> APPROVED and blocks stale regressions', async () => {
    const snap = {
      ticketId: 202,
      serialNo: '3056',
      jobMetadataId: 902,
      branchName: 'Faisal Town Branch',
      clientName: 'Bank Alfalah',
      workNature: 'ELECTRICAL',
      subject: 'DB Panel fault'
    };

    const linkedBill = await db.createBill({
      employeeId: 'test-emp-p5-bidir',
      employeeName: 'Bidir Tester',
      siteName: snap.branchName,
      branchName: snap.branchName,
      transportationExpense: 2000,
      materialExpense: 8000,
      ticketSelectionMode: 'LINKED',
      externalTicketId: snap.ticketId,
      externalTicketSerialNo: snap.serialNo,
      externalJobMetadataId: snap.jobMetadataId,
      clientName: snap.clientName,
      workNature: snap.workNature,
      ticketSubject: snap.subject,
      ticketSelectionToken: integration.signAuthoritativeTicketSelection(snap),
      _autoSync: false
    });

    // 1. VERIFIED (9,500)
    const stepVer = await db.applyAccountsStatusUpdate({
      externalBillId: linkedBill.id,
      externalExpenseId: 8802,
      ticketId: 202,
      approvalStatus: 'VERIFIED',
      verifiedAmount: 9500,
      verifiedBy: 'Accounts Verifier'
    });
    assert.strictEqual(stepVer.applied, true);
    assert.strictEqual(stepVer.bill.status, 'VERIFIED');
    assert.strictEqual(stepVer.bill.totalVerifiedAmount, 9500);
    assert.strictEqual(stepVer.bill.totalApprovedAmount, 0);

    // 2. APPROVED (9,000)
    const stepApp = await db.applyAccountsStatusUpdate({
      externalBillId: linkedBill.id,
      externalExpenseId: 8802,
      ticketId: 202,
      approvalStatus: 'APPROVED',
      verifiedAmount: 9500,
      approvedAmount: 9000,
      approvedBy: 'Accounts Director'
    });
    assert.strictEqual(stepApp.applied, true);
    assert.strictEqual(stepApp.bill.status, 'APPROVED');
    assert.strictEqual(stepApp.bill.totalApprovedAmount, 9000);

    // 3. Idempotent duplicate call -> idempotent=true, no crash
    const stepDup = await db.applyAccountsStatusUpdate({
      externalBillId: linkedBill.id,
      externalExpenseId: 8802,
      ticketId: 202,
      approvalStatus: 'APPROVED',
      verifiedAmount: 9500,
      approvedAmount: 9000
    });
    assert.strictEqual(stepDup.applied, false);
    assert.strictEqual(stepDup.idempotent, true);

    // 4. Stale regression (RECEIVED or VERIFIED after APPROVED) -> conflictIgnored=true, APPROVED preserved
    const stepStale = await db.applyAccountsStatusUpdate({
      externalBillId: linkedBill.id,
      ticketId: 202,
      approvalStatus: 'VERIFIED',
      verifiedAmount: 5000
    });
    assert.strictEqual(stepStale.applied, false);
    assert.strictEqual(stepStale.conflictIgnored, true);
    assert.strictEqual(stepStale.bill.status, 'APPROVED');
    assert.strictEqual(stepStale.bill.totalApprovedAmount, 9000);
  });

  await runTest('Test 3: Batch retry recovers SYNC_FAILED bills & getIntegrationSyncHealth never exposes secrets', async () => {
    const snap = {
      ticketId: 203,
      serialNo: '3057',
      jobMetadataId: 903,
      branchName: 'Model Town Branch',
      clientName: 'MCB',
      workNature: 'WAPDA',
      subject: 'Meter upgrade'
    };

    // Create a linked bill whose initial sync fails
    const failedBill = await db.createBill({
      employeeId: 'test-emp-p5-retry',
      employeeName: 'Retry Tester',
      siteName: snap.branchName,
      branchName: snap.branchName,
      otherExpense: 2500,
      ticketSelectionMode: 'LINKED',
      externalTicketId: snap.ticketId,
      externalTicketSerialNo: snap.serialNo,
      externalJobMetadataId: snap.jobMetadataId,
      clientName: snap.clientName,
      workNature: snap.workNature,
      ticketSubject: snap.subject,
      ticketSelectionToken: integration.signAuthoritativeTicketSelection(snap),
      _syncOptions: {
        config: testConfig,
        fetchFn: async () => { throw new Error('ECONNRESET'); }
      }
    });
    assert.strictEqual(failedBill.integrationSyncStatus, 'SYNC_FAILED');

    const healthBefore = await db.getIntegrationSyncHealth();
    assert.ok(healthBefore.syncFailedCount >= 1);
    assert.ok(healthBefore.failedBills.some(b => b.id === failedBill.id));
    assert.ok(!JSON.stringify(healthBefore).includes(testConfig.secret), 'Health payload must not expose secrets');

    // Run batch retry -> recovers failedBill to SYNCED
    const batchRes = await db.retryAllFailedBillSyncs({
      includePending: false,
      config: testConfig,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, expenseId: 8803, syncedAt: '2026-11-16T06:15:00Z' })
      })
    });
    assert.ok(batchRes.succeeded >= 1);
    const recovered = await db.getBillById(failedBill.id);
    assert.strictEqual(recovered.integrationSyncStatus, 'SYNCED');
    assert.strictEqual(recovered.externalExpenseId, 8803);
  });

  await runTest('Test 4: Live HTTP routes for link-ticket, retry-failed-syncs, integration/health & status-update webhook', async () => {
    const prevKey = process.env.FES_INTEGRATION_API_KEY;
    const prevSec = process.env.FES_INTEGRATION_SECRET;
    const prevEnabled = process.env.FES_INTEGRATION_ENABLED;
    process.env.FES_INTEGRATION_API_KEY = testConfig.apiKey;
    process.env.FES_INTEGRATION_SECRET = testConfig.secret;
    process.env.FES_INTEGRATION_ENABLED = 'true';
    integration.clearIdempotencyStore();

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
      // 1. Unauthenticated admin calls -> 401
      const unauthHealth = await fetch(`http://127.0.0.1:${port}/api/integration/health`);
      assert.strictEqual(unauthHealth.status, 401);

      const unauthLink = await fetch(`http://127.0.0.1:${port}/api/bills/bill-123/link-ticket`, { method: 'POST' });
      assert.strictEqual(unauthLink.status, 401);

      // 2. Authenticated Admin health check -> 200
      const okHealth = await fetch(`http://127.0.0.1:${port}/api/integration/health`, {
        headers: { 'x-admin-passcode': '1280' }
      });
      assert.strictEqual(okHealth.status, 200);
      const healthJson = await okHealth.json();
      assert.strictEqual(healthJson.success, true);
      assert.ok(typeof healthJson.health.linkedCount === 'number');

      // 3. Create a linked bill then send signed status-update webhook -> 200 + idempotent replay
      const snap = {
        ticketId: 204,
        serialNo: '3058',
        jobMetadataId: 904,
        branchName: 'Saddar Branch',
        clientName: 'Faysal Bank',
        workNature: 'PROJECT',
        subject: 'UPS Commissioning'
      };
      const targetBill = await db.createBill({
        employeeId: 'test-emp-p5-http',
        employeeName: 'Webhook Tester',
        siteName: snap.branchName,
        branchName: snap.branchName,
        materialExpense: 5000,
        ticketSelectionMode: 'LINKED',
        externalTicketId: snap.ticketId,
        externalTicketSerialNo: snap.serialNo,
        externalJobMetadataId: snap.jobMetadataId,
        clientName: snap.clientName,
        workNature: snap.workNature,
        ticketSubject: snap.subject,
        ticketSelectionToken: integration.signAuthoritativeTicketSelection(snap),
        _autoSync: false
      });

      const hookPath = '/api/integration/bills/status-update';
      const hookBody = JSON.stringify({
        externalBillId: targetBill.id,
        externalExpenseId: 8804,
        ticketId: 204,
        approvalStatus: 'REJECTED',
        rejectedBy: 'Accounts Lead',
        rejectionReason: 'Receipt blurry'
      });

      // Unsigned webhook rejected -> 401
      const badHook = await fetch(`http://127.0.0.1:${port}${hookPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hookBody
      });
      assert.strictEqual(badHook.status, 401);

      // Signed webhook -> 200 REJECTED
      const hookHeaders = integration.createSignedHeaders({
        method: 'POST',
        path: hookPath,
        body: hookBody,
        idempotencyKey: `hook_${targetBill.id}_rej`,
        apiKey: testConfig.apiKey,
        secret: testConfig.secret
      });
      const okHook = await fetch(`http://127.0.0.1:${port}${hookPath}`, {
        method: 'POST',
        headers: hookHeaders,
        body: hookBody
      });
      assert.strictEqual(okHook.status, 200);
      const hookJson = await okHook.json();
      assert.strictEqual(hookJson.status, 'REJECTED');
      assert.strictEqual(hookJson.applied, true);

      // Replay identical webhook -> idempotentReplay: true
      const replayHook = await fetch(`http://127.0.0.1:${port}${hookPath}`, {
        method: 'POST',
        headers: hookHeaders,
        body: hookBody
      });
      assert.strictEqual(replayHook.status, 200);
      const replayJson = await replayHook.json();
      assert.strictEqual(replayJson.idempotentReplay, true);
    } finally {
      if (prevKey !== undefined) process.env.FES_INTEGRATION_API_KEY = prevKey; else delete process.env.FES_INTEGRATION_API_KEY;
      if (prevSec !== undefined) process.env.FES_INTEGRATION_SECRET = prevSec; else delete process.env.FES_INTEGRATION_SECRET;
      if (prevEnabled !== undefined) process.env.FES_INTEGRATION_ENABLED = prevEnabled; else delete process.env.FES_INTEGRATION_ENABLED;
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await runTest('Test 5: Admin UI contains Sync Health, Retry, and Unlinked Recovery controls without exposing secrets', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

    for (const id of [
      'admin-integration-health-panel',
      'btn-retry-failed-syncs',
      'btn-filter-unlinked-bills',
      'btn-filter-sync-failed',
      'admin-bill-modal-sync-status',
      'admin-bill-link-ticket-panel',
      'admin-modal-ticket-search-input'
    ]) {
      assert.ok(html.includes(`id="${id}"`), `Missing Phase 5 Admin UI hook id="${id}"`);
    }

    assert.ok(js.includes('retryAllFailedSyncsUI'));
    assert.ok(js.includes('confirmAdminLinkTicket'));
    assert.ok(!js.includes('FES_INTEGRATION_SECRET'));
    assert.ok(!js.includes('FES_INTEGRATION_API_KEY'));
  });

  await runTest('Test 6: Rejects ticket linking when JobMetadata is missing or incomplete', async () => {
    const unlinkedBill = await db.createBill({
      employeeId: 'test-emp-p5-nojobmeta',
      employeeName: 'NoMeta Tester',
      siteName: 'General Site',
      billDate: '2026-11-16',
      materialExpense: 1800,
      ticketSelectionMode: 'UNLINKED'
    });

    // 1. Missing jobMetadataId or workNature in request body -> 400
    let missingFieldCode = null;
    try {
      await db.linkBillToAccountsTicket(
        unlinkedBill.id,
        { ticketId: 991, serialNo: '9910', branchName: 'Main', clientName: 'HBL' },
        { verifyWithAccounts: false, autoSync: false }
      );
    } catch (err) {
      missingFieldCode = err.status;
    }
    assert.strictEqual(missingFieldCode, 400);

    // 2. Ticket exists in Accounts without complete JobMetadata -> Accounts returns empty authoritative match -> 422
    let missingJobMetaCode = null;
    try {
      await db.linkBillToAccountsTicket(
        unlinkedBill.id,
        {
          ticketId: 992,
          serialNo: '9920',
          jobMetadataId: 777,
          branchName: 'Main',
          clientName: 'HBL',
          workNature: 'ELECTRICAL'
        },
        {
          config: testConfig,
          autoSync: false,
          fetchFn: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, tickets: [] })
          })
        }
      );
    } catch (err) {
      missingJobMetaCode = err.status;
    }
    assert.strictEqual(missingJobMetaCode, 422);

    const stillUnlinked = await db.getBillById(unlinkedBill.id);
    assert.strictEqual(stillUnlinked.ticketSelectionMode, 'UNLINKED');
  });

  await runTest('Test 7: Admin route permission checks & legacy metadata-only attachment handling', async () => {
    const apiHandler = require('../api/index');
    const server = http.createServer((req, res) => {
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      res.send = (buf) => res.end(buf);
      apiHandler(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // Wrong/missing passcode blocked on admin retry & link endpoints -> 401
      const badRetry = await fetch(`http://127.0.0.1:${port}/api/bills/retry-failed-syncs`, {
        method: 'POST',
        headers: { 'x-admin-passcode': 'wrong-passcode' }
      });
      assert.strictEqual(badRetry.status, 401);

      const badLink = await fetch(`http://127.0.0.1:${port}/api/bills/bill-any/link-ticket`, {
        method: 'POST',
        headers: { 'x-admin-passcode': 'wrong-passcode' }
      });
      assert.strictEqual(badLink.status, 401);

      // Legacy bill metadata without binary dataUrl
      const legacyBill = await db.createBill({
        employeeId: 'test-emp-p5-legacy',
        employeeName: 'Legacy Att Tester',
        siteName: 'Old Branch',
        billDate: '2026-10-01',
        otherExpense: 900,
        ticketSelectionMode: 'UNLINKED',
        attachments: [{ name: 'legacy-scan.jpg', type: 'image/jpeg', size: 2048 }],
        _autoSync: false
      });

      const meta = integration.extractAttachmentMetadata(legacyBill.attachments);
      assert.strictEqual(meta.length, 1);
      assert.strictEqual(meta[0].hasBinary, false);

      const binaryCheck = await db.getBillAttachmentForIntegration(legacyBill.id, 0);
      assert.strictEqual(binaryCheck.valid, false);
      assert.strictEqual(binaryCheck.status, 404);
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log('\n====================================================================');
  console.log(`  PHASE 5 ATTENDANCE APP TESTS: ${passed} / ${passed + failed} PASSED`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
