const db = require('../db');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://hsdamnsrkrxesrohwtxs.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZGFtbnNya3J4ZXNyb2h3dHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMjgwNzgsImV4cCI6MjA5NjkwNDA3OH0.SUAMZ7f1fsrjpIKfqP1lPiGcH2YVlEBtwwiP4KORr8g';

const supabase = createClient(supabaseUrl, supabaseKey);
const DATA_FILE = path.join(__dirname, '..', 'data.json');

async function repair() {
  console.log('=== Step 1: Loading 12 active employees via db.getEmployees(false) ===');
  const emps = await db.getEmployees(false);
  const activeEmpMap = new Map();
  emps.forEach(e => {
    activeEmpMap.set(e.name.trim().toLowerCase(), e);
  });
  console.log(`Loaded ${emps.length} active employees:`);
  emps.forEach(e => console.log(`  - ${e.name}: ${e.id}`));

  console.log('\n=== Step 2: Fetching all attendance records ===');
  const { data: allAtt, error: attErr } = await supabase.from('attendance').select('id, employeeId, employeeName');
  if (attErr) throw attErr;

  const toUpdateAtt = [];
  allAtt.forEach(att => {
    const cleanName = (att.employeeName || '').trim().toLowerCase();
    const activeEmp = activeEmpMap.get(cleanName);
    if (activeEmp && att.employeeId !== activeEmp.id) {
      toUpdateAtt.push({ id: att.id, newEmpId: activeEmp.id, name: att.employeeName, oldEmpId: att.employeeId });
    }
  });

  console.log(`Found ${toUpdateAtt.length} attendance records needing repair.`);
  
  // Batch update in chunks of 20
  for (let i = 0; i < toUpdateAtt.length; i += 20) {
    const chunk = toUpdateAtt.slice(i, i + 20);
    await Promise.all(chunk.map(item => 
      supabase.from('attendance').update({ employeeId: item.newEmpId }).eq('id', item.id)
    ));
    console.log(`  Updated attendance records ${i + 1} to ${Math.min(i + 20, toUpdateAtt.length)}`);
  }
  console.log(`Successfully repaired all ${toUpdateAtt.length} attendance records in Supabase!`);

  console.log('\n=== Step 3: Fetching all work records ===');
  const { data: allWr, error: wrErr } = await supabase.from('work_records').select('id, employeeId, employeeName');
  if (!wrErr && allWr) {
    const toUpdateWr = [];
    allWr.forEach(wr => {
      const cleanName = (wr.employeeName || '').trim().toLowerCase();
      const activeEmp = activeEmpMap.get(cleanName);
      if (activeEmp && wr.employeeId !== activeEmp.id) {
        toUpdateWr.push({ id: wr.id, newEmpId: activeEmp.id });
      }
    });
    console.log(`Found ${toUpdateWr.length} work records needing repair.`);
    for (const item of toUpdateWr) {
      await supabase.from('work_records').update({ employeeId: item.newEmpId }).eq('id', item.id);
    }
    console.log(`Successfully repaired all ${toUpdateWr.length} work records in Supabase!`);
  }

  console.log('\n=== Step 4: Syncing all bills from Supabase to local data.json ===');
  const { data: allBills, error: billsErr } = await supabase.from('bills').select('*');
  if (billsErr) {
    console.error('Error fetching bills from Supabase:', billsErr.message);
  } else {
    console.log(`Fetched ${allBills.length} bills from Supabase (including bill_musfai5d_ooibr).`);
    if (fs.existsSync(DATA_FILE)) {
      const localData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      localData.bills = allBills;

      // Update localData attendance
      if (Array.isArray(localData.attendance)) {
        localData.attendance.forEach(a => {
          const cleanName = (a.employeeName || '').trim().toLowerCase();
          const activeEmp = activeEmpMap.get(cleanName);
          if (activeEmp) {
            a.employeeId = activeEmp.id;
          }
        });
      }

      // Update localData work_records
      if (Array.isArray(localData.workRecords)) {
        localData.workRecords.forEach(w => {
          const cleanName = (w.employeeName || '').trim().toLowerCase();
          const activeEmp = activeEmpMap.get(cleanName);
          if (activeEmp) {
            w.employeeId = activeEmp.id;
          }
        });
      }

      fs.writeFileSync(DATA_FILE, JSON.stringify(localData, null, 2), 'utf8');
      console.log(`Updated local data.json with all ${allBills.length} bills and repaired IDs!`);
    }
  }

  console.log('\n=== REPAIR & SYNC COMPLETED SUCCESSFULLY ===');
}

repair().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
