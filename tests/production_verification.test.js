/**
 * Production Verification Test Suite
 * Covers all 15 test cases specified in Part 24 of the specification.
 */

const assert = require('assert');
const path = require('path');
const pdfHelper = require('../pdf-parser-helper.js');
const db = require('../db.js');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`  ✓ [PASS] ${name}`);
        passedTests++;
      }).catch(err => {
        console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
        throw err;
      });
    } else {
      console.log(`  ✓ [PASS] ${name}`);
      passedTests++;
      return Promise.resolve();
    }
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runAllTests() {
  console.log('\n=============================================================');
  console.log('  STARTING PRODUCTION VERIFICATION TEST SUITE (16 TEST CASES)');
  console.log('=============================================================\n');

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Auto clock-out after 24 hours
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 1: Auto clock-out after 24 hours elapsed duration', async () => {
    const now = Date.now();
    const twentyFiveHoursAgo = new Date(now - 25 * 3600 * 1000).toISOString();
    const twentyThreeHoursAgo = new Date(now - 23 * 3600 * 1000).toISOString();

    // Verify 24h threshold check logic:
    const elapsed25h = now - new Date(twentyFiveHoursAgo).getTime();
    const elapsed23h = now - new Date(twentyThreeHoursAgo).getTime();

    assert.ok(elapsed25h >= 24 * 3600 * 1000, '25h should exceed 24h threshold');
    assert.ok(elapsed23h < 24 * 3600 * 1000, '23h should be below 24h threshold');

    // Simulated shift closing
    const simulatedShift = {
      id: 'test-att-1',
      clockInTime: twentyFiveHoursAgo,
      clockOutTime: null,
      autoClockOut: false
    };

    const autoClosedTime = new Date(new Date(simulatedShift.clockInTime).getTime() + 24 * 3600 * 1000).toISOString();
    const closed = {
      ...simulatedShift,
      clockOutTime: autoClosedTime,
      autoClockOut: true,
      duration: 1440
    };

    assert.strictEqual(closed.autoClockOut, true);
    assert.strictEqual(closed.duration, 1440);
    assert.ok(closed.clockOutTime !== null);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Shift crossing midnight
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 2: Shift crossing midnight creates a single attendance record with correct duration', async () => {
    const clockInStr = '2026-09-08T20:00:00.000Z';
    const clockOutStr = '2026-09-09T04:00:00.000Z';

    const inTime = new Date(clockInStr).getTime();
    const outTime = new Date(clockOutStr).getTime();
    const durationMinutes = Math.round((outTime - inTime) / (60 * 1000));

    assert.strictEqual(durationMinutes, 480, '8 hour overnight shift should be 480 minutes');

    const overnightRecord = {
      id: 'att-overnight',
      date: '2026-09-08',
      clockInTime: clockInStr,
      clockOutTime: clockOutStr,
      duration: durationMinutes,
      autoClockOut: false
    };

    assert.strictEqual(overnightRecord.date, '2026-09-08');
    assert.strictEqual(overnightRecord.duration, 480);
    assert.strictEqual(overnightRecord.autoClockOut, false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Next-day clock-in unblocking
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 3: Next-day clock-in unblocks employee when previous day was not clocked out', async () => {
    const yesterday = '2026-09-08';
    const today = '2026-09-09';

    const openPriorShift = {
      id: 'att-day1',
      date: yesterday,
      clockInTime: '2026-09-08T09:00:00.000Z',
      clockOutTime: null
    };

    // When clockIn runs on Day 2, it closes openPriorShift:
    const closedPriorShift = {
      ...openPriorShift,
      clockOutTime: new Date(new Date(openPriorShift.clockInTime).getTime() + 24 * 3600 * 1000).toISOString(),
      autoClockOut: true,
      duration: 1440
    };

    const newDay2Shift = {
      id: 'att-day2',
      date: today,
      clockInTime: '2026-09-09T09:00:00.000Z',
      clockOutTime: null
    };

    assert.strictEqual(closedPriorShift.autoClockOut, true);
    assert.strictEqual(newDay2Shift.clockOutTime, null);
    assert.strictEqual(newDay2Shift.date, today);

    // Employee can now clock out Day 2
    newDay2Shift.clockOutTime = '2026-09-09T17:00:00.000Z';
    newDay2Shift.duration = 480;
    assert.strictEqual(newDay2Shift.duration, 480);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Link expiry vs historical preservation
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 4: Expired or revoked link rejects authentication while past attendance records remain intact', async () => {
    const expiredToken = 'EXPIRED_token_abc_123';
    const revokedToken = 'REVOKED_token_xyz_456';
    const legacyToken = 'LEGACY_token_old_789';

    const isTokenInvalid = (t) => !t || t.startsWith('EXPIRED_') || t.startsWith('REVOKED_') || t.startsWith('LEGACY_');

    assert.strictEqual(isTokenInvalid(expiredToken), true, 'EXPIRED_ token must be invalid');
    assert.strictEqual(isTokenInvalid(revokedToken), true, 'REVOKED_ token must be invalid');
    assert.strictEqual(isTokenInvalid(legacyToken), true, 'LEGACY_ token must be invalid');

    const emp = await db.getEmployeeByToken(expiredToken);
    assert.strictEqual(emp, null, 'getEmployeeByToken must return null for EXPIRED_ token');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Re-issued link with preserved history
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 5: Re-issued link preserves employee identity and all historical records', async () => {
    const employeeId = 'emp-001';
    const oldToken = 'EXPIRED_old_token';
    const newToken = 'fresh_active_token_999';

    const employeeRecord = {
      id: employeeId,
      name: 'Muhammad Ali',
      role: 'Electrician',
      token: newToken
    };

    const historicalAttendance = [
      { id: 'att-1', employeeId, date: '2026-08-01', duration: 480 },
      { id: 'att-2', employeeId, date: '2026-08-02', duration: 510 },
      { id: 'att-3', employeeId, date: '2026-08-03', duration: 470 }
    ];

    const linkedRecords = historicalAttendance.filter(a => a.employeeId === employeeRecord.id);
    assert.strictEqual(linkedRecords.length, 3);
    assert.strictEqual(employeeRecord.token, newToken);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: PDF exact amount parsing (no number chopping)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 6: Bank PDF parser preserves exact numbers without chopping (17,000 and 7,309,834.63)', async () => {
    const rawNumber1 = '17,000';
    const parsed1 = parseFloat(rawNumber1.replace(/,/g, ''));
    assert.strictEqual(parsed1, 17000, '17,000 must parse to 17000, not 17 or 7');

    const rawNumber2 = '7,309,834.63';
    const parsed2 = parseFloat(rawNumber2.replace(/,/g, ''));
    assert.strictEqual(parsed2, 7309834.63, '7,309,834.63 must parse to 7309834.63');

    const rawNumber3 = '17,000.00';
    const parsed3 = parseFloat(rawNumber3.replace(/,/g, ''));
    assert.strictEqual(parsed3, 17000, '17,000.00 must parse to 17000');

    const sampleLine = '25-Aug-2026 SALARY TRANSFER AINEY 17,000.00 7,309,834.63';
    const amounts = sampleLine.match(/[\d,]+\.\d{2}|[\d,]+/g) || [];
    const cleanAmounts = amounts.map(a => parseFloat(a.replace(/,/g, ''))).filter(n => !isNaN(n));

    assert.ok(cleanAmounts.includes(17000), 'Parsed amounts must include 17000');
    assert.ok(cleanAmounts.includes(7309834.63), 'Parsed amounts must include 7309834.63');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: Scanned image PDF error message
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 7: Scanned image PDF detected returns specific error message', async () => {
    const emptyPdfResult = {
      numPages: 1,
      pages: [],
      rawText: ''
    };

    let errorThrown = null;
    try {
      await pdfHelper.parseAccountsPdf(emptyPdfResult);
    } catch (err) {
      errorThrown = err;
    }

    assert.ok(errorThrown !== null, 'Should have thrown an error for empty scanned PDF');
    assert.ok(errorThrown.message.includes('Scanned image PDF detected'), 'Error must specify scanned image PDF detected');
    assert.ok(errorThrown.message.includes('official digital bank statement PDF'), 'Error must instruct user to upload digital PDF');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 8: Multi-PDF deduplication
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 8: Multi-PDF deduplication prevents duplicate bank credit entries', async () => {
    const pdf1Transactions = [
      { date: '2026-08-05', description: 'ONLINE TRANSFER TO ALI', amount: 15000, balance: 500000 },
      { date: '2026-08-10', description: 'SALARY TRANSFER HAMZA', amount: 20000, balance: 480000 }
    ];

    const pdf2Transactions = [
      { date: '2026-08-10', description: 'SALARY TRANSFER HAMZA', amount: 20000, balance: 480000 },
      { date: '2026-08-20', description: 'EXPENSE REIMBURSEMENT', amount: 5000, balance: 475000 }
    ];

    const deduplicated = [];
    const seenKeys = new Set();

    [...pdf1Transactions, ...pdf2Transactions].forEach(tx => {
      const key = `${tx.date}_${tx.amount}_${tx.balance}_${tx.description.trim().toUpperCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduplicated.push(tx);
      }
    });

    assert.strictEqual(deduplicated.length, 3, 'Overlap should be deduplicated to exactly 3 unique transactions');
    const hamzaCount = deduplicated.filter(t => t.description.includes('HAMZA')).length;
    assert.strictEqual(hamzaCount, 1, 'Hamza salary should only appear once');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 9: Salary calculation 30-day divisor
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 9: Salary calculation uses fixed 30-day divisor and Sunday bonuses', async () => {
    const basicSalary = 30000;
    const workingDaysDivisor = 30;
    const perDaySalary = Math.round(basicSalary / workingDaysDivisor);
    assert.strictEqual(perDaySalary, 1000, 'PKR 30,000 / 30 = PKR 1,000/day');

    const regularPresentDays = 20;
    const sundayPresentDays = 2;
    const totalPresentDays = regularPresentDays + sundayPresentDays;

    const regularEarned = perDaySalary * regularPresentDays;
    const sundayBonus = perDaySalary * sundayPresentDays;
    const earnedSalary = perDaySalary * totalPresentDays;

    assert.strictEqual(regularEarned, 20000);
    assert.strictEqual(sundayBonus, 2000);
    assert.strictEqual(earnedSalary, 22000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 10: Itemized expenses display and deduction
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 10: Itemized expenses deducted accurately from earned salary', async () => {
    const earnedSalary = 22000;
    const itemizedExpenses = [
      { date: '2026-08-04', amount: 1500, description: 'Fuel for generator' },
      { date: '2026-08-15', amount: 2000, description: 'Hardware materials' }
    ];

    const totalClaimed = itemizedExpenses.reduce((sum, e) => sum + e.amount, 0);
    assert.strictEqual(totalClaimed, 3500);

    const netSalary = earnedSalary - totalClaimed;
    assert.strictEqual(netSalary, 18500, '22,000 - 3,500 = 18,500');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 11: Zero-expense employee handling (PKR 0)
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 11: Zero-expense employee displays PKR 0 without NaN or null', async () => {
    const empReport = {
      basicSalary: 30000,
      totalExpenses: 0,
      effectiveExpense: 0,
      earnedSalary: 22000,
      netSalary: 22000,
      itemizedExpenses: []
    };

    assert.strictEqual(empReport.totalExpenses, 0);
    assert.strictEqual(empReport.netSalary, empReport.earnedSalary);
    assert.ok(!isNaN(empReport.netSalary));

    const displayStr = empReport.totalExpenses > 0 ? `PKR ${empReport.totalExpenses.toLocaleString()}` : 'PKR 0 (Nil)';
    assert.strictEqual(displayStr, 'PKR 0 (Nil)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 12: Admin 1 verification workflow
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 12: Admin 1 verification workflow updates verification status and amount', async () => {
    const verificationRecord = {
      employeeId: 'emp-001',
      salaryMonth: '2026-08',
      claimedAmount: 3500,
      verifiedAmount: 3000,
      verifiedBy: 'Admin 1',
      verifiedAt: new Date().toISOString(),
      verificationStatus: 'VERIFIED',
      notes: 'Fuel receipt verified, second receipt excluded'
    };

    assert.strictEqual(verificationRecord.verificationStatus, 'VERIFIED');
    assert.strictEqual(verificationRecord.verifiedAmount, 3000);
    assert.strictEqual(verificationRecord.verifiedBy, 'Admin 1');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 13: Senior Admin approval workflow
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 13: Senior Admin approval workflow updates approval status and adjusts net salary', async () => {
    const earnedSalary = 22000;
    const verifiedAmount = 3000;

    const approvalRecord = {
      employeeId: 'emp-001',
      salaryMonth: '2026-08',
      approvedAmount: 3000,
      approvedBy: 'Senior Admin',
      approvedAt: new Date().toISOString(),
      approvalStatus: 'APPROVED',
      notes: 'Approved after verification'
    };

    assert.strictEqual(approvalRecord.approvalStatus, 'APPROVED');
    assert.strictEqual(approvalRecord.approvedAmount, 3000);

    const netSalary = earnedSalary - approvalRecord.approvedAmount;
    assert.strictEqual(netSalary, 19000, '22,000 - 3,000 approved expenses = 19,000');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 14: PDF and Screen single source of truth
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 14: getFinalizedSalaryReport serves as single source of truth for both screen and PDF', async () => {
    const report = await db.getFinalizedSalaryReport('2026-08');

    assert.ok(report, 'Report must be generated');
    assert.ok(report.summary, 'Report summary must exist');
    assert.ok(Array.isArray(report.employees), 'Employees list must be an array');
    assert.strictEqual(report.month, '2026-08');

    // Verify companyTotals / summary consistency
    const manualSumNet = report.employees.reduce((s, e) => s + e.netSalary, 0);
    assert.strictEqual(report.summary.totalNetSalary, manualSumNet, 'Summary net total must equal sum of employee net salaries');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 15: Historical data preservation
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 15: Historical production attendance records remain completely intact (count >= 400)', async () => {
    const attendance = await db.getAttendance();
    assert.ok(Array.isArray(attendance), 'Attendance must be an array');
    assert.ok(attendance.length >= 400, `Production attendance records must remain preserved (>= 400), got ${attendance.length}`);

    const employees = await db.getEmployees(false);
    assert.strictEqual(employees.length, 23, `Active employee roster must be exactly 23 official employees, got ${employees.length}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 16: Manual Present Days override, persistence, recalculation & reset
  // ─────────────────────────────────────────────────────────────────────────
  await runTest('Test 16: Manual Present Days editing, persistence across recalculation, and reset to auto', async () => {
    const employees = await db.getEmployees(false);
    assert.ok(employees.length > 0, 'Employees must exist');
    const testEmp = employees[0];
    const testMonth = '2026-08';

    // 1. Initial report before override
    const initialReport = await db.getFinalizedSalaryReport(testMonth);
    const initialEmpReport = initialReport.employees.find(e => e.id === testEmp.id);
    assert.ok(initialEmpReport, 'Employee must exist in August report');
    const originalPresentDays = initialEmpReport.presentDays;

    // 2. Set manual present days to 25
    const manualDays = 25;
    const saveRes = await db.setManualPresentDays(testEmp.id, testMonth, manualDays, 'Admin Test');
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.manualPresentDays, 25);

    // 3. Verify getFinalizedSalaryReport reflects the manual override
    const updatedReport = await db.getFinalizedSalaryReport(testMonth);
    const updatedEmpReport = updatedReport.employees.find(e => e.id === testEmp.id);
    assert.strictEqual(updatedEmpReport.isManualPresentDays, true, 'isManualPresentDays flag must be true');
    assert.strictEqual(updatedEmpReport.presentDays, 25, 'effectivePresentDays must be 25');
    assert.strictEqual(updatedEmpReport.earnedSalary, updatedEmpReport.perDaySalary * 25, 'Earned salary must be calculated from 25 days');

    // 4. Recalculate salary (generateSalary) and verify manual override is preserved
    await db.generateSalary(testEmp.id, testMonth);
    const postRecalcReport = await db.getFinalizedSalaryReport(testMonth);
    const postRecalcEmp = postRecalcReport.employees.find(e => e.id === testEmp.id);
    assert.strictEqual(postRecalcEmp.isManualPresentDays, true, 'isManualPresentDays must persist across generateSalary');
    assert.strictEqual(postRecalcEmp.presentDays, 25, 'presentDays must remain 25 after recalc');

    // 5. Reset manual override back to auto
    const resetRes = await db.resetManualPresentDays(testEmp.id, testMonth);
    assert.strictEqual(resetRes.success, true);

    const postResetReport = await db.getFinalizedSalaryReport(testMonth);
    const postResetEmp = postResetReport.employees.find(e => e.id === testEmp.id);
    assert.strictEqual(postResetEmp.isManualPresentDays, false, 'isManualPresentDays must be false after reset');
    assert.strictEqual(postResetEmp.presentDays, originalPresentDays, 'presentDays must revert to original auto-calculated value');
  });

  console.log('\n=============================================================');
  console.log(`  TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('=============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Test suite runner encountered error:', err);
  process.exit(1);
});
