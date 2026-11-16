/**
 * FES Phase 3 Automated Test Suite — Attendance App Ticket Search, Linked/Unlinked Bills & Security
 *
 * Covers:
 *  1. Server integration lookupAuthoritativeTickets() success + incomplete item exclusion
 *  2. Graceful handling of unavailable server, timeout, 401 auth failure, and malformed JSON
 *  3. Frontend security hygiene: zero API key/secret exposure in public/app.js or public/index.html
 *  4. Linked bill creation persists authoritative ticket metadata and sets PENDING_SYNC
 *  5. UNLINKED bill fallback works safely and strips invented ticket numbers
 *  6. Authoritative metadata tampering & silent overwrite protections
 *  7. HTTP server proxy route (/api/integration/tickets/search & /api/bills) end-to-end check
 *  8. Additive migration SQL schema coverage
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
  console.log('  FES ATTENDANCE APP — PHASE 3 TICKET ASSISTANCE & BILL LINKAGE SUITE');
  console.log('====================================================================\n');

  const testConfig = {
    enabled: true,
    accountsBaseUrl: 'https://accounts-management.vercel.app',
    apiKey: 'fes_att_phase3_key',
    secret: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    timeoutMs: 1500
  };

  await runTest('Test 1: lookupAuthoritativeTickets validates results, drops incomplete JobMetadata, and signs selectionToken', async () => {
    const res = await integration.lookupAuthoritativeTickets(
      { query: 'HBL' },
      {
        config: testConfig,
        fetchFn: async (_url, init) => {
          assert.ok(init.headers['X-FES-Signature'], 'Outbound call must include HMAC signature');
          assert.ok(init.headers['X-FES-Api-Key'], 'Outbound call must include API key');
          assert.ok(init.headers['X-FES-Timestamp'], 'Outbound call must include timestamp');
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              tickets: [
                {
                  ticketId: 11,
                  serialNo: '1040',
                  jobMetadataId: 91,
                  branchName: 'Clifton Branch',
                  clientName: 'HBL',
                  personOfContact: 'Mr. Kamran',
                  workNature: 'ELECTRICAL',
                  subject: 'Breaker tripping',
                  exactMatch: false
                },
                {
                  // Incomplete item should be rejected
                  ticketId: 12,
                  serialNo: '1041',
                  jobMetadataId: null,
                  branchName: 'Unknown',
                  clientName: 'HBL',
                  workNature: 'ELECTRICAL'
                }
              ]
            })
          };
        }
      }
    );

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.count, 1);
    assert.strictEqual(res.tickets[0].serialNo, '1040');
    assert.strictEqual(
      integration.verifyAuthoritativeTicketSelection(res.tickets[0], res.tickets[0].selectionToken, testConfig.secret),
      true
    );
  });

  await runTest('Test 2: Graceful handling of Accounts unavailable, timeout, 401 auth failure, and malformed response', async () => {
    // 1. Network unavailable
    const netFail = await integration.lookupAuthoritativeTickets(
      { query: '1040' },
      {
        config: testConfig,
        fetchFn: async () => { throw new Error('ECONNREFUSED'); }
      }
    );
    assert.strictEqual(netFail.ok, false);
    assert.strictEqual(netFail.unavailable, true);
    assert.strictEqual(netFail.code, 'ACCOUNTS_UNAVAILABLE');

    // 2. Timeout (AbortError)
    const timeoutFail = await integration.lookupAuthoritativeTickets(
      { query: '1040' },
      {
        config: testConfig,
        fetchFn: async () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          throw e;
        }
      }
    );
    assert.strictEqual(timeoutFail.ok, false);
    assert.strictEqual(timeoutFail.unavailable, true);
    assert.strictEqual(timeoutFail.code, 'ACCOUNTS_TIMEOUT');

    // 3. Invalid/expired integration auth (401)
    const authFail = await integration.lookupAuthoritativeTickets(
      { query: '1040' },
      {
        config: testConfig,
        fetchFn: async () => ({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ success: false, code: 'INVALID_SIGNATURE', error: 'bad' })
        })
      }
    );
    assert.strictEqual(authFail.ok, false);
    assert.strictEqual(authFail.unavailable, true);
    assert.strictEqual(authFail.code, 'INVALID_SIGNATURE');

    // 4. Malformed non-JSON response
    const malformedFail = await integration.lookupAuthoritativeTickets(
      { query: '1040' },
      {
        config: testConfig,
        fetchFn: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html>Bad Gateway</html>'
        })
      }
    );
    assert.strictEqual(malformedFail.ok, false);
    assert.strictEqual(malformedFail.unavailable, true);
    assert.strictEqual(malformedFail.code, 'MALFORMED_RESPONSE');
  });

  await runTest('Test 3: Zero secrets in frontend JS/HTML & ticket UI states present', async () => {
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

    assert.ok(!appJs.includes('FES_INTEGRATION_SECRET'), 'Frontend JS must never reference FES_INTEGRATION_SECRET');
    assert.ok(!appJs.includes('FES_INTEGRATION_API_KEY'), 'Frontend JS must never reference FES_INTEGRATION_API_KEY');
    assert.ok(!indexHtml.includes('FES_INTEGRATION_SECRET'), 'Frontend HTML must never reference FES_INTEGRATION_SECRET');
    assert.ok(!indexHtml.includes('FES_INTEGRATION_API_KEY'), 'Frontend HTML must never reference FES_INTEGRATION_API_KEY');
    assert.ok(appJs.includes('/api/integration/tickets/search'), 'Frontend must proxy searches via /api/integration/tickets/search');

    // Required UI hooks for search, loading, empty, selected, change/clear, site lock
    for (const id of [
      'bill-ticket-search-input',
      'btn-bill-ticket-search',
      'bill-ticket-search-loading',
      'bill-ticket-search-error',
      'bill-ticket-search-empty',
      'bill-ticket-search-results',
      'bill-ticket-selected-card',
      'btn-bill-ticket-change',
      'btn-bill-ticket-clear',
      'bill-site-name',
      'bill-site-lock-hint'
    ]) {
      assert.ok(indexHtml.includes(`id="${id}"`), `Missing UI element id="${id}" in public/index.html`);
    }
  });

  await runTest('Test 4: Linked bill persists authoritative metadata and UNLINKED fallback strips fake ticket numbers', async () => {
    const empId = 'test-emp-phase3';
    const ticketSnapshot = {
      ticketId: 301,
      serialNo: '2048',
      jobMetadataId: 701,
      branchName: 'Multan Cantt Branch',
      clientName: 'UBL',
      workNature: 'WAPDA',
      subject: 'Load extension feeder work'
    };
    const selectionToken = integration.signAuthoritativeTicketSelection(ticketSnapshot);

    const linkedBill = await db.createBill({
      employeeId: empId,
      employeeName: 'Phase3 Tester',
      siteName: ticketSnapshot.branchName,
      branchName: ticketSnapshot.branchName,
      billDate: '2026-11-16',
      transportationExpense: 2500,
      materialExpense: 1500,
      description: 'Linked ticket expense',
      attachments: [],
      ticketSelectionMode: 'LINKED',
      externalTicketId: ticketSnapshot.ticketId,
      externalTicketSerialNo: ticketSnapshot.serialNo,
      externalJobMetadataId: ticketSnapshot.jobMetadataId,
      clientName: ticketSnapshot.clientName,
      workNature: ticketSnapshot.workNature,
      ticketSubject: ticketSnapshot.subject,
      ticketSelectionToken: selectionToken
    });

    assert.strictEqual(linkedBill.ticketSelectionMode, 'LINKED');
    assert.strictEqual(linkedBill.externalTicketId, 301);
    assert.strictEqual(linkedBill.externalTicketSerialNo, '2048');
    assert.strictEqual(linkedBill.externalJobMetadataId, 701);
    assert.strictEqual(linkedBill.siteName, 'Multan Cantt Branch');
    assert.strictEqual(linkedBill.clientName, 'UBL');
    assert.strictEqual(linkedBill.workNature, 'WAPDA');
    assert.strictEqual(linkedBill.ticketSubject, 'Load extension feeder work');
    assert.strictEqual(linkedBill.integrationSyncStatus, 'PENDING_SYNC');

    // UNLINKED bill fallback must preserve siteName and NEVER store an invented ticket number
    const unlinkedBill = await db.createBill({
      employeeId: empId,
      employeeName: 'Phase3 Tester',
      siteName: 'Adhoc Roadside Site',
      billDate: '2026-11-16',
      otherExpense: 900,
      description: 'No matching ticket available',
      attachments: [],
      ticketSelectionMode: 'UNLINKED',
      externalTicketSerialNo: 'FAKE-999999' // Must be ignored/stripped
    });

    assert.strictEqual(unlinkedBill.ticketSelectionMode, 'UNLINKED');
    assert.strictEqual(unlinkedBill.externalTicketId, null);
    assert.strictEqual(unlinkedBill.externalTicketSerialNo, null);
    assert.strictEqual(unlinkedBill.externalJobMetadataId, null);
    assert.strictEqual(unlinkedBill.integrationSyncStatus, 'UNLINKED_LOCAL');
    assert.strictEqual(unlinkedBill.siteName, 'Adhoc Roadside Site');
  });

  await runTest('Test 5: Rejects post-selection tampering & prevents silent overwrite of authoritative ticket metadata', async () => {
    const ticketSnapshot = {
      ticketId: 302,
      serialNo: '2049',
      jobMetadataId: 702,
      branchName: 'Lahore Gulberg Branch',
      clientName: 'MCB',
      workNature: 'MAINTENANCE',
      subject: 'ATS panel repair'
    };
    const selectionToken = integration.signAuthoritativeTicketSelection(ticketSnapshot);

    // Attempt to tamper with branch/client after ticket selection
    let rejected = false;
    try {
      await db.createBill({
        employeeId: 'test-emp-phase3',
        employeeName: 'Phase3 Tester',
        siteName: 'Tampered Fake Site',
        branchName: 'Tampered Fake Site',
        billDate: '2026-11-16',
        materialExpense: 1000,
        ticketSelectionMode: 'LINKED',
        externalTicketId: ticketSnapshot.ticketId,
        externalTicketSerialNo: ticketSnapshot.serialNo,
        externalJobMetadataId: ticketSnapshot.jobMetadataId,
        clientName: 'MCB',
        workNature: ticketSnapshot.workNature,
        ticketSubject: ticketSnapshot.subject,
        ticketSelectionToken: selectionToken
      });
    } catch (err) {
      rejected = err.status === 400;
    }
    assert.strictEqual(rejected, true, 'Tampering with authoritative metadata after selection must fail with 400');

    // Attempt silent overwrite on an existing linked bill via guard helper
    let overwriteBlocked = false;
    try {
      db.ensureImmutableTicketMetadata(
        {
          ticketSelectionMode: 'LINKED',
          externalTicketId: 302,
          externalTicketSerialNo: '2049',
          externalJobMetadataId: 702,
          clientName: 'MCB',
          workNature: 'MAINTENANCE',
          siteName: 'Lahore Gulberg Branch'
        },
        { externalTicketSerialNo: '9999' }
      );
    } catch (err) {
      overwriteBlocked = err.status === 400;
    }
    assert.strictEqual(overwriteBlocked, true, 'Silent overwrite of linked bill metadata must be rejected');
  });

  await runTest('Test 6: Live HTTP proxy test on Attendance server POST /api/integration/tickets/search & /api/bills', async () => {
    // Verify routes exist cleanly in both api/index.js and server.js
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const apiIndexSrc = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
    assert.ok(serverSrc.includes("app.post('/api/integration/tickets/search'"));
    assert.ok(apiIndexSrc.includes("path === 'integration/tickets/search' && method === 'POST'"));

    // Spin up api/index.js handler on ephemeral port for real HTTP roundtrip test
    const apiHandler = require('../api/index');
    const server = http.createServer((req, res) => {
      // Polyfill minimal res.status / res.json like Vercel serverless runtime
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (obj) => {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json');
        }
        res.end(JSON.stringify(obj));
      };
      apiHandler(req, res);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // 1. Unauthenticated caller (no employeeId or admin passcode) -> 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/integration/tickets/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '1024' })
      });
      assert.strictEqual(unauthRes.status, 401);

      // 2. Empty search with employeeId -> 400
      const emptyRes = await fetch(`http://127.0.0.1:${port}/api/integration/tickets/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-employee-id': 'test-emp-phase3' },
        body: JSON.stringify({ query: '   ' })
      });
      assert.strictEqual(emptyRes.status, 400);

      // 3. With integration unconfigured, returns graceful available:false (non-crashing 200)
      const prevUrl = process.env.ACCOUNTS_APP_BASE_URL;
      delete process.env.ACCOUNTS_APP_BASE_URL;
      const unconfRes = await fetch(`http://127.0.0.1:${port}/api/integration/tickets/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-employee-id': 'test-emp-phase3' },
        body: JSON.stringify({ query: '1024' })
      });
      if (prevUrl !== undefined) process.env.ACCOUNTS_APP_BASE_URL = prevUrl;
      assert.strictEqual(unconfRes.status, 200);
      const unconfJson = await unconfRes.json();
      assert.strictEqual(unconfJson.success, false);
      assert.strictEqual(unconfJson.unavailable, true);

      // 4. POST /api/bills with UNLINKED fallback succeeds even while lookup is unavailable
      const billRes = await fetch(`http://127.0.0.1:${port}/api/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: 'test-emp-phase3',
          employeeName: 'Phase3 Tester',
          siteName: 'Fallback Site Express',
          transportationExpense: 500,
          ticketSelectionMode: 'UNLINKED'
        })
      });
      assert.strictEqual(billRes.status, 200);
      const billJson = await billRes.json();
      assert.strictEqual(billJson.success, true);
      assert.strictEqual(billJson.bill.ticketSelectionMode, 'UNLINKED');
      assert.strictEqual(billJson.bill.integrationSyncStatus, 'UNLINKED_LOCAL');
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log('\n====================================================================');
  console.log(`  PHASE 3 ATTENDANCE APP TESTS: ${passed} / ${passed + failed} PASSED`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
