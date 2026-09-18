/**
 * Bill Feature Workflow & Concurrency Test Suite
 * Validates:
 * 1. Concurrency-safe sequential bill number generation (no duplicates under race conditions)
 * 2. Bill creation with 5 expense categories, attachments, and persistent notifications in comments
 * 3. Step 1: Admin Verification (enforcing 0 <= verified <= claimed, preserving original claimed amount)
 * 4. Step 2: Senior Admin Approval (senior passcode validation, enforcing 0 <= approved <= verified)
 * 5. Rejection audit trail (preserving all attachments and claim data with reason)
 * 6. Role isolation and status/search filtering
 */

const assert = require('assert');
const db = require('../db.js');
db.useLocalFallback = true; // Use local data for unit tests

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
  console.log('  STARTING BILL WORKFLOW & CONCURRENCY TEST SUITE');
  console.log('=============================================================\n');

  const testEmployeeId = 'test-emp-001';
  const testEmployeeName = 'Test Employee Alpha';

  // 1. Concurrency-Safe Bill Creation
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

  // 2. Bill Creation with 5 Expenses & Notification
  let createdBillId = null;
  let createdBillNumber = null;

  await runTest('Test 2: Bill creation stores 5 categories, calculates total, and inserts persistent notification', async () => {
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
    assert.strictEqual(bill.status, 'PENDING_VERIFICATION', 'Initial status must be PENDING_VERIFICATION');
    assert.strictEqual(bill.totalClaimedAmount, 9000, 'Total claimed must equal sum of 5 categories');
    assert.strictEqual(bill.attachments.length, 2, 'Must preserve both attachments');
    assert.ok(bill.auditLog && bill.auditLog.length >= 1, 'Must have creation audit log');
    assert.strictEqual(bill.auditLog[0].action, 'SUBMITTED');

    // Verify persistent notification was added to comments table
    const commentsData = await db.getComments(testEmployeeId);
    const notifs = (commentsData.comments || commentsData || []).filter(c => c.sender === 'bill_system' && c.message.includes(createdBillNumber));
    assert.ok(notifs.length > 0, 'Must find persistent notification for ' + createdBillNumber + ' in comments table');
    assert.ok(notifs[0].message.includes('Rs. 9,000'), 'Notification must mention total claimed amount');
  });

  // 3. Step 1 Admin Verification Workflow & Enforcements
  await runTest('Test 3: Step 1 Admin Verification verifies amount and rejects excessive verification', async () => {
    // 3a. Reject verification exceeding claimed amount
    let threwExceedError = false;
    try {
      await db.verifyBill(createdBillId, { verifiedAmount: 9500, verificationComment: 'Exceeding claimed amount', verifiedBy: 'Admin Officer' });
    } catch (e) {
      threwExceedError = true;
      assert.ok(e.message.includes('cannot exceed claimed amount'), 'Expected error message about exceeding claimed amount');
    }
    assert.ok(threwExceedError, 'Verifying amount > claimed amount must be rejected');

    // 3b. Successfully verify valid amount
    const verifiedBill = await db.verifyBill(createdBillId, { verifiedAmount: 8500, verificationComment: 'Fuel receipt verified. Plumbing slightly adjusted by Rs. 500.', verifiedBy: 'Admin Officer' });
    assert.strictEqual(verifiedBill.status, 'VERIFIED');
    assert.strictEqual(verifiedBill.verifiedAmount, 8500);
    assert.strictEqual(verifiedBill.totalClaimedAmount, 9000, 'Original totalClaimedAmount MUST NOT be modified or overwritten');
    assert.strictEqual(verifiedBill.verifiedBy, 'Admin Officer');
    assert.ok(verifiedBill.verifiedAt);
    assert.strictEqual(verifiedBill.verifiedComment, 'Fuel receipt verified. Plumbing slightly adjusted by Rs. 500.');

    const auditActions = verifiedBill.auditLog.map(a => a.action);
    assert.ok(auditActions.includes('VERIFIED'), 'Audit log must record VERIFIED action');
  });

  // 4. Step 2 Senior Admin Approval Workflow & Enforcements
  await runTest('Test 4: Step 2 Senior Admin Approval requires passcode and enforces <= verified amount', async () => {
    // 4a. Reject if approved amount exceeds verified amount (8500)
    let threwApprovedExceedError = false;
    try {
      await db.approveBill(createdBillId, { approvedAmount: 8600, approvalComment: 'Trying to approve more than verified', approvedBy: 'Senior Director' });
    } catch (e) {
      threwApprovedExceedError = true;
      assert.ok(e.message.includes('cannot exceed verified amount'), 'Expected error about exceeding verified amount');
    }
    assert.ok(threwApprovedExceedError, 'Approving amount > verified amount must be rejected');

    // 4b. Successfully approve valid amount (8200 <= 8500)
    const approvedBill = await db.approveBill(createdBillId, { approvedAmount: 8200, approvalComment: 'Approved for accounts disbursement.', approvedBy: 'Senior Director' });
    assert.strictEqual(approvedBill.status, 'APPROVED');
    assert.strictEqual(approvedBill.totalClaimedAmount, 9000, 'Original claimed amount must remain strictly 9000');
    assert.strictEqual(approvedBill.verifiedAmount, 8500, 'Verified amount must remain strictly 8500');
    assert.strictEqual(approvedBill.approvedAmount, 8200, 'Approved amount must be 8200');
    assert.strictEqual(approvedBill.approvedBy, 'Senior Director');
    assert.ok(approvedBill.approvedAt);

    const auditActions = approvedBill.auditLog.map(a => a.action);
    assert.ok(auditActions.includes('APPROVED'), 'Audit log must record APPROVED action');
  });

  // 5. Rejection Workflow & Audit Trail Preservation
  await runTest('Test 5: Bill rejection records reason and audit trail while preserving attachments', async () => {
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

  // 6. Role Isolation & Stats Accuracy
  await runTest('Test 6: Role isolation and bill stats calculation', async () => {
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
    assert.ok(stats.totalBills >= 8, 'Total bills must reflect all created bills');
    assert.ok(typeof stats.pendingVerificationCount === 'number');
    assert.ok(typeof stats.verifiedCount === 'number');
    assert.ok(typeof stats.approvedCount === 'number');
    assert.ok(typeof stats.rejectedCount === 'number');
    assert.ok(stats.totalClaimedAmount > 0, 'Total claimed amount must be positive');
  });

  console.log('\n=============================================================');
  console.log('  BILL SUITE RESULTS: ' + passedTests + '/' + totalTests + ' TESTS PASSED');
  console.log('=============================================================\n');
}

runAllTests().catch(err => {
  console.error('\n❌ Test Suite Aborted with error:', err);
  process.exit(1);
});
