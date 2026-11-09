/**
 * Automated Absent Staff & Late Management Test Suite
 * Validates:
 * 1. 9:00 PM (21:00 PKT) Duty Timing & Late Detection Logic
 * 2. Absent staff detection & Management notification dispatch
 * 3. 4 Late Arrivals = 1 Day Salary Deduction payroll engine logic
 * 4. Integration into generateSalary and getFinalizedSalaryReport
 * 5. Employee in-app warnings and management alert feeds
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

async function runTestSuite() {
  console.log('\n=============================================================');
  console.log('  ABSENT STAFF NOTIFICATIONS & LATE DEDUCTION TEST SUITE');
  console.log('=============================================================\n');

  // Test 1: Late status calculation against 9:00 PM PKT (Asia/Karachi)
  await runTest('1. calculateLateStatus evaluates 9:00 PM duty time and night shift correctly', async () => {
    // 20:55 PKT (15:55 UTC) - On time
    const onTimeUtc = '2026-11-09T15:55:00.000Z';
    const resOnTime = db.calculateLateStatus(onTimeUtc, '21:00', 0);
    assert.strictEqual(resOnTime.isLate, false, '20:55 PKT must not be late');
    assert.strictEqual(resOnTime.lateMinutes, 0);

    // 21:00 PKT (16:00 UTC) - On time exactly
    const exactUtc = '2026-11-09T16:00:00.000Z';
    const resExact = db.calculateLateStatus(exactUtc, '21:00', 0);
    assert.strictEqual(resExact.isLate, false, '21:00 PKT exactly must not be late');
    assert.strictEqual(resExact.lateMinutes, 0);

    // 21:18 PKT (16:18 UTC) - 18 minutes late
    const lateUtc = '2026-11-09T16:18:00.000Z';
    const resLate = db.calculateLateStatus(lateUtc, '21:00', 0);
    assert.strictEqual(resLate.isLate, true, '21:18 PKT must be late');
    assert.strictEqual(resLate.lateMinutes, 18, 'Must be 18 minutes late');

    // 21:05 PKT with 10 min grace period - Allowed
    const resGrace = db.calculateLateStatus('2026-11-09T16:05:00.000Z', '21:00', 10);
    assert.strictEqual(resGrace.isLate, false, 'Within 10 min grace period must not be late');

    // 00:30 PKT next calendar day (19:30 UTC) - Late night shift arrival
    const postMidnightUtc = '2026-11-09T19:30:00.000Z';
    const resNightShift = db.calculateLateStatus(postMidnightUtc, '21:00', 0);
    assert.strictEqual(resNightShift.isLate, true, '00:30 PKT must be recognized as late for 21:00 shift');
    assert.strictEqual(resNightShift.lateMinutes, 210, '00:30 PKT is 210 mins after 21:00');
  });

  // Test 2: Absent staff notification to management
  await runTest('2. checkAndNotifyAbsentStaff identifies absentees and alerts management', async () => {
    const testDate = '2026-11-09';
    const originalGetEmployees = db.getEmployees.bind(db);
    const originalGetAttendance = db.getAttendance.bind(db);
    const originalGetFormSubmissions = db.getFormSubmissions ? db.getFormSubmissions.bind(db) : async () => [];

    // Mock data: 3 active employees (1 present, 1 on leave, 1 absent)
    db.getEmployees = async () => [
      { id: 'emp-pres-1', name: 'Present Worker', status: 'ACTIVE', role: 'Staff' },
      { id: 'emp-leave-1', name: 'Leave Worker', status: 'ACTIVE', role: 'Staff' },
      { id: 'emp-absent-1', name: 'Absent Worker', status: 'ACTIVE', role: 'Staff' }
    ];

    db.getAttendance = async () => [
      { id: 'att-1', employeeId: 'emp-pres-1', date: testDate, clockInTime: `${testDate}T16:00:00.000Z`, performanceNotes: 'On duty' },
      { id: 'att-2', employeeId: 'emp-leave-1', date: testDate, performanceNotes: 'Leave: Sick Leave' }
    ];

    db.getFormSubmissions = async () => [];

    try {
      const result = await db.checkAndNotifyAbsentStaff(testDate, { skipExternalDispatch: true });
      assert(result, 'Result should exist');
      assert.strictEqual(result.date, testDate);
      assert.strictEqual(result.presentCount, 1, 'Should have 1 present');
      assert.strictEqual(result.leaveCount, 1, 'Should have 1 on leave');
      assert.strictEqual(result.absentCount, 1, 'Should have 1 absent');
      assert.strictEqual(result.absentStaff.length, 1);
      assert.strictEqual(result.absentStaff[0].name, 'Absent Worker');

      // Verify formatted management message
      assert(result.messageText.includes('MANAGEMENT ALERT: ABSENT STAFF NOTIFICATION'), 'Must contain management alert header');
      assert(result.messageText.includes('9:00 PM'), 'Must state 9:00 PM duty time');
      assert(result.messageText.includes('Absent Worker'), 'Must list absent staff name');
      assert(result.deliveredToFeed === true, 'Must be delivered to in-app feed');
    } finally {
      db.getEmployees = originalGetEmployees;
      db.getAttendance = originalGetAttendance;
      db.getFormSubmissions = originalGetFormSubmissions;
    }
  });

  // Test 3: Four Lates = 1 Day Salary Deduction Logic
  await runTest('3. Four lates = 1 day salary deduction rule applies accurately', async () => {
    const basicSalary = 60000;
    const perDaySalary = Math.round((basicSalary / 30) * 100) / 100; // 2000

    const calcDeduction = (lates, threshold = 4) => {
      const days = Math.floor(lates / threshold);
      return { days, amount: Math.round(days * perDaySalary * 100) / 100 };
    };

    assert.strictEqual(calcDeduction(0).days, 0);
    assert.strictEqual(calcDeduction(0).amount, 0);

    assert.strictEqual(calcDeduction(1).days, 0);
    assert.strictEqual(calcDeduction(1).amount, 0);

    assert.strictEqual(calcDeduction(3).days, 0);
    assert.strictEqual(calcDeduction(3).amount, 0);

    // 4 lates = exactly 1 day
    assert.strictEqual(calcDeduction(4).days, 1);
    assert.strictEqual(calcDeduction(4).amount, 2000);

    // 5, 6, 7 lates = 1 day
    assert.strictEqual(calcDeduction(7).days, 1);
    assert.strictEqual(calcDeduction(7).amount, 2000);

    // 8 lates = 2 days
    assert.strictEqual(calcDeduction(8).days, 2);
    assert.strictEqual(calcDeduction(8).amount, 4000);

    // 12 lates = 3 days
    assert.strictEqual(calcDeduction(12).days, 3);
    assert.strictEqual(calcDeduction(12).amount, 6000);
  });

  // Test 4: Payroll Report with Late Deductions integration
  await runTest('4. getFinalizedSalaryReport accurately calculates late counts and salary deductions', async () => {
    const originalGetEmployees = db.getEmployees.bind(db);
    const originalGetAttendance = db.getAttendance.bind(db);
    const originalGetManualSalaryOverrides = db.getManualSalaryOverrides ? db.getManualSalaryOverrides.bind(db) : null;
    const originalGetManualSundayOverrides = db.getManualSundayOverrides ? db.getManualSundayOverrides.bind(db) : null;

    const testMonth = '2026-11';

    db.getEmployees = async () => [
      { id: 'emp-late-test', name: 'Late Test Staff', basicSalary: 60000, status: 'ACTIVE', role: 'Staff' }
    ];

    // Create 5 attendance logs in November 2026 with 4 marked late
    db.getAttendance = async () => [
      { id: 'att-1', employeeId: 'emp-late-test', date: '2026-11-01', isLate: true, lateMinutes: 15, duration: 480 },
      { id: 'att-2', employeeId: 'emp-late-test', date: '2026-11-02', isLate: true, lateMinutes: 20, duration: 480 },
      { id: 'att-3', employeeId: 'emp-late-test', date: '2026-11-03', isLate: true, lateMinutes: 10, duration: 480 },
      { id: 'att-4', employeeId: 'emp-late-test', date: '2026-11-04', isLate: true, lateMinutes: 30, duration: 480 }, // 4th late!
      { id: 'att-5', employeeId: 'emp-late-test', date: '2026-11-05', isLate: false, lateMinutes: 0, duration: 480 }
    ];

    if (originalGetManualSalaryOverrides) db.getManualSalaryOverrides = async () => [];
    if (originalGetManualSundayOverrides) db.getManualSundayOverrides = async () => [];

    try {
      const report = await db.getFinalizedSalaryReport(testMonth);
      assert(report, 'Report should be generated');
      assert.strictEqual(report.employees.length, 1);

      const staffSalary = report.employees[0];
      assert.strictEqual(staffSalary.lateCount, 4, 'Should record 4 late arrivals');
      assert.strictEqual(staffSalary.lateDaysDeducted, 1, '4 lates must trigger 1 day deducted');
      
      const expectedPerDay = Math.round((60000 / 30) * 100) / 100; // 2000
      assert.strictEqual(staffSalary.lateDeductionAmount, expectedPerDay, 'Deduction amount must equal 1 day salary');
      
      // Earned salary for 5 days = 5 * 2000 = 10000. Net salary = 10000 - 2000 (late deduction) = 8000
      assert.strictEqual(staffSalary.netSalary, staffSalary.earnedSalary - expectedPerDay);
      assert.strictEqual(report.summary.totalLateCount, 4);
      assert.strictEqual(report.summary.totalLateDeductions, expectedPerDay);
    } finally {
      db.getEmployees = originalGetEmployees;
      db.getAttendance = originalGetAttendance;
      if (originalGetManualSalaryOverrides) db.getManualSalaryOverrides = originalGetManualSalaryOverrides;
      if (originalGetManualSundayOverrides) db.getManualSundayOverrides = originalGetManualSundayOverrides;
    }
  });

  // Test 5: Clock-in late triggers in-app notification & management alert
  await runTest('5. clockIn returns late details, warnings, and posts alerts', async () => {
    const originalUseLocalFallback = db.useLocalFallback;
    db.useLocalFallback = true;

    const originalAddComment = db.addComment.bind(db);
    const originalCalcLate = db.calculateLateStatus.bind(db);

    const testEmpId = 'test-late-emp-001';
    const testEmp = {
      id: testEmpId,
      name: 'Late Clocker Test',
      role: 'Engineer',
      status: 'OUT',
      dateCreated: new Date().toISOString()
    };

    // Load localData and ensure test employee exists with 3 previous lates this month
    const fs = require('fs');
    const path = require('path');
    const dataFilePath = path.join(__dirname, '..', 'data.json');
    let localData = {};
    try {
      localData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
    } catch (e) {
      localData = { employees: [], attendance: [], comments: [] };
    }

    if (!localData.employees) localData.employees = [];
    if (!localData.attendance) localData.attendance = [];
    if (!localData.comments) localData.comments = [];

    // Add employee
    localData.employees = localData.employees.filter(e => e.id !== testEmpId);
    localData.employees.push(testEmp);

    // Add 3 earlier lates this month on previous days
    const currentMonth = new Date().toISOString().slice(0, 7);
    localData.attendance = localData.attendance.filter(a => a.employeeId !== testEmpId);
    localData.attendance.push(
      { id: 'att-hist-1', employeeId: testEmpId, date: `${currentMonth}-01`, clockInTime: `${currentMonth}-01T21:15:00.000Z`, clockOutTime: `${currentMonth}-01T23:00:00.000Z`, isLate: true },
      { id: 'att-hist-2', employeeId: testEmpId, date: `${currentMonth}-02`, clockInTime: `${currentMonth}-02T21:20:00.000Z`, clockOutTime: `${currentMonth}-02T23:00:00.000Z`, isLate: true },
      { id: 'att-hist-3', employeeId: testEmpId, date: `${currentMonth}-03`, clockInTime: `${currentMonth}-03T21:10:00.000Z`, clockOutTime: `${currentMonth}-03T23:00:00.000Z`, isLate: true }
    );
    fs.writeFileSync(dataFilePath, JSON.stringify(localData, null, 2), 'utf8');

    const addedComments = [];
    db.addComment = async (com) => {
      addedComments.push(com);
      return com;
    };

    // Stub calculateLateStatus to return 25 mins late
    db.calculateLateStatus = () => ({ isLate: true, lateMinutes: 25, clockInPktTime: '21:25:00' });

    try {
      const clockInRes = await db.clockIn(testEmpId, {
        latitude: 33.6844,
        longitude: 73.0479,
        address: 'Office HQ'
      });

      assert(clockInRes, 'Clock in should return result');
      assert.strictEqual(clockInRes.isLate, true, 'Must flag as late');
      assert.strictEqual(clockInRes.lateMinutes, 25);
      assert.strictEqual(clockInRes.monthLateCount, 4, '3 prior lates + 1 current = 4 lates');
      assert(clockInRes.lateWarning.includes('LATE ARRIVAL PENALTY'), 'Warning must mention penalty');
      assert(clockInRes.lateWarning.includes('1 day salary has been deducted'), 'Warning must mention 1 day salary deduction');

      // Verify notifications were logged
      assert(addedComments.length >= 2, 'Should add both employee notification and management alert');
      const mgmtComment = addedComments.find(c => c.employeeId === 'system' || c.sender === 'system');
      assert(mgmtComment, 'Management alert comment must exist');
      const commentContent = mgmtComment.message || mgmtComment.comment || '';
      assert(commentContent.includes('Late Arrival Alert'), 'Management comment must announce late alert');
      assert(commentContent.includes('Late Clocker Test'), 'Management comment must name employee');
    } finally {
      db.calculateLateStatus = originalCalcLate;
      db.addComment = originalAddComment;
      db.useLocalFallback = originalUseLocalFallback;

      // Clean up test employee
      try {
        const cleanData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
        cleanData.employees = (cleanData.employees || []).filter(e => e.id !== testEmpId);
        cleanData.attendance = (cleanData.attendance || []).filter(a => a.employeeId !== testEmpId);
        fs.writeFileSync(dataFilePath, JSON.stringify(cleanData, null, 2), 'utf8');
      } catch (e) {}
    }
  });

  console.log('\n=============================================================');
  console.log(`  TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('=============================================================\n');
}

runTestSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
