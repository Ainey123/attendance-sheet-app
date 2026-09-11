const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: att } = await supabase
    .from('attendance')
    .select('*')
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31')
    .order('date', { ascending: true });

  const byEmp = {};
  (att || []).forEach(a => {
    const exp = Number(a.expenseAmount || 0);
    const spent = Number(a.moneySpent || 0);
    const rec = Number(a.receivedAmount || 0);
    const notes = a.performanceNotes || '';
    const img = a.image;
    if (exp > 0 || spent > 0 || rec > 0 || img) {
      const emp = a.employeeName || 'Unknown';
      if (!byEmp[emp]) byEmp[emp] = [];
      byEmp[emp].push({
        id: a.id,
        date: a.date,
        exp,
        spent,
        rec,
        notes,
        hasImg: Boolean(img),
        imgLength: img ? img.length : 0,
        imgData: img
      });
    }
  });

  console.log('--- AUGUST EMPLOYEES SUMMARY ---');
  Object.keys(byEmp).sort().forEach(emp => {
    const totalExp = byEmp[emp].reduce((sum, r) => sum + (r.exp || r.spent), 0);
    const imgCount = byEmp[emp].filter(r => r.hasImg).length;
    console.log(`Employee: ${emp} | Records: ${byEmp[emp].length} | Total Expense: PKR ${totalExp} | Bill Photos: ${imgCount}`);
  });

  fs.writeFileSync('august_bills_extracted.json', JSON.stringify(byEmp, null, 2));
  console.log('\nFull August bill records saved to august_bills_extracted.json');
}

run().catch(console.error);
