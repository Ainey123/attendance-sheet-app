const db = require('../db.js');
const https = require('https');

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request('https://attendence-sheet-app.vercel.app' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let resp = '';
      res.on('data', c => resp += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(resp) }); }
        catch(e) { resolve({ status: res.statusCode, raw: resp }); }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve) => {
    const req = https.request('https://attendence-sheet-app.vercel.app' + path, {
      method: 'GET'
    }, (res) => {
      let resp = '';
      res.on('data', c => resp += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(resp) }); }
        catch(e) { resolve({ status: res.statusCode, raw: resp }); }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function testStep5() {
  console.log('=== STEP 5 CONTROLLED 24-HOUR AUTO CLOCK-OUT TEST IN SUPABASE ===\n');

  // 1. Create controlled test employee
  const testEmpId = 'emp_audit_test_' + Date.now();
  const testToken = 'token_' + Date.now();
  console.log('1. Creating test employee:', testEmpId);
  const emp = await db.addEmployee('Auto Close Audit User', 'QA', testEmpId, testToken);

  // 2. Day 1: Clock in with clockInTime 26 hours ago
  const day1ClockIn = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  console.log('2. Inserting Day 1 shift at 26 hours ago:', day1ClockIn);
  
  const rec1Id = 'att_test1_' + Date.now();
  const { createClient } = require('@supabase/supabase-js');
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  const { data: rec1, error: err1 } = await supabase
    .from('attendance')
    .insert({
      id: rec1Id,
      employeeId: testEmpId,
      employeeName: 'Auto Close Audit User',
      role: 'QA',
      date: '2026-09-08',
      clockInTime: day1ClockIn,
      clockOutTime: null,
      duration: null,
      autoClockOut: false
    })
    .select()
    .single();

  if (err1) {
    console.error('Failed to insert Day 1 test record:', err1);
    await db.deleteEmployee(testEmpId);
    return;
  }

  // 3. Trigger auto-clock-out via autoCompleteOldAttendance on that employee
  console.log('3. Triggering auto-clock-out for test employee...');
  await db.autoCompleteOldAttendance(testEmpId);

  // 4. Verify Record 1 in Supabase
  const { data: rec1After } = await supabase
    .from('attendance')
    .select('*')
    .eq('id', rec1Id)
    .single();

  console.log('4. Record 1 in Supabase after 24h check:');
  console.log({
    id: rec1After.id,
    clockInTime: rec1After.clockInTime,
    clockOutTime: rec1After.clockOutTime,
    duration: rec1After.duration,
    autoClockOut: rec1After.autoClockOut
  });

  // 5. Day 2: Clock in via live production API
  console.log('\n5. Day 2 Clock-In via live production API...');
  const inRes = await post('/api/attendance/clock-in', {
    employeeId: testEmpId,
    location: { latitude: 31.5, longitude: 74.3, accuracy: 15 }
  });
  console.log('   Day 2 Clock-In status:', inRes.status, 'Record ID:', inRes.data && inRes.data.data && inRes.data.data.record && inRes.data.data.record.id);

  // 6. Day 2: Clock out via live production API
  console.log('\n6. Day 2 Clock-Out via live production API...');
  const outRes = await post('/api/attendance/clock-out', {
    employeeId: testEmpId,
    location: { latitude: 31.5, longitude: 74.3, accuracy: 15 },
    performanceNotes: 'Day 2 shift finished cleanly',
    receivedAmount: 0,
    expenseAmount: 100
  });
  console.log('   Day 2 Clock-Out status:', outRes.status, 'Record ID:', outRes.data && outRes.data.data && outRes.data.data.record && outRes.data.data.record.id);

  // 7. Verify both records exist and Record 2 was NOT blocked
  const { data: records } = await supabase
    .from('attendance')
    .select('*')
    .eq('employeeId', testEmpId);

  console.log('\n7. Final check in Supabase for test employee:');
  console.log('   Total records found:', records.length);
  records.forEach((r, idx) => {
    console.log(`   [Record ${idx+1}] ID: ${r.id}, Date: ${r.date}, In: ${r.clockInTime}, Out: ${r.clockOutTime}, Duration: ${r.duration}, Auto: ${r.autoClockOut}`);
  });

  // 8. Cleanup test data
  console.log('\n8. Cleaning up test employee and test records...');
  await supabase.from('attendance').delete().eq('employeeId', testEmpId);
  await db.deleteEmployee(testEmpId);
  console.log('   Cleanup completed cleanly.');
}

testStep5();
