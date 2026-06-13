const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Your Supabase credentials
const supabaseUrl = process.env.SUPABASE_URL || 'https://hsdamnsrkrxesrohwtxs.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZGFtbnNya3J4ZXNyb2h3dHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMjgwNzgsImV4cCI6MjA5NjkwNDA3OH0.SUAMZ7f1fsrjpIKfqP1lPiGcH2YVlEBtwwiP4KORr8g';

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log('🚀 Starting migration...');
  
  // Read data.json
  const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
  console.log('📄 Loaded data.json');
  
  // Migrate employees
  console.log('👥 Migrating employees...');
  for (const emp of data.employees) {
    const { error } = await supabase.from('employees').insert(emp);
    if (error) console.error('Error inserting employee:', error.message);
  }
  console.log(`✅ Migrated ${data.employees.length} employees`);
  
  // Migrate attendance
  console.log('📋 Migrating attendance records...');
  for (const att of data.attendance) {
    const { error } = await supabase.from('attendance').insert(att);
    if (error) console.error('Error inserting attendance:', error.message);
  }
  console.log(`✅ Migrated ${data.attendance.length} attendance records`);
  
  // Migrate work records
  console.log('💼 Migrating work records...');
  for (const wr of data.workRecords) {
    const { error } = await supabase.from('work_records').insert(wr);
    if (error) console.error('Error inserting work record:', error.message);
  }
  console.log(`✅ Migrated ${data.workRecords.length} work records`);
  
  // Migrate work profiles
  console.log('👤 Migrating work profiles...');
  for (const [key, profile] of Object.entries(data.workProfiles || {})) {
    const [employeeId, month] = key.split(':');
    const { error } = await supabase.from('work_profiles').insert({
      employeeId,
      month,
      fatherName: profile.fatherName
    });
    if (error) console.error('Error inserting work profile:', error.message);
  }
  console.log(`✅ Migrated work profiles`);
  
  // Migrate settings
  console.log('⚙️ Migrating settings...');
  const { error: settingsError } = await supabase.from('settings').upsert({
    id: 'default',
    ...data.settings
  });
  if (settingsError) console.error('Error inserting settings:', settingsError.message);
  console.log(`✅ Migrated settings`);
  
  console.log('\n🎉 Migration complete! Your data is now in Supabase.');
  console.log('📱 Go to your Vercel app and refresh to see your data.');
}

migrate().catch(console.error);
