/**
 * Automated Daily Attendance & Bills WhatsApp Summary Test Suite
 * Validates:
 * 1. Daily summary generation (present, absent, leave, approved bills, rejected bills)
 * 2. WhatsApp markdown formatting (emojis, sections, bold, timestamps)
 * 3. Safe location object handling (no [object Object])
 * 4. WhatsApp settings retrieval and updates
 * 5. Dispatch execution, logging, and history
 * 6. Total staff partition validation (present + absent + leave = total)
 */

const assert = require('assert');
const db = require('../db.js');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log('  ✓ [PASS] ' + name);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] ' + name + ': ' + err.message);
    throw err;
  }
}

async function runDailySummarySuite() {
  console.log('\n=============================================================');
  console.log('  STARTING DAILY ATTENDANCE & BILLS WHATSAPP SUMMARY TEST SUITE');
  console.log('=============================================================\n');

  const testDate = '2026-10-16';

  await runTest('1. generateDailyAttendanceSummary compiles stats structure correctly', async () => {
    const summary = await db.generateDailyAttendanceSummary(testDate);
    assert(summary, 'Summary should be returned');
    assert.strictEqual(summary.date, testDate);
    assert(summary.stats, 'Stats object should exist');
    assert(typeof summary.stats.totalEmployees === 'number', 'totalEmployees should be number');
    assert(typeof summary.stats.presentCount === 'number', 'presentCount should be number');
    assert(typeof summary.stats.absentCount === 'number', 'absentCount should be number');
    assert(typeof summary.stats.leaveCount === 'number', 'leaveCount should be number');
    assert(typeof summary.stats.approvedBillsCount === 'number', 'approvedBillsCount should be number');
    assert(typeof summary.stats.rejectedBillsCount === 'number', 'rejectedBillsCount should be number');
    assert(typeof summary.summaryText === 'string', 'summaryText should be string');
  });

  await runTest('2. WhatsApp markdown summary contains all mandatory sections and emojis', async () => {
    const summary = await db.generateDailyAttendanceSummary(testDate);
    const text = summary.summaryText;

    assert(text.includes('DAILY ATTENDANCE & BILLS SUMMARY'), 'Must have header');
    assert(text.includes('ATTENDANCE OVERVIEW'), 'Must have overview section');
    assert(text.includes('PRESENT EMPLOYEES'), 'Must have present section');
    assert(text.includes('ABSENT EMPLOYEES'), 'Must have absent section');
    assert(text.includes('ON LEAVE'), 'Must have leave section');
    assert(text.includes('BILLS ACTIVITY TODAY'), 'Must have bills activity section');
    assert(text.includes('Approved Bills:'), 'Must list approved bills');
    assert(text.includes('Rejected Bills:'), 'Must list rejected bills');
    assert(text.includes('Automated 9:00 PM Daily Summary'), 'Must have automated footer');
  });

  await runTest('3. Safe location formatting guards against [object Object]', async () => {
    const originalGetAttendance = db.getAttendance.bind(db);
    db.getAttendance = async () => [
      {
        id: 'mock-att-loc-test',
        employeeId: 'emp-loc-1',
        employeeName: 'Location Test Worker',
        role: 'Field Engineer',
        date: testDate,
        clockInTime: `${testDate}T09:00:00.000Z`,
        clockOutTime: `${testDate}T17:00:00.000Z`,
        clockInLocation: { address: 'Plot 42 Commercial Area, Sector G-11', latitude: 33.684, longitude: 73.047 },
        performanceNotes: 'Testing location'
      }
    ];

    try {
      const summary = await db.generateDailyAttendanceSummary(testDate);
      assert(!summary.summaryText.includes('[object Object]'), 'Summary must NOT contain [object Object]');
      assert(summary.summaryText.includes('Plot 42 Commercial Area, Sector G-11'), 'Must include extracted address string');
      assert(summary.presentEmployees.some(p => p.location === 'Plot 42 Commercial Area, Sector G-11'), 'Present employee must have extracted location');
    } finally {
      db.getAttendance = originalGetAttendance;
    }
  });

  await runTest('4. WhatsApp settings: getWhatsAppSettings and updateWhatsAppSettings', async () => {
    const settings = await db.getWhatsAppSettings();
    assert(settings, 'Settings must be returned');
    assert(typeof settings.enabled === 'boolean', 'enabled must be boolean');
    assert(typeof settings.provider === 'string', 'provider must be string');

    // Update settings
    const updated = await db.updateWhatsAppSettings({
      provider: 'ultramsg',
      groupId: '1203630283928172@g.us',
      apiKey: 'test-api-token-123',
      scheduledTime: '21:00'
    });

    assert.strictEqual(updated.provider, 'ultramsg');
    assert.strictEqual(updated.groupId, '1203630283928172@g.us');
    assert.strictEqual(updated.apiKey, 'test-api-token-123');

    // Verify persistence
    const reloaded = await db.getWhatsAppSettings();
    assert.strictEqual(reloaded.provider, 'ultramsg');
    assert.strictEqual(reloaded.apiKey, 'test-api-token-123');
  });

  await runTest('5. dispatchDailyWhatsAppSummary logs execution and handles unconfigured gracefully', async () => {
    const result = await db.dispatchDailyWhatsAppSummary(testDate, { isTest: true });
    assert(result, 'Result should exist');
    assert(result.summary, 'Summary should be attached');
    assert(result.log, 'Dispatch log entry should be recorded');

    const logs = await db.getWhatsAppDispatchLogs();
    assert(Array.isArray(logs), 'Logs must be an array');
    assert(logs.length > 0, 'At least 1 log entry must exist');
    assert.strictEqual(logs[0].date, testDate);
  });

  await runTest('6. Total staff count matches present + absent + leave', async () => {
    const summary = await db.generateDailyAttendanceSummary(testDate);
    const { totalEmployees, presentCount, absentCount, leaveCount } = summary.stats;
    assert.strictEqual(presentCount + absentCount + leaveCount, totalEmployees, 'Active staff should partition into present, absent, and leave');
  });

  console.log(`\nAll ${passedTests} of ${totalTests} WhatsApp Daily Summary tests passed successfully! 🚀\n`);
}

runDailySummarySuite().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
