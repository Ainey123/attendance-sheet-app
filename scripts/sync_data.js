const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log('Supabase credentials not configured in environment.');
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const DATA_FILE = path.join(__dirname, '..', 'data.json');

async function syncData() {
  console.log('Starting Supabase data verification and sync...');
  
  if (!fs.existsSync(DATA_FILE)) {
    console.log('No local data.json found.');
    return;
  }

  const localData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  // 1. Sync Employees
  if (localData.employees && Array.isArray(localData.employees)) {
    const { data: existingEmployees } = await supabase.from('employees').select('id');
    const existingIds = new Set((existingEmployees || []).map(e => e.id));
    const toInsert = localData.employees.filter(e => !existingIds.has(e.id));
    if (toInsert.length > 0) {
      console.log(`Syncing ${toInsert.length} missing employees to Supabase...`);
      const { error } = await supabase.from('employees').upsert(toInsert);
      if (error) console.error('Error syncing employees:', error.message);
      else console.log('Employees synced successfully!');
    } else {
      console.log('All local employees already exist in Supabase.');
    }
  }

  // 2. Sync Attendance
  if (localData.attendance && Array.isArray(localData.attendance)) {
    const { data: existingAtt } = await supabase.from('attendance').select('id');
    const existingIds = new Set((existingAtt || []).map(a => a.id));
    const toInsert = localData.attendance.filter(a => !existingIds.has(a.id));
    if (toInsert.length > 0) {
      console.log(`Syncing ${toInsert.length} missing attendance records to Supabase...`);
      const { error } = await supabase.from('attendance').upsert(toInsert);
      if (error) console.error('Error syncing attendance:', error.message);
      else console.log('Attendance records synced successfully!');
    } else {
      console.log('All local attendance records already exist in Supabase.');
    }
  }

  console.log('Data sync complete!');
}

syncData().catch(console.error);
