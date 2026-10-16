/**
 * Automated Duplicate Bill Verification Test Suite
 * Strictly Validates User Requirement:
 * "Only mark the bill as duplicate if site name, employee name and amount matches.
 * Not just site only or amount or employee. If all three match, then it becomes duplicate."
 *
 * Test Cases:
 * 1. Base bill submission (Site A, Emp 1, Amount 15,000) -> Clean
 * 2. Exact match on all 3 (Site A, Emp 1, Amount 15,000) -> FLAGGED DUPLICATE
 * 3. Fuzzy branch match on all 3 (Site A variation, Emp 1, Amount 15,000) -> FLAGGED DUPLICATE
 * 4. Site & Amount match, but DIFFERENT Employee (Site A, Emp 2, Amount 15,000) -> MUST NOT BE DUPLICATE
 * 5. Site & Employee match, but DIFFERENT Amount (Site A, Emp 1, Amount 20,000) -> MUST NOT BE DUPLICATE
 * 6. Employee & Amount match, but DIFFERENT Site (Site B, Emp 1, Amount 15,000) -> MUST NOT BE DUPLICATE
 * 7. db.getBills automatically attaches duplicateVerification metadata
 * 8. db.getDuplicateClusters groups duplicate bills into clusters
 * 9. Admin one-click duplicate rejection marks bill REJECTED with audit trail
 * 10. Admin duplicate override verifies bill as legitimate and clears duplicate alert
 * 11. Bill stats integration (duplicateAlertsCount and duplicateAlertsAmount)
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

async function runDuplicateVerificationSuite() {
  console.log('\n=============================================================');
  console.log('  STARTING AUTOMATED DUPLICATE BILL VERIFICATION TEST SUITE');
  console.log('  Rule: Site Name + Employee Name + Claimed Amount ALL 3 MATCH');
  console.log('=============================================================\n');

  const runId = Date.now().toString().slice(-6);
  const emp1 = { id: 'dup-emp-1-' + runId, name: 'Zahid Khan' };
  const emp2 = { id: 'dup-emp-2-' + runId, name: 'Bilal Ahmed' };
  const siteBranch = 'DHA Phase 8 Branch ' + runId;
  const siteFuzzy = 'DHA Phase 8 Site ' + runId;
  const siteShort = 'DHA Phase 8 ' + runId;
  const siteClean = 'Multan Industrial Zone ' + runId;

  // Cleanup helper (cleans local data.json AND Supabase if connected)
  const cleanupStaleData = async () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const dataFile = path.join(__dirname, '../data.json');
      if (fs.existsSync(dataFile)) {
        const fileData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        if (Array.isArray(fileData.bills)) {
          fileData.bills = fileData.bills.filter(b => !String(b.employeeId || '').startsWith('dup-emp'));
          fs.writeFileSync(dataFile, JSON.stringify(fileData, null, 2));
        }
      }
    } catch (e) {}

    try {
      const { createClient } = require('@supabase/supabase-js');
      const path = require('path');
      require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
      require('dotenv').config();
      if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        await sb.from('bills').delete().ilike('employeeId', 'dup-emp-%');
        await sb.from('comments').delete().ilike('employeeId', 'dup-emp-%');
      }
    } catch (e) {}
  };

  try {
    await cleanupStaleData();

    // 1. Submit original bill
    let bill1 = null;
    await runTest('Test 1: Submit initial clean bill for DHA Phase 8 (Rs. 15,000)', async () => {
      bill1 = await db.createBill({
        employeeId: emp1.id,
        employeeName: emp1.name,
        siteName: siteBranch,
        billDate: '2026-10-15',
        transportationExpense: 5000,
        materialExpense: 10000,
        description: 'Site electrical cables and travel'
      });

      assert.ok(bill1.id);
      assert.strictEqual(bill1.totalClaimedAmount, 15000);
      assert.strictEqual(bill1.status, 'SUBMITTED');
    });

    // 2. Exact duplicate submission by same employee (Site + Employee + Amount ALL MATCH)
    let bill2 = null;
    await runTest('Test 2: Same employee submits duplicate (Same Site, Same Employee, Same Amount) - automatically flagged', async () => {
      bill2 = await db.createBill({
        employeeId: emp1.id,
        employeeName: emp1.name,
        siteName: siteBranch,
        billDate: '2026-10-15',
        transportationExpense: 5000,
        materialExpense: 10000,
        description: 'Site electrical cables and travel'
      });

      assert.ok(bill2.id);
      assert.notStrictEqual(bill2.billNumber, bill1.billNumber);

      const check = await db.verifyBillDuplicates(bill2.id);
      assert.strictEqual(check.isDuplicate, true, 'Bill 2 must be detected as duplicate');
      assert.strictEqual(check.duplicateVerification.severity, 'HIGH');
      assert.ok(check.matches.length >= 1);

      const match = check.matches.find(m => m.billNumber === bill1.billNumber);
      assert.ok(match, 'Must match with bill1');
      assert.ok(match.matchedCriteria.includes('branch'));
      assert.ok(match.matchedCriteria.includes('employee'));
      assert.ok(match.matchedCriteria.includes('amount'));
    });

    // 3. Fuzzy branch name matching (e.g. "DHA Phase 8 Site" vs "DHA Phase 8 Branch") with same Employee & Amount
    let bill3 = null;
    await runTest('Test 3: Fuzzy branch match (Same Site variation + Same Employee + Same Amount) - flagged as duplicate', async () => {
      bill3 = await db.createBill({
        employeeId: emp1.id,
        employeeName: emp1.name,
        siteName: siteFuzzy, // "Site" instead of "Branch"
        billDate: '2026-10-16',
        transportationExpense: 15000,
        materialExpense: 0,
        description: 'DHA site travel'
      });

      const check = await db.verifyBillDuplicates(bill3.id);
      assert.strictEqual(check.isDuplicate, true, 'Must detect duplicate with fuzzy branch match');
      const match = check.matches.find(m => m.billNumber === bill1.billNumber);
      assert.ok(match, 'Must match bill1 despite "Site" vs "Branch" suffix');
      assert.ok(match.matchedCriteria.includes('branch'));
      assert.ok(match.matchedCriteria.includes('employee'));
      assert.ok(match.matchedCriteria.includes('amount'));
    });

    // 4. Same Site & Amount, but DIFFERENT EMPLOYEE -> MUST NOT BE DUPLICATE!
    let bill4 = null;
    await runTest('Test 4: Different Employee for same Site & Amount MUST NOT be marked as duplicate', async () => {
      bill4 = await db.createBill({
        employeeId: emp2.id,
        employeeName: emp2.name, // Different employee Bilal Ahmed
        siteName: siteShort,
        billDate: '2026-10-15',
        transportationExpense: 15000,
        description: 'Claim for DHA Phase 8 by different employee'
      });

      const check = await db.verifyBillDuplicates(bill4.id);
      assert.strictEqual(check.isDuplicate, false, 'Different employee must NOT be flagged as duplicate');
      assert.strictEqual(check.duplicateVerification.severity, 'NONE');
      assert.strictEqual(check.matches.length, 0);
      assert.ok(check.duplicateVerification.summary.includes('Verified Unique'));
    });

    // 5. Same Site & Employee, but DIFFERENT AMOUNT -> MUST NOT BE DUPLICATE!
    let bill5 = null;
    await runTest('Test 5: Different Amount for same Site & Employee MUST NOT be marked as duplicate', async () => {
      bill5 = await db.createBill({
        employeeId: emp1.id,
        employeeName: emp1.name,
        siteName: siteBranch,
        billDate: '2026-10-15',
        transportationExpense: 20000, // Different amount: 20,000 instead of 15,000
        description: 'Additional supplies for DHA Phase 8'
      });

      const check = await db.verifyBillDuplicates(bill5.id);
      assert.strictEqual(check.isDuplicate, false, 'Different amount must NOT be flagged as duplicate');
      assert.strictEqual(check.duplicateVerification.severity, 'NONE');
      assert.strictEqual(check.matches.length, 0);
      assert.ok(check.duplicateVerification.summary.includes('Verified Unique'));
    });

    // 6. Same Employee & Amount, but DIFFERENT SITE -> MUST NOT BE DUPLICATE!
    let bill6 = null;
    await runTest('Test 6: Different Site for same Employee & Amount MUST NOT be marked as duplicate', async () => {
      bill6 = await db.createBill({
        employeeId: emp1.id,
        employeeName: emp1.name,
        siteName: siteClean, // Different site: Multan Industrial Zone
        billDate: '2026-10-15',
        transportationExpense: 15000, // Same amount
        description: 'Multan travel'
      });

      const check = await db.verifyBillDuplicates(bill6.id);
      assert.strictEqual(check.isDuplicate, false, 'Different site must NOT be flagged as duplicate');
      assert.strictEqual(check.duplicateVerification.severity, 'NONE');
      assert.strictEqual(check.matches.length, 0);
      assert.ok(check.duplicateVerification.summary.includes('Verified Unique'));
    });

    // 7. db.getBills automatically attaches duplicateVerification metadata
    await runTest('Test 7: db.getBills automatically attaches duplicateVerification metadata to all records', async () => {
      const bills = await db.getBills();
      assert.ok(bills.length >= 4);

      const b2 = bills.find(b => b.id === bill2.id);
      assert.ok(b2);
      assert.strictEqual(b2.isDuplicate, true);
      assert.ok(b2.duplicateVerification);
      assert.ok(b2.duplicateMatches.length >= 1);

      const b4 = bills.find(b => b.id === bill4.id);
      assert.ok(b4);
      assert.strictEqual(b4.isDuplicate, false, 'Bill 4 with different employee must not be duplicate');
    });

    // 8. Duplicate clusters grouping
    await runTest('Test 8: db.getDuplicateClusters groups duplicate bills into clusters', async () => {
      const clusters = await db.getDuplicateClusters();
      assert.ok(Array.isArray(clusters));
      assert.ok(clusters.length >= 1, 'Must find at least 1 cluster of duplicate bills');

      const dhaCluster = clusters.find(c => c.bills.some(b => b.id === bill1.id));
      assert.ok(dhaCluster, 'Must find DHA Phase 8 cluster');
      assert.ok(dhaCluster.bills.length >= 2, 'Cluster must contain 2 or more bills');
      assert.strictEqual(dhaCluster.totalClaimedAmount, 15000);
    });

    // 9. Admin one-click duplicate rejection
    await runTest('Test 9: Admin one-click duplicate rejection marks bill REJECTED and preserves audit trail', async () => {
      const rejectedBill = await db.rejectBill(bill2.id, {
        rejectionReason: `Duplicate bill of ${bill1.billNumber} (Site: ${siteBranch}, Employee: ${emp1.name}, Amount: Rs. 15,000)`,
        rejectedBy: 'Super Admin'
      });

      assert.strictEqual(rejectedBill.status, 'REJECTED');
      assert.strictEqual(rejectedBill.rejectedBy, 'Super Admin');
      assert.ok(rejectedBill.rejectionReason.includes('Duplicate bill'));

      const logEntry = rejectedBill.auditLog.find(l => l.action === 'REJECTED');
      assert.ok(logEntry);
      assert.strictEqual(logEntry.by, 'Super Admin');
    });

    // 10. Admin duplicate override / verification as legitimate
    await runTest('Test 10: Admin override verifies bill as legitimate and clears duplicate alert', async () => {
      const overridden = await db.overrideBillDuplicate(bill3.id, {
        overrideBy: 'Lead Auditor',
        note: 'Verified legitimate: Authorized follow-up site visit.'
      });

      assert.strictEqual(overridden.duplicateOverridden, true);
      assert.strictEqual(overridden.duplicateOverrideBy, 'Lead Auditor');

      const logEntry = overridden.auditLog.find(l => l.action === 'DUPLICATE_OVERRIDDEN');
      assert.ok(logEntry);
      assert.ok(logEntry.details.note.includes('Authorized follow-up'));

      // Re-verify: must now report legitimate/overridden
      const check = await db.verifyBillDuplicates(bill3.id);
      assert.strictEqual(check.isDuplicate, false, 'Overridden bill must not be flagged as duplicate');
      assert.strictEqual(check.duplicateVerification.overridden, true);
      assert.ok(check.duplicateVerification.summary.includes('Verified legitimate'));
    });

    // 11. Bill Stats integration
    await runTest('Test 11: db.getBillStats includes duplicateAlertsCount and duplicateAlertsAmount', async () => {
      const stats = await db.getBillStats();
      assert.ok('duplicateAlertsCount' in stats, 'Stats must include duplicateAlertsCount');
      assert.ok('duplicateAlertsAmount' in stats, 'Stats must include duplicateAlertsAmount');
      assert.ok(typeof stats.duplicateAlertsCount === 'number');
      assert.ok(typeof stats.duplicateAlertsAmount === 'number');
    });

  } finally {
    // Final cleanup of test bills
    await cleanupStaleData();
  }

  console.log('\n=============================================================');
  console.log(`  DUPLICATE VERIFICATION RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('=============================================================\n');
}

if (require.main === module) {
  runDuplicateVerificationSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test suite failed:', err);
      process.exit(1);
    });
}

module.exports = { runDuplicateVerificationSuite };
