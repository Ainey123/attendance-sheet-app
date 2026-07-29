/**
 * Dump live Supabase data into the local data.json file.
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from .env.local,
 * fetches tables: employees, attendance, work_records,
 * work_profiles, settings, form_submissions,
 * then writes a JSON file matching the app's expected structure.
 */
require('dotenv').config({ path: './.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY. Please set them in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchTable(table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(`Error fetching ${table}: ${error.message}`);
  return data || [];
}

async function main() {
  try {
    const [employees, attendance, workRecords, workProfilesRaw, settingsArr, formSubmissions] = await Promise.all([
      fetchTable('employees'),
      fetchTable('attendance'),
      fetchTable('work_records'),
      fetchTable('work_profiles'),
      fetchTable('settings'),
      fetchTable('form_submissions'),
    ]);

    const settings = settingsArr[0] || { adminPasscode: '1234', officeName: 'My Office' };

    const workProfiles = {};
    workProfilesRaw.forEach(p => {
      if (p.employeeId && p.month) {
        workProfiles[`${p.employeeId}:${p.month}`] = { fatherName: p.fatherName || '' };
      }
    });

    const dump = {
      employees,
      attendance,
      workRecords,
      workProfiles,
      settings,
      formSubmissions,
    };

    const outPath = path.join(__dirname, '..', 'data.json');
    fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf8');
    console.log('✅ Supabase data dumped to', outPath);
  } catch (err) {
    console.error('❌ Dump failed:', err.message);
    if (err.cause) {
      console.error('Underlying cause:', err.cause);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
