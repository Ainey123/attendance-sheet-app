/**
 * FES Phase 4 Automated Test Suite — Attendance App Outbound Expense Sync, Retry,
 * Attachment Proxy & Backward Compatibility
 *
 * Covers:
 *  1. LINKED bill auto-sync on creation -> SYNCED + externalExpenseId stored
 *  2. Accounts unavailable during bill submission does NOT block bill creation -> SYNC_FAILED
 *  3. Sync error sanitization ensures HMAC secret / headers never stored in integrationSyncError
 *  4. Admin retry (db.syncBillToAccounts / POST /api/bills/:id/sync-accounts) recovers SYNC_FAILED -> SYNCED
 *  5. UNLINKED bills stay UNLINKED_LOCAL and never fabricate Accounts sync or ticket linkage
 *  6. Unsafe attachment MIME types (image/svg+xml, text/html) blocked in createBill & attachment streaming
 *  7. HMAC-signed GET /api/integration/bills/:id/attachments/:index streams JPEG/PDF binary safely
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
  console.log('  FES ATTENDANCE APP — PHASE 4 EXPENSE SYNC & ATTACHMENT PROXY SUITE');
  console.log('====================================================================\n');

  const testConfig = {
    enabled: true,
    accountsBaseUrl: 'https://accounts-management.vercel.app',
    apiKey: 'fes_att_phase4_key',
    secret: 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
    timeoutMs: 2000
  };

  const makeTicketFields = (overrides = {}) => {
    const snap = {
      ticketId: 101,
      serialNo: '1024',
      jobMetadataId: 501,
      branchName: 'DHA Phase 8 Branch',
      clientName: 'HBL',
      workNature: 'ELECTRICAL',
      subject: 'UPS Repair',
      ...overrides
    };
    return {
      siteName: snap.branchName,
      branchName: snap.branchName,
      ticketSelectionMode: 'LINKED',
      externalTicketId: snap.ticketId,
      externalTicketSerialNo: snap.serialNo,
      externalJobMetadataId: snap.jobMetadataId,
      clientName: snap.clientName,
      workNature: snap.workNature,
      ticketSubject: snap.subject,
      ticketSelectionToken: integration.signAuthoritativeTicketSelection(snap)
    };
  };

  await runTest('Test 1: LINKED bill submission strips Base64 from outbound sync and marks SYNCED on 200 OK', async () => {
    let capturedBody = null;
    let capturedHeaders = null;

    const bill = await db.createBill({
      employeeId: 'test-emp-p4-1',
      employeeName: 'Zainab Ali',
      ...makeTicketFields(),
      billDate: '2026-11-16',
      materialExpense: 4200,
      transportationExpense: 800,
      description: 'Cable & fuel',
      attachments: [
        { name: 'receipt.jpg', type: 'image/jpeg', size: 1234, dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }
      ],
      _syncOptions: {
        config: testConfig,
        fetchFn: async (_url, init) => {
          capturedBody = JSON.parse(init.body);
          capturedHeaders = init.headers;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              expenseId: 7701,
              approvalStatus: 'RECEIVED',
              amount: 0,
              claimedAmount: 5000,
              syncedAt: '2026-11-16T05:00:00.000Z'
            })
          };
        }
      }
    });

    assert.ok(capturedHeaders['X-FES-Signature'], 'Outbound sync must be HMAC signed');
    assert.ok(capturedHeaders['X-FES-Idempotency-Key'], 'Outbound sync must include idempotency key');
    assert.strictEqual(capturedBody.totalClaimedAmount, 5000);
    assert.strictEqual(capturedBody.effectiveApprovedAmount, 0, 'Must sync effectiveApprovedAmount=0 before approval');
    assert.strictEqual(capturedBody.attachmentsMeta.length, 1);
    assert.strictEqual(capturedBody.attachmentsMeta[0].dataUrl, undefined, 'Base64 must never be sent to Accounts');

    assert.strictEqual(bill.integrationSyncStatus, 'SYNCED');
    assert.strictEqual(bill.externalExpenseId, 7701);
    assert.strictEqual(bill.integrationSyncError, null);
  });

  await runTest('Test 2: Accounts unavailable during bill creation does NOT block submission -> sets SYNC_FAILED safely and retries cleanly', async () => {
    const bill = await db.createBill({
      employeeId: 'test-emp-p4-2',
      employeeName: 'Bilal Tariq',
      ...makeTicketFields(),
      billDate: '2026-11-16',
      labourExpense: 3000,
      description: 'Technician labor',
      attachments: [],
      _syncOptions: {
        config: testConfig,
        fetchFn: async () => {
          throw new Error(`ECONNREFUSED with x-fes-signature=${testConfig.secret}`);
        }
      }
    });

    assert.ok(bill.id && bill.billNumber, 'Bill must still be created even when Accounts App is unreachable');
    assert.strictEqual(bill.ticketSelectionMode, 'LINKED');
    assert.strictEqual(bill.integrationSyncStatus, 'SYNC_FAILED');
    assert.ok(bill.integrationSyncError.includes('Accounts App unreachable'));
    assert.ok(!bill.integrationSyncError.includes(testConfig.secret), 'Sync error message must redact secrets');

    // Now retry sync when Accounts App recovers
    const retryRes = await db.syncBillToAccounts(bill.id, {
      config: testConfig,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          expenseId: 7702,
          approvalStatus: 'RECEIVED',
          amount: 0,
          claimedAmount: 3000,
          syncedAt: '2026-11-16T05:05:00.000Z'
        })
      })
    });

    assert.strictEqual(retryRes.ok, true);
    assert.strictEqual(retryRes.bill.integrationSyncStatus, 'SYNCED');
    assert.strictEqual(retryRes.bill.externalExpenseId, 7702);
    assert.strictEqual(retryRes.bill.integrationSyncError, null);
  });

  await runTest('Test 3: UNLINKED bills stay UNLINKED_LOCAL and refuse outbound sync fabrication', async () => {
    let fetchCalled = false;
    const unlinkedBill = await db.createBill({
      employeeId: 'test-emp-p4-3',
      employeeName: 'Sara Khan',
      siteName: 'General Unlinked Site',
      billDate: '2026-11-16',
      otherExpense: 1200,
      ticketSelectionMode: 'UNLINKED',
      _syncOptions: {
        config: testConfig,
        fetchFn: async () => { fetchCalled = true; throw new Error('Should not be called'); }
      }
    });

    assert.strictEqual(fetchCalled, false);
    assert.strictEqual(unlinkedBill.ticketSelectionMode, 'UNLINKED');
    assert.strictEqual(unlinkedBill.integrationSyncStatus, 'UNLINKED_LOCAL');

    const manualRetry = await db.syncBillToAccounts(unlinkedBill.id, { config: testConfig });
    assert.strictEqual(manualRetry.ok, false);
    assert.strictEqual(manualRetry.skipped, true);
  });

  await runTest('Test 4: Unsafe MIME types (SVG / HTML) rejected at bill creation & binary decoding', async () => {
    let svgRejected = false;
    try {
      await db.createBill({
        employeeId: 'test-emp-p4-4',
        employeeName: 'MIME Tester',
        siteName: 'Site X',
        otherExpense: 500,
        attachments: [
          { name: 'vector.svg', type: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
        ]
      });
    } catch (err) {
      svgRejected = err.status === 400;
    }
    assert.strictEqual(svgRejected, true, 'SVG attachments must be rejected');

    const decodeUnsafe = integration.decodeBillAttachmentDataUrl({
      name: 'bad.html',
      type: 'text/html',
      dataUrl: 'data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4='
    });
    assert.strictEqual(decodeUnsafe.valid, false);
    assert.strictEqual(decodeUnsafe.status, 415);
  });

  await runTest('Test 5: Live HMAC-authenticated attachment streaming & retry sync HTTP routes on Attendance api/index.js', async () => {
    const sampleBytes = Buffer.from('FAKE_PNG_BINARY_CONTENT', 'utf8');
    const billWithImg = await db.createBill({
      employeeId: 'test-emp-p4-5',
      employeeName: 'Stream Tester',
      siteName: 'Clifton Site',
      materialExpense: 650,
      attachments: [
        {
          name: 'receipt.png',
          type: 'image/png',
          size: sampleBytes.length,
          dataUrl: `data:image/png;base64,${sampleBytes.toString('base64')}`
        }
      ],
      ticketSelectionMode: 'UNLINKED'
    });

    const prevKey = process.env.FES_INTEGRATION_API_KEY;
    const prevSec = process.env.FES_INTEGRATION_SECRET;
    const prevEnabled = process.env.FES_INTEGRATION_ENABLED;
    process.env.FES_INTEGRATION_API_KEY = testConfig.apiKey;
    process.env.FES_INTEGRATION_SECRET = testConfig.secret;
    process.env.FES_INTEGRATION_ENABLED = 'true';

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
      // 1. Unauthorized call (missing HMAC) -> 401
      const unauth = await fetch(`http://127.0.0.1:${port}/api/integration/bills/${billWithImg.id}/attachments/0`);
      assert.strictEqual(unauth.status, 401);

      // 2. Signed call -> streams PNG binary with nosniff
      const attPath = `/api/integration/bills/${billWithImg.id}/attachments/0`;
      const signedHeaders = integration.createSignedHeaders({
        method: 'GET',
        path: attPath,
        body: '',
        apiKey: testConfig.apiKey,
        secret: testConfig.secret
      });
      const okResp = await fetch(`http://127.0.0.1:${port}${attPath}`, {
        method: 'GET',
        headers: signedHeaders
      });
      assert.strictEqual(okResp.status, 200);
      assert.strictEqual(okResp.headers.get('content-type'), 'image/png');
      assert.strictEqual(okResp.headers.get('x-content-type-options'), 'nosniff');
      const streamedBuf = Buffer.from(await okResp.arrayBuffer());
      assert.strictEqual(streamedBuf.toString('utf8'), 'FAKE_PNG_BINARY_CONTENT');

      // 3. Admin retry sync endpoint rejects UNLINKED bill cleanly with 400
      const retryUnlinked = await fetch(`http://127.0.0.1:${port}/api/bills/${billWithImg.id}/sync-accounts`, {
        method: 'POST',
        headers: { 'x-admin-passcode': '1280' }
      });
      assert.strictEqual(retryUnlinked.status, 400);
      const retryJson = await retryUnlinked.json();
      assert.strictEqual(retryJson.code, 'BILL_UNLINKED');
    } finally {
      if (prevKey !== undefined) process.env.FES_INTEGRATION_API_KEY = prevKey; else delete process.env.FES_INTEGRATION_API_KEY;
      if (prevSec !== undefined) process.env.FES_INTEGRATION_SECRET = prevSec; else delete process.env.FES_INTEGRATION_SECRET;
      if (prevEnabled !== undefined) process.env.FES_INTEGRATION_ENABLED = prevEnabled; else delete process.env.FES_INTEGRATION_ENABLED;
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log('\n====================================================================');
  console.log(`  PHASE 4 ATTENDANCE APP TESTS: ${passed} / ${passed + failed} PASSED`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
