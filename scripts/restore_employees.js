// Restore all 13 employees back to Supabase
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// All employees recovered from the attendance CSV reports in Downloads
const employees = [
  { name: 'Muhammad Danish',  role: 'Supervisor' },
  { name: 'Muhammad Ibrahim', role: 'Marketing coordinator' },
  { name: 'Muhammad Asif',    role: 'Senior Tech' },
  { name: 'Muhammad Faisal',  role: 'Tech' },
  { name: 'Muhammad Ali',     role: 'Tech' },
  { name: 'Faisal Bashir',    role: 'Supervisor' },
  { name: 'Ali Shezad',       role: 'Complaint coordinator' },
  { name: 'Asif Rashid',      role: 'Tech' },
  { name: 'Naeem Abbas',      role: 'Data operator' },
  { name: 'Shazaib',          role: 'Data operator' },
  { name: 'hamza',            role: 'Designer' },
  { name: 'fatma',            role: 'Operator' },
  // Keep the current alia who was already there
];

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function main() {
  console.log('🔍 Checking existing employees in Supabase...');
  const { data: existing } = await supabase.from('employees').select('name');
  const existingNames = (existing || []).map(e => e.name.toLowerCase());
  console.log('Existing:', existingNames);

  const toInsert = [];
  for (const emp of employees) {
    if (existingNames.includes(emp.name.toLowerCase())) {
      console.log(`⏭️  Skipping ${emp.name} (already exists)`);
      continue;
    }
    toInsert.push({
      id: generateId('emp'),
      name: emp.name,
      role: emp.role,
      status: 'OUT',
      pin: '1234',
      token: generateToken(),
      dateCreated: new Date().toISOString()
    });
  }

  if (toInsert.length === 0) {
    console.log('✅ All employees already exist!');
    return;
  }

  console.log(`\n📥 Inserting ${toInsert.length} employees...`);
  const { data, error } = await supabase.from('employees').insert(toInsert).select();

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('\n✅ SUCCESS! Employees restored:\n');
  console.log('NAME                      | ROLE                    | PIN  | TOKEN    | LOGIN LINK');
  console.log('--------------------------|-------------------------|------|----------|------------------------');
  for (const emp of data) {
    const link = `${process.env.SUPABASE_URL ? 'https://attendence-sheet-app.vercel.app' : 'http://localhost:3000'}/?token=${emp.token}`;
    console.log(`${emp.name.padEnd(26)}| ${emp.role.padEnd(24)}| ${emp.pin}  | ${emp.token} | ${link}`);
  }
}

main().catch(console.error);
