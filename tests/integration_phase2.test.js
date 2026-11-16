/**
 * Phase 2 Automated Test Suite — Attendance App Integration Security & Schema
 * Tests HMAC-SHA256 signing/verification, timestamp & replay protection,
 * idempotency conflict detection, zero-duplication attachment metadata extraction,
 * approved-expense business rules, and additive migration files.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const integration = require('../integration-client');

const TEST_API_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const TEST_SECRET = 'f9e8d7c6b5a4938271605f4e3d2c1b0af9e8d7c6b5a4938271605f4e3d2c1b0a';

let passed = 0;
let total = 0;

async function runTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('\n====================================================================');
  console.log('  FES ATTENDANCE APP — PHASE 2 INTEGRATION SECURITY TEST SUITE');
  console.log('====================================================================\n');

  // Test 1: Path & Query Canonicalization
  await runTest('Test 1: normalizeIntegrationPath normalizes URLs, trailing slashes, and query parameter order', () => {
    assert.strictEqual(
      integration.normalizeIntegrationPath('https://accounts.example.com/api/integration/tickets/lookup/'),
      '/api/integration/tickets/lookup'
    );
    assert.strictEqual(
      integration.normalizeIntegrationPath('api/integration/attachments?index=0&billId=bill_123'),
      '/api/integration/attachments?billId=bill_123&index=0'
    );
    assert.strictEqual(
      integration.normalizeIntegrationPath('/api/integration/attachments?billId=bill_123&index=0'),
      '/api/integration/attachments?billId=bill_123&index=0'
    );
  });

  // Test 2: Valid HMAC-SHA256 Signing & Verification
  await runTest('Test 2: createSignedHeaders and verifySignedRequest succeed for valid signed request', () => {
    integration.clearIdempotencyStore();
    const now = 1794750000000;
    const payload = {
      siteName: 'DHA Phase 8',
      workNature: 'ELECTRICAL',
      clientName: 'UBL Bank'
    };

    const headers = integration.createSignedHeaders({
      method: 'POST',
      path: '/api/integration/tickets/lookup',
      body: payload,
      idempotencyKey: 'lookup_test_001',
      timestamp: now,
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET
    });

    assert.strictEqual(headers['X-FES-Api-Key'], TEST_API_KEY);
    assert.strictEqual(headers['X-FES-Timestamp'], String(now));
    assert.strictEqual(headers['X-FES-Idempotency-Key'], 'lookup_test_001');
    assert.strictEqual(headers['X-FES-Signature'].length, 64);

    const verification = integration.verifySignedRequest({
      method: 'POST',
      path: 'https://accounts-app.vercel.app/api/integration/tickets/lookup/',
      headers,
      rawBody: JSON.stringify(payload),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now: now + 1500
    });

    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.status, 200);
    assert.strictEqual(verification.isDuplicateReplay, false);
    assert.strictEqual(verification.idempotencyKey, 'lookup_test_001');
  });

  // Test 3: Tampered Body, Wrong API Key & Missing Headers Rejection
  await runTest('Test 3: verifySignedRequest rejects tampered body, wrong API key, and missing headers', () => {
    integration.clearIdempotencyStore();
    const now = 1794750000000;
    const payload = { billId: 'bill_100', totalClaimedAmount: 4500 };

    const headers = integration.createSignedHeaders({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      body: payload,
      idempotencyKey: 'sync_test_tamper',
      timestamp: now,
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET
    });

    // Tampered amount in body
    const tamperedCheck = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers,
      rawBody: JSON.stringify({ billId: 'bill_100', totalClaimedAmount: 99999 }),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now
    });
    assert.strictEqual(tamperedCheck.valid, false);
    assert.strictEqual(tamperedCheck.status, 401);
    assert.strictEqual(tamperedCheck.code, 'INVALID_SIGNATURE');

    // Wrong API Key
    const badKeyCheck = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: { ...headers, 'X-FES-Api-Key': 'wrong_key' },
      rawBody: JSON.stringify(payload),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now
    });
    assert.strictEqual(badKeyCheck.valid, false);
    assert.strictEqual(badKeyCheck.status, 401);
    assert.strictEqual(badKeyCheck.code, 'INVALID_API_KEY');

    // Missing headers
    const missingCheck = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: {},
      rawBody: JSON.stringify(payload),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now
    });
    assert.strictEqual(missingCheck.valid, false);
    assert.strictEqual(missingCheck.status, 401);
    assert.strictEqual(missingCheck.code, 'MISSING_AUTH_HEADERS');
  });

  // Test 4: Timestamp Validation & ±5 Minute Replay Protection Window
  await runTest('Test 4: verifySignedRequest rejects expired (> 5m old) and future-skewed (> 5m ahead) timestamps', () => {
    integration.clearIdempotencyStore();
    const now = 1794750000000;
    const sixMinutesAgo = now - 6 * 60 * 1000;
    const sixMinutesAhead = now + 6 * 60 * 1000;
    const body = { ping: true };

    const oldHeaders = integration.createSignedHeaders({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      body,
      idempotencyKey: 'ts_old',
      timestamp: sixMinutesAgo,
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET
    });

    const oldRes = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: oldHeaders,
      rawBody: JSON.stringify(body),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now
    });
    assert.strictEqual(oldRes.valid, false);
    assert.strictEqual(oldRes.code, 'TIMESTAMP_EXPIRED');

    const futureHeaders = integration.createSignedHeaders({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      body,
      idempotencyKey: 'ts_future',
      timestamp: sixMinutesAhead,
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET
    });

    const futureRes = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: futureHeaders,
      rawBody: JSON.stringify(body),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now
    });
    assert.strictEqual(futureRes.valid, false);
    assert.strictEqual(futureRes.code, 'TIMESTAMP_EXPIRED');
  });

  // Test 5: Idempotency Support & Replay Conflict Protection
  await runTest('Test 5: Idempotency store detects safe duplicate retries and blocks conflicting key reuse', () => {
    integration.clearIdempotencyStore();
    const now = 1794750000000;
    const payload1 = { externalBillId: 'bill_555', amount: 3200 };
    const payload2 = { externalBillId: 'bill_555', amount: 8500 };

    const headers1 = integration.createSignedHeaders({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      body: payload1,
      idempotencyKey: 'idem_bill_555_v1',
      timestamp: now,
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET
    });

    // First delivery
    const first = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: headers1,
      rawBody: JSON.stringify(payload1),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now
    });
    assert.strictEqual(first.valid, true);
    assert.strictEqual(first.isDuplicateReplay, false);
    integration.storeIdempotencyResult('idem_bill_555_v1', { expenseId: 77 });

    // Second identical delivery (network retry)
    const retry = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: headers1,
      rawBody: JSON.stringify(payload1),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now: now + 5000
    });
    assert.strictEqual(retry.valid, true);
    assert.strictEqual(retry.isDuplicateReplay, true);
    assert.deepStrictEqual(retry.cachedResult, { expenseId: 77 });

    // Conflicting reuse of same idempotencyKey with different body
    const headersConflict = integration.createSignedHeaders({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      body: payload2,
      idempotencyKey: 'idem_bill_555_v1',
      timestamp: now + 6000,
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET
    });
    const conflict = integration.verifySignedRequest({
      method: 'POST',
      path: '/api/integration/expenses/sync',
      headers: headersConflict,
      rawBody: JSON.stringify(payload2),
      apiKey: TEST_API_KEY,
      secret: TEST_SECRET,
      now: now + 6000
    });
    assert.strictEqual(conflict.valid, false);
    assert.strictEqual(conflict.status, 409);
    assert.strictEqual(conflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
  });

  // Test 6: Zero-Duplication Attachment Metadata & Unsafe MIME Filtering
  await runTest('Test 6: extractAttachmentMetadata strips Base64 dataUrl blobs and blocks unsafe MIME types', () => {
    const sampleAttachments = [
      {
        name: 'fuel_receipt.jpg',
        type: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(4000)
      },
      {
        name: 'invoice.pdf',
        type: 'application/pdf',
        size: 128000,
        dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK'
      },
      {
        name: 'malicious.svg',
        type: 'image/svg+xml',
        dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+'
      },
      {
        name: 'xss.html',
        type: 'text/html',
        dataUrl: 'data:text/html;base64,PGh0bWw+'
      }
    ];

    const meta = integration.extractAttachmentMetadata(sampleAttachments);
    assert.strictEqual(meta.length, 2, 'Only JPEG and PDF should pass allowlist; SVG and HTML must be dropped');
    assert.strictEqual(meta[0].name, 'fuel_receipt.jpg');
    assert.strictEqual(meta[0].type, 'image/jpeg');
    assert.strictEqual(meta[0].index, 0);
    assert.strictEqual(meta[0].dataUrl, undefined, 'Base64 dataUrl must be stripped');
    assert.ok(meta[0].size > 0);

    assert.strictEqual(meta[1].name, 'invoice.pdf');
    assert.strictEqual(meta[1].type, 'application/pdf');
    assert.strictEqual(meta[1].isPdf, true);
    assert.strictEqual(meta[1].dataUrl, undefined, 'Base64 dataUrl must be stripped');
  });

  // Test 7: Business Rule — Claimed Expenses Are RECEIVED/PENDING APPROVAL & 0 Approved Total Until Approved
  await runTest('Test 7: resolveSyncedExpenseAmounts & buildExpenseSyncPayload enforce 0 approved amount until APPROVED', () => {
    const submittedBill = {
      id: 'bill_9001',
      billNumber: 'BILL-009001',
      employeeId: 'emp_1',
      employeeName: 'Muhammad Ibrahim',
      siteName: 'DHA Phase 8 Branch',
      clientName: 'UBL Bank',
      workNature: 'ELECTRICAL',
      externalTicketId: 42,
      externalTicketSerialNo: '1042',
      externalJobMetadataId: 19,
      transportationExpense: 1500,
      materialExpense: 3500,
      totalClaimedAmount: 5000,
      status: 'SUBMITTED',
      attachments: [
        { name: 'slip.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }
      ]
    };

    const syncPayloadSubmitted = integration.buildExpenseSyncPayload(submittedBill);
    assert.strictEqual(syncPayloadSubmitted.approvalStatus, 'RECEIVED');
    assert.strictEqual(syncPayloadSubmitted.totalClaimedAmount, 5000);
    assert.strictEqual(syncPayloadSubmitted.effectiveApprovedAmount, 0, 'SUBMITTED/RECEIVED bill must contribute 0 to approved total');
    assert.strictEqual(syncPayloadSubmitted.primaryAttachmentProxyUrl, '/api/integration/attachments?billId=bill_9001&index=0');
    assert.ok(!JSON.stringify(syncPayloadSubmitted).includes('iVBORw0KGgo='), 'Sync payload must not contain raw Base64 data');

    // Verified but not yet approved by Senior Admin
    const verifiedBill = {
      ...submittedBill,
      status: 'VERIFIED',
      totalVerifiedAmount: 4800,
      totalApprovedAmount: null
    };
    const syncPayloadVerified = integration.buildExpenseSyncPayload(verifiedBill);
    assert.strictEqual(syncPayloadVerified.approvalStatus, 'VERIFIED');
    assert.strictEqual(syncPayloadVerified.totalClaimedAmount, 5000);
    assert.strictEqual(syncPayloadVerified.totalVerifiedAmount, 4800);
    assert.strictEqual(syncPayloadVerified.effectiveApprovedAmount, 0, 'VERIFIED bill (pending Senior Admin approval) must still contribute 0 to approved total');

    // Approved by Senior Admin
    const approvedBill = {
      ...verifiedBill,
      status: 'APPROVED',
      totalApprovedAmount: 4500
    };
    const syncPayloadApproved = integration.buildExpenseSyncPayload(approvedBill);
    assert.strictEqual(syncPayloadApproved.approvalStatus, 'APPROVED');
    assert.strictEqual(syncPayloadApproved.effectiveApprovedAmount, 4500, 'APPROVED bill must contribute totalApprovedAmount (4500) to approved total');
  });

  // Test 8: Verify Prepared SQL Migration & Schema Files
  await runTest('Test 8: Verify additive SQL migration and schema files exist and contain no destructive DROP TABLE statements', () => {
    const migPath = path.join(__dirname, '..', 'migrations', 'phase2_integration_schema.sql');
    const supaPath = path.join(__dirname, '..', 'supabase-schema.sql');
    assert.ok(fs.existsSync(migPath), 'migrations/phase2_integration_schema.sql must exist');

    const migSql = fs.readFileSync(migPath, 'utf8');
    const supaSql = fs.readFileSync(supaPath, 'utf8');

    const requiredCols = [
      'externalTicketId',
      'externalTicketSerialNo',
      'externalJobMetadataId',
      'clientName',
      'workNature',
      'ticketSubject',
      'ticketSelectionMode',
      'externalExpenseId',
      'integrationSyncStatus',
      'integrationSyncedAt',
      'integrationSyncError'
    ];

    for (const col of requiredCols) {
      assert.ok(migSql.includes(`"${col}"`), `Migration SQL must include column "${col}"`);
      assert.ok(supaSql.includes(`"${col}"`), `supabase-schema.sql must include column "${col}"`);
    }

    assert.ok(!/DROP\s+TABLE/i.test(migSql), 'Migration SQL must not contain DROP TABLE');
  });

  console.log('\n====================================================================');
  console.log(`  PHASE 2 ATTENDANCE APP TESTS: ${passed} / ${total} PASSED`);
  console.log('====================================================================\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
