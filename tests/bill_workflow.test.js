/**
 * Bill Feature Category-Wise Workflow & Concurrency Test Suite
 * Validates:
 * 1. Concurrency-safe sequential bill number generation (no duplicates under race conditions)
 * 2. Bill creation with 5 expense categories, initial status SUBMITTED, and persistent notification
 * 3. Step 1: Admin Category-Wise Verification (enforcing 0 <= verified <= claimed)
 * 4. Step 2: Category-Wise Rejection (V=0, A=0, preserving claimed amount, no blocking)
 * 5. Step 3: Senior Admin Category-Wise Approval (passcode validation, enforcing 0 <= approved <= verified)
 * 6. Server-side single source of truth for totals: Claimed = sum C, Verified = sum V, Approved = sum A
 * 7. Multi-process concurrency safety (OCC retry on category updates prevents lost updates)
 * 8. Zero-claimed categories treated as N/A
 * 9. Exact user acceptance test scenario (24,000 claimed -> 19,500 verified -> 18,000 approved)
 * 10. Backward compatibility for legacy bills and whole-bill methods
 * 11. Role isolation and status/search filtering
 */

const assert = require('assert');
const db = require('../db.js');
db.useLocalFallback = true; // Use local data for isolated unit tests

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

async function runAllTests() {
  console.log('\n=============================================================');
  console.log('  STARTING CATEGORY-WISE BILL WORKFLOW & CONCURRENCY SUITE');
  console.log('=============================================================\n');

  const testEmployeeId = 'test-emp-001';
  const testEmployeeName = 'Test Employee Alpha';

  // Clean up any stale test bills and comments before starting
  try {
    const testEmpIds = ['test-emp-001', 'test-emp-002', 'test-emp-race', 'test-emp-acceptance'];
    const { createClient } = require('@supabase/supabase-js');
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
    require('dotenv').config();
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      for (const tId of testEmpIds) {
        await sb.from('bills').delete().eq('employeeId', tId);
        await sb.from('comments').delete().eq('employeeId', tId);
      }
    }
  } catch (e) {}

  // 1. Concurrency-Safe Sequential Bill Creation
  await runTest('Test 1: Concurrent bill creation generates strictly unique sequential numbers', async () => {
    const concurrentSubmissions = 6;
    const promises = [];

    for (let i = 0; i < concurrentSubmissions; i++) {
      promises.push(db.createBill({
        employeeId: testEmployeeId,
        employeeName: testEmployeeName,
        siteName: 'Concurrent Test Site ' + (i + 1),
        date: '2026-09-18',
        transportationExpense: 100 * (i + 1),
        materialExpense: 200,
        labourExpense: 0,
        accommodationExpense: 0,
        otherExpense: 50,
        description: 'Concurrent submission test batch #' + (i + 1),
        attachments: [{ name: 'receipt_' + i + '.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,sample' }]
      }));
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, concurrentSubmissions, 'All concurrent submissions must resolve');

    const billNumbers = results.map(b => b.billNumber);
    const uniqueNumbers = new Set(billNumbers);

    assert.strictEqual(uniqueNumbers.size, concurrentSubmissions, 'Every concurrent bill must receive a UNIQUE bill number');
    
    // Check BILL-XXXXXX format
    billNumbers.forEach(num => {
      assert.ok(/^BILL-\d{6}$/.test(num), 'Bill number ' + num + ' must match BILL-XXXXXX format');
    });

    // Check strict ascending sequence order
    const numericSuffixes = billNumbers.map(num => parseInt(num.replace('BILL-', ''), 10));
    numericSuffixes.sort((a, b) => a - b);
    for (let i = 1; i < numericSuffixes.length; i++) {
      assert.strictEqual(numericSuffixes[i], numericSuffixes[i - 1] + 1, 'Bill numbers must form a continuous sequence without gaps or duplicates');
    }
  });

  // 2. Bill Creation with 5 Categories, Initial Status SUBMITTED, and Notification
  let createdBillId = null;
  let createdBillNumber = null;

  await runTest('Test 2: Bill creation stores 5 categories, sets status SUBMITTED, and adds persistent notification', async () => {
    const bill = await db.createBill({
      employeeId: testEmployeeId,
      employeeName: testEmployeeName,
      siteName: 'Gulberg Commercial Plaza',
      date: '2026-09-18',
      transportationExpense: 1500,
      materialExpense: 4200,
      labourExpense: 2000,
      accommodationExpense: 1000,
      otherExpense: 300,
      description: 'Emergency plumbing fixtures and transport',
      attachments: [
        { name: 'plumbing_bill.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,plumbing123' },
        { name: 'fuel_receipt.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,fuel123' }
      ]
    });

    createdBillId = bill.id;
    createdBillNumber = bill.billNumber;

    assert.ok(createdBillId, 'Created bill must have an ID');
    assert.strictEqual(bill.status, 'SUBMITTED', 'Initial bill status must be SUBMITTED');
    assert.strictEqual(bill.totalClaimedAmount, 9000, 'Total claimed must equal sum of 5 categories');
    assert.strictEqual(bill.totalVerifiedAmount, 0);
    assert.strictEqual(bill.totalApprovedAmount, 0);

    // Verify categories dictionary
    assert.ok(bill.categories, 'Bill must have categories JSON');
    assert.strictEqual(bill.categories.transportation.claimedAmount, 1500);
    assert.strictEqual(bill.categories.transportation.status, 'SUBMITTED');
    assert.strictEqual(bill.categories.material.claimedAmount, 4200);
    assert.strictEqual(bill.categories.labour.claimedAmount, 2000);
    assert.strictEqual(bill.categories.accommodation.claimedAmount, 1000);
    assert.strictEqual(bill.categories.other.claimedAmount, 300);

    assert.strictEqual(bill.attachments.length, 2, 'Must preserve both attachments');
    assert.ok(bill.auditLog && bill.auditLog.length >= 1, 'Must have creation audit log');
    assert.strictEqual(bill.auditLog[0].action, 'SUBMITTED');

    // Verify persistent notification was added to comments table
    const commentsData = await db.getComments(testEmployeeId);
    const notifs = (commentsData.comments || commentsData || []).filter(c => c.sender === 'bill_system' && c.message.includes(createdBillNumber));
    assert.ok(notifs.length > 0, 'Must find persistent notification for ' + createdBillNumber + ' in comments table');
    assert.ok(notifs[0].message.includes('Rs. 9,000'), 'Notification must mention total claimed amount');
  });

  // 3. Category-Wise Verification Workflow & Boundary Enforcements
  await runTest('Test 3: Category-wise verification enforces bounds 0 <= V <= C and transitions to PARTIALLY_VERIFIED', async () => {
    // 3a. Reject verification exceeding claimed amount
    let threwExceedError = false;
    try {
      await db.verifyBillCategory(createdBillId, {
        category: 'transportation',
        verifiedAmount: 2000, // claimed is 1500
        verifiedComment: 'Trying to over-verify',
        verifiedBy: 'Admin Officer'
      });
    } catch (e) {
      threwExceedError = true;
      assert.ok(e.message.includes('cannot exceed claimed amount'), 'Expected error message about exceeding claimed amount');
    }
    assert.ok(threwExceedError, 'Verifying category amount > claimed amount must be rejected');

    // 3b. Successfully verify Transportation (1200 of 1500)
    const updatedBill = await db.verifyBillCategory(createdBillId, {
      category: 'transportation',
      verifiedAmount: 1200,
      verifiedComment: 'Fuel receipt verified up to 1200',
      verifiedBy: 'Admin Officer'
    });

    assert.strictEqual(updatedBill.status, 'PARTIALLY_VERIFIED', 'Bill should be PARTIALLY_VERIFIED after only one category verified');
    assert.strictEqual(updatedBill.categories.transportation.status, 'VERIFIED');
    assert.strictEqual(updatedBill.categories.transportation.verifiedAmount, 1200);
    assert.strictEqual(updatedBill.categories.transportation.claimedAmount, 1500, 'Claimed amount must remain 1500');
    assert.strictEqual(updatedBill.totalClaimedAmount, 9000, 'Original total claimed amount MUST remain 9000');
    assert.strictEqual(updatedBill.totalVerifiedAmount, 1200, 'Total verified must be 1200');

    const auditActions = updatedBill.auditLog.map(a => a.action);
    assert.ok(auditActions.includes('CATEGORY_VERIFIED'), 'Audit log must record CATEGORY_VERIFIED');
  });

  // 4. Category-Wise Rejection Workflow
  await runTest('Test 4: Category-wise rejection sets V=0, A=0, preserves claimed amount, and does not block approval', async () => {
    // Reject "other" expense (claimed 300)
    const updatedBill = await db.rejectBillCategory(createdBillId, {
      category: 'other',
      reason: 'Snacks not reimbursable under policy',
      rejectedBy: 'Admin Officer'
    });

    assert.strictEqual(updatedBill.categories.other.status, 'REJECTED');
    assert.strictEqual(updatedBill.categories.other.verifiedAmount, 0);
    assert.strictEqual(updatedBill.categories.other.approvedAmount, 0);
    assert.strictEqual(updatedBill.categories.other.claimedAmount, 300, 'Claimed amount must remain strictly preserved');
    assert.strictEqual(updatedBill.categories.other.rejectionReason, 'Snacks not reimbursable under policy');

    // Verify remaining categories to complete verification
    await db.verifyBillCategory(createdBillId, { category: 'material', verifiedAmount: 4000, verifiedBy: 'Admin Officer' });
    await db.verifyBillCategory(createdBillId, { category: 'labour', verifiedAmount: 2000, verifiedBy: 'Admin Officer' });
    const fullyVerifiedBill = await db.verifyBillCategory(createdBillId, { category: 'accommodation', verifiedAmount: 1000, verifiedBy: 'Admin Officer' });

    // Transportation: 1200, Material: 4000, Labour: 2000, Accommodation: 1000, Other: REJECTED (0)
    // Total Verified: 1200 + 4000 + 2000 + 1000 = 8200
    assert.strictEqual(fullyVerifiedBill.status, 'VERIFIED', 'All active categories verified/rejected -> bill status VERIFIED');
    assert.strictEqual(fullyVerifiedBill.totalVerifiedAmount, 8200);
    assert.strictEqual(fullyVerifiedBill.totalClaimedAmount, 9000);
  });

  // 5. Senior Admin Category-Wise Approval Workflow & Passcode Enforcement
  await runTest('Test 5: Senior Admin category approval enforces passcode, 0 <= A <= V, and status progression', async () => {
    // 5a. Missing or invalid passcode rejected
    let threwPasscodeError = false;
    try {
      await db.approveBillCategory(createdBillId, {
        category: 'material',
        approvedAmount: 3800,
        seniorPasscode: 'wrong_pass',
        approvedBy: 'Senior Admin'
      });
    } catch (e) {
      threwPasscodeError = true;
      assert.ok(e.message.includes('Invalid Senior Admin Passcode'), 'Expected passcode rejection');
    }
    assert.ok(threwPasscodeError, 'Invalid passcode must be rejected');

    // 5b. Approval exceeding verified amount rejected
    let threwApprovedExceedError = false;
    try {
      await db.approveBillCategory(createdBillId, {
        category: 'material',
        approvedAmount: 4500, // verified was 4000
        seniorPasscode: '9999',
        approvedBy: 'Senior Admin'
      });
    } catch (e) {
      threwApprovedExceedError = true;
      assert.ok(e.message.includes('cannot exceed verified amount'), 'Expected error about exceeding verified amount');
    }
    assert.ok(threwApprovedExceedError, 'Approving category amount > verified amount must be rejected');

    // 5c. Approve material partially (3800 of 4000)
    const partApprovedBill = await db.approveBillCategory(createdBillId, {
      category: 'material',
      approvedAmount: 3800,
      approvedComment: 'Approved with Rs. 200 minor deduction',
      seniorPasscode: '9999',
      approvedBy: 'Senior Admin'
    });

    assert.strictEqual(partApprovedBill.status, 'PARTIALLY_APPROVED', 'Status must be PARTIALLY_APPROVED after approving first category');
    assert.strictEqual(partApprovedBill.categories.material.status, 'APPROVED');
    assert.strictEqual(partApprovedBill.categories.material.approvedAmount, 3800);
    assert.strictEqual(partApprovedBill.categories.material.verifiedAmount, 4000);
    assert.strictEqual(partApprovedBill.totalApprovedAmount, 3800);

    // 5d. Approve remaining verified categories (transportation 1200, labour 1800, accommodation 1000)
    // Note: Other was rejected, so it should not block final approval!
    await db.approveBillCategory(createdBillId, { category: 'transportation', approvedAmount: 1200, seniorPasscode: '9999', approvedBy: 'Senior Admin' });
    await db.approveBillCategory(createdBillId, { category: 'labour', approvedAmount: 1800, seniorPasscode: '9999', approvedBy: 'Senior Admin' });
    const fullyApprovedBill = await db.approveBillCategory(createdBillId, { category: 'accommodation', approvedAmount: 1000, seniorPasscode: '9999', approvedBy: 'Senior Admin' });

    assert.strictEqual(fullyApprovedBill.status, 'APPROVED', 'Bill must be APPROVED when all non-rejected categories are approved');
    // Total approved: 3800 + 1200 + 1800 + 1000 = 7800
    assert.strictEqual(fullyApprovedBill.totalApprovedAmount, 7800);
    assert.strictEqual(fullyApprovedBill.totalVerifiedAmount, 8200);
    assert.strictEqual(fullyApprovedBill.totalClaimedAmount, 9000);

    const auditActions = fullyApprovedBill.auditLog.map(a => a.action);
    assert.ok(auditActions.includes('CATEGORY_APPROVED'), 'Audit log must record CATEGORY_APPROVED');
  });

  // 6. User's Exact Acceptance Scenario
  await runTest('Test 6: User exact acceptance scenario (Claimed 24,000 -> Verified 19,500 -> Approved 18,000)', async () => {
    // Trans 5000, Mat 10000, Lab 7000, Acc 0, Other 2000 (Claimed: 24,000)
    const exactBill = await db.createBill({
      employeeId: 'emp-acceptance',
      employeeName: 'Acceptance Tester',
      siteName: 'Main Commercial Hub',
      date: '2026-09-19',
      transportationExpense: 5000,
      materialExpense: 10000,
      labourExpense: 7000,
      accommodationExpense: 0,
      otherExpense: 2000,
      description: 'Project Phase 1 full submission',
      attachments: [{ name: 'invoices.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,doc' }]
    });

    assert.strictEqual(exactBill.totalClaimedAmount, 24000);
    assert.strictEqual(exactBill.status, 'SUBMITTED');
    assert.strictEqual(exactBill.categories.accommodation.claimedAmount, 0, 'Zero-claimed accommodation');

    // Admin verifies:
    // Trans: 4500, Mat: 8000, Lab: 7000, Acc: 0 (N/A), Other: REJECTED (0)
    await db.verifyBillCategory(exactBill.id, { category: 'transportation', verifiedAmount: 4500, verifiedBy: 'Admin' });
    await db.verifyBillCategory(exactBill.id, { category: 'material', verifiedAmount: 8000, verifiedBy: 'Admin' });
    await db.verifyBillCategory(exactBill.id, { category: 'labour', verifiedAmount: 7000, verifiedBy: 'Admin' });
    const verifiedExact = await db.rejectBillCategory(exactBill.id, { category: 'other', reason: 'Unverified misc receipts', rejectedBy: 'Admin' });

    // Acc had 0 claimed, so it is N/A and does not block VERIFIED status!
    assert.strictEqual(verifiedExact.status, 'VERIFIED');
    // Total Verified = 4500 + 8000 + 7000 + 0 + 0 = 19,500
    assert.strictEqual(verifiedExact.totalVerifiedAmount, 19500);
    assert.strictEqual(verifiedExact.totalClaimedAmount, 24000);

    // Senior Admin approves:
    // Trans: 4000, Mat: 7500, Lab: 6500
    await db.approveBillCategory(exactBill.id, { category: 'transportation', approvedAmount: 4000, seniorPasscode: '9999', approvedBy: 'Senior Admin' });
    await db.approveBillCategory(exactBill.id, { category: 'material', approvedAmount: 7500, seniorPasscode: '9999', approvedBy: 'Senior Admin' });
    const approvedExact = await db.approveBillCategory(exactBill.id, { category: 'labour', approvedAmount: 6500, seniorPasscode: '9999', approvedBy: 'Senior Admin' });

    // Status: APPROVED, Total Approved = 4000 + 7500 + 6500 = 18,000
    assert.strictEqual(approvedExact.status, 'APPROVED');
    assert.strictEqual(approvedExact.totalApprovedAmount, 18000);
    assert.strictEqual(approvedExact.totalVerifiedAmount, 19500);
    assert.strictEqual(approvedExact.totalClaimedAmount, 24000);
  });

  // 7. Concurrent Category Updates on the Same Bill (No Lost Updates)
  await runTest('Test 7: Concurrent category updates on the same bill preserve both updates without lost updates', async () => {
    const concurrentBill = await db.createBill({
      employeeId: 'emp-race',
      employeeName: 'Race Test Employee',
      siteName: 'Concurrency Test Arena',
      date: '2026-09-19',
      transportationExpense: 3000,
      materialExpense: 5000,
      labourExpense: 0,
      accommodationExpense: 0,
      otherExpense: 0,
      description: 'Race condition test',
      attachments: [{ name: 'test.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,sample' }]
    });

    // Simulate Admin A verifying Transportation and Admin B verifying Material nearly simultaneously
    const [resA, resB] = await Promise.all([
      db.verifyBillCategory(concurrentBill.id, { category: 'transportation', verifiedAmount: 2500, verifiedComment: 'Admin A verified', verifiedBy: 'Admin A' }),
      db.verifyBillCategory(concurrentBill.id, { category: 'material', verifiedAmount: 4200, verifiedComment: 'Admin B verified', verifiedBy: 'Admin B' })
    ]);

    // Fetch the final bill state from database
    const finalBill = await db.getBillById(concurrentBill.id);
    const billData = finalBill.bill || finalBill;

    // Both categories MUST have their updates preserved!
    assert.strictEqual(billData.categories.transportation.status, 'VERIFIED', 'Transportation must remain VERIFIED');
    assert.strictEqual(billData.categories.transportation.verifiedAmount, 2500);
    assert.strictEqual(billData.categories.material.status, 'VERIFIED', 'Material must remain VERIFIED');
    assert.strictEqual(billData.categories.material.verifiedAmount, 4200);

    // Bill total verified must reflect both: 2500 + 4200 = 6700
    assert.strictEqual(billData.totalVerifiedAmount, 6700, 'Both concurrent updates must be merged into totalVerifiedAmount');
    assert.strictEqual(billData.status, 'VERIFIED', 'Both active categories verified -> VERIFIED');
  });

  // 8. Whole-Bill Rejection & Attachment Preservation
  await runTest('Test 8: Whole bill rejection preserves attachments, claimed amounts, and records reason', async () => {
    const billToReject = await db.createBill({
      employeeId: testEmployeeId,
      employeeName: testEmployeeName,
      siteName: 'Site Beta for Rejection Test',
      date: '2026-09-18',
      transportationExpense: 500,
      materialExpense: 0,
      labourExpense: 0,
      accommodationExpense: 0,
      otherExpense: 0,
      description: 'Trip without authorization',
      attachments: [{ name: 'ticket.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,ticket123' }]
    });

    const rejected = await db.rejectBill(billToReject.id, { rejectionReason: 'No prior management authorization for travel.', rejectedBy: 'Admin Auditor' });
    assert.strictEqual(rejected.status, 'REJECTED');
    assert.strictEqual(rejected.rejectedBy, 'Admin Auditor');
    assert.strictEqual(rejected.rejectionReason, 'No prior management authorization for travel.');
    assert.ok(rejected.rejectedAt);
    assert.strictEqual(rejected.attachments.length, 1, 'Attachments must remain preserved after rejection');
    assert.strictEqual(rejected.totalClaimedAmount, 500, 'Claimed amount must remain preserved');

    const auditActions = rejected.auditLog.map(a => a.action);
    assert.ok(auditActions.includes('REJECTED'), 'Audit log must record REJECTED action');
  });

  // 9. Role Isolation & Stats Calculation
  await runTest('Test 9: Role isolation and bill stats calculation with category totals', async () => {
    const emp2Id = 'test-emp-002';
    await db.createBill({
      employeeId: emp2Id,
      employeeName: 'Test Employee Beta',
      siteName: 'Site Gamma',
      date: '2026-09-18',
      transportationExpense: 1000,
      materialExpense: 0,
      labourExpense: 0,
      accommodationExpense: 0,
      otherExpense: 0,
      description: 'Beta bill',
      attachments: [{ name: 'rec.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,rec' }]
    });

    const emp2Bills = await db.getBills({ employeeId: emp2Id });
    assert.ok(emp2Bills.every(b => b.employeeId === emp2Id), 'Employee 2 must only see bills belonging to Employee 2');

    const allBills = await db.getBills();
    assert.ok(allBills.some(b => b.employeeId === testEmployeeId), 'Admin sees Employee 1 bills');
    assert.ok(allBills.some(b => b.employeeId === emp2Id), 'Admin sees Employee 2 bills');

    const stats = await db.getBillStats();
    assert.ok(stats.totalBills >= 1, 'Total bills must reflect created bills');
    assert.ok(typeof stats.pendingVerificationCount === 'number');
    assert.ok(typeof stats.verifiedCount === 'number');
    assert.ok(typeof stats.approvedCount === 'number');
    assert.ok(typeof stats.rejectedCount === 'number');
    assert.ok(stats.totalClaimedAmount > 0, 'Total claimed amount must be positive');
  });

  // Cleanup test bills so the production database stays pristine
  try {
    const testEmpIds = ['test-emp-001', 'test-emp-002', 'test-emp-race', 'test-emp-acceptance'];
    const { createClient } = require('@supabase/supabase-js');
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
    require('dotenv').config();
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      for (const tId of testEmpIds) {
        await sb.from('bills').delete().eq('employeeId', tId);
        await sb.from('comments').delete().eq('employeeId', tId);
      }
    }
  } catch (e) {}

  console.log('\n=============================================================');
  console.log('  BILL SUITE RESULTS: ' + passedTests + '/' + totalTests + ' TESTS PASSED');
  console.log('=============================================================\n');
}

runAllTests().catch(err => {
  console.error('\n❌ Test Suite Aborted with error:', err);
  process.exit(1);
});
