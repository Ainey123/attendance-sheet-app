const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Supabase credentials from environment variables ONLY (never hardcode!)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set as environment variables.');
  console.error('Example: SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=ey... node migrate.js');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log('Starting migration...');
  
  // Read data.json
  const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
  console.log('Loaded data.json');
  
  // Migrate employees
  console.log('Migrating employees...');
  for (const emp of data.employees) {
    const { error } = await supabase.from('employees').insert(emp);
    if (error) console.error('Error inserting employee:', error.message);
  }
  console.log('Migrated %d employees', data.employees.length);
  
  // Migrate attendance
  console.log('Migrating attendance records...');
  for (const att of data.attendance) {
    const { error } = await supabase.from('attendance').insert(att);
    if (error) console.error('Error inserting attendance:', error.message);
  }
  console.log('Migrated %d attendance records', data.attendance.length);
  
  // Migrate work records
  console.log('Migrating work records...');
  for (const wr of data.workRecords) {
    const { error } = await supabase.from('work_records').insert(wr);
    if (error) console.error('Error inserting work record:', error.message);
  }
  console.log('Migrated %d work records', data.workRecords.length);
  
  // Migrate work profiles
  console.log('Migrating work profiles...');
  for (const [key, profile] of Object.entries(data.workProfiles || {})) {
    const [employeeId, month] = key.split(':');
    const { error } = await supabase.from('work_profiles').insert({
      employeeId,
      month,
      fatherName: profile.fatherName
    });
    if (error) console.error('Error inserting work profile:', error.message);
  }
  console.log('Migrated work profiles');
  
  // Migrate settings
  console.log('Migrating settings...');
  const { error: settingsError } = await supabase.from('settings').upsert({
    id: 'default',
    ...data.settings
  });
  if (settingsError) console.error('Error inserting settings:', settingsError.message);
  console.log('Migrated settings');
  
  console.log('\nMigration complete! Your data is now in Supabase.');
  console.log('Go to your Vercel app and refresh to see your data.');
}

migrate().catch(console.error);
