const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Bank transactions parsed from both PDFs (UBL Account #2121-317846744 & Bank Alfalah Account #00761007345220)
const bankTransactions = [
  // --- UBL PDF DEBITS ---
  { bank: 'UBL', date: '2026-08-01', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-01', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 5000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-01', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-01', rawName: 'SHARAFAT ALI', empKey: 'Sharafat Ali', amount: 8040, type: 'RAAST P2P FT TO SHARAFAT ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-01', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH' },
  { bank: 'UBL', date: '2026-08-02', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 5000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-03', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 10000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-03', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-03', rawName: 'MUHAMMAD ALI HASSAN', empKey: 'Muhammad Ali', amount: 1500, type: 'RAAST P2P FT TO MUHAMMAD ALI HASSAN JAZZCASH' },
  { bank: 'UBL', date: '2026-08-03', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 10000, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-03', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 50000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-04', rawName: 'ALI SHAHZAD', empKey: 'Ali Shehzad', amount: 40000, type: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH' },
  { bank: 'UBL', date: '2026-08-04', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 30000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-04', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 10000, type: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH' },
  { bank: 'UBL', date: '2026-08-05', rawName: 'MUHAMMAD ALI HASSAN', empKey: 'Muhammad Ali', amount: 500, type: 'RAAST P2P FT TO MUHAMMAD ALI HASSAN JAZZCASH' },
  { bank: 'UBL', date: '2026-08-06', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-06', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 5000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-06', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 3000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-06', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 3000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-08', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 5000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-09', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 5000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-09', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 15000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-09', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 5000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-10', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 2000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-11', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 27984, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 41650, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 27088, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 25872, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 50000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 15000, type: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH' },
  { bank: 'UBL', date: '2026-08-12', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 25000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-13', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 2000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-13', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-13', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 2000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-13', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 20000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-14', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 5000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-14', rawName: 'ALI SHAHZAD', empKey: 'Ali Shehzad', amount: 5000, type: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH' },
  { bank: 'UBL', date: '2026-08-14', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 5000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-16', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 3000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-16', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 5000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-17', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 10000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-17', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 3000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-18', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 10000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-19', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 15000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-20', rawName: 'MUHAMMAD ALI HASSAN', empKey: 'Muhammad Ali', amount: 2000, type: 'RAAST P2P FT TO MUHAMMAD ALI HASSAN JAZZCASH' },
  { bank: 'UBL', date: '2026-08-20', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 2000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-20', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 2500, type: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH' },
  { bank: 'UBL', date: '2026-08-20', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 5000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-20', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 2000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-20', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-21', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 5000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-21', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 1500, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-21', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 5000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-21', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 3000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-21', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 11000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-22', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 2000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-22', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 5000, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-22', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 10000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-22', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-23', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 30000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-24', rawName: 'ALI SHAHZAD', empKey: 'Ali Shehzad', amount: 2000, type: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH' },
  { bank: 'UBL', date: '2026-08-24', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 2000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-24', rawName: 'MUHAMMAD DANISH ALI', empKey: 'Muhammad Danish', amount: 13350, type: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA' },
  { bank: 'UBL', date: '2026-08-24', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 5000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-25', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-25', rawName: 'HAFIZ MUHAMMAD ISLAM', empKey: 'Sarmad Islam', amount: 1700, type: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA' },
  { bank: 'UBL', date: '2026-08-27', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 10000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-28', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 3000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-28', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 5000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-28', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA' },
  { bank: 'UBL', date: '2026-08-28', rawName: 'ASIF RASHEED', empKey: 'Asif Rashid', amount: 5000, type: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH' },
  { bank: 'UBL', date: '2026-08-29', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 20000, type: 'INTERNAL FUNDS TRANSFER TO REHMAN ALI' },
  { bank: 'UBL', date: '2026-08-29', rawName: 'ALI SHAHZAD', empKey: 'Ali Shehzad', amount: 2500, type: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH' },
  { bank: 'UBL', date: '2026-08-29', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 5000, type: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH' },
  { bank: 'UBL', date: '2026-08-29', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 5000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-31', rawName: 'FES FAISAL ELEC VEHA', empKey: 'Muhammad Faisal', amount: 5000, type: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH' },
  { bank: 'UBL', date: '2026-08-31', rawName: 'ALI SHAHZAD', empKey: 'Ali Shehzad', amount: 40000, type: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH' },

  // --- BANK ALFALAH PDF DEBITS ---
  { bank: 'Bank Alfalah', date: '2026-08-05', rawName: 'SHARAFAT ALI', empKey: 'Sharafat Ali', amount: 2000, type: 'IBFT To SHARAFAT ALI JazzCash' },
  { bank: 'Bank Alfalah', date: '2026-08-05', rawName: 'SAJID ALI', empKey: 'Sajid Ali', amount: 1640, type: 'IBFT To SAJID ALI JazzCash' },
  { bank: 'Bank Alfalah', date: '2026-08-07', rawName: 'MUHAMMAD ASIF', empKey: 'Muhammad Asif', amount: 3000, type: 'IBFT To MUHAMMAD ASIF Easypaisa' },
  { bank: 'Bank Alfalah', date: '2026-08-07', rawName: 'REHMAN ALI', empKey: 'Rehman Ali', amount: 5000, type: 'IBFT To REHMAN ALI United Bank Limited' },
  { bank: 'Bank Alfalah', date: '2026-08-07', rawName: 'MUHAMMAD ALI', empKey: 'Muhammad Ali', amount: 5000, type: 'IBFT To MUHAMMAD ALI JazzCash' },
  { bank: 'Bank Alfalah', date: '2026-08-13', rawName: 'SHAH ZAIB NAWAZ', empKey: 'Shahzaib', amount: 10000, type: 'IBFT To SHAH ZAIB NAWAZ Easypaisa' },
  { bank: 'Bank Alfalah', date: '2026-08-19', rawName: 'SHAH ZAIB NAWAZ', empKey: 'Shahzaib', amount: 20800, type: 'IBFT To SHAH ZAIB NAWAZ Easypaisa' },
  { bank: 'Bank Alfalah', date: '2026-08-24', rawName: 'MUHAMMAD IMRAN', empKey: 'Muhammad Imran', amount: 3000, type: 'IBFT To MUHAMMAD IMRAN Easypaisa' },
  { bank: 'Bank Alfalah', date: '2026-08-25', rawName: 'MUHAMMAD RAFEEQ', empKey: 'Muhammad Rafeeq', amount: 2100, type: 'IBFT To MUHAMMAD RAFEEQ JazzCash' },
  { bank: 'Bank Alfalah', date: '2026-08-27', rawName: 'MUHAMMAD IBRAHIM', empKey: 'Muhammad Ibrahim', amount: 48273, type: 'IBFT To MUHAMMAD IBRAHIM Meezan Bank' }
];

// Display name formatting helper (Proper Case / Upper + Lower case)
function toProperCase(str) {
  if (!str) return '';
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Custom aliases for heading display
const nameAliases = {
  'Sarmad Islam': 'Sarmad Islam (Bank Name: Hafiz Muhammad Islam)',
  'Shahzaib': 'Shahzaib (Bank Name: Shah Zaib Nawaz)',
  'Ali Shehzad': 'Ali Shehzad (Bank Name: Ali Shahzad)',
  'Asif Rashid': 'Asif Rashid (Bank Name: Asif Rasheed)',
  'Muhammad Faisal': 'Muhammad Faisal (Bank Name: FES Faisal Elec Veha)'
};

async function buildCrossCheckReport() {
  console.log('Cross-checking App Expenses with Bank Statement Debits & Calculating Differences...');

  // Fetch App attendance expenses
  const { data: att } = await supabase
    .from('attendance')
    .select('*')
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31')
    .order('date', { ascending: true });

  // Map app records by standardized employee name
  const appExpenses = {};
  (att || []).forEach(a => {
    const exp = Number(a.expenseAmount || 0);
    const spent = Number(a.moneySpent || 0);
    const rec = Number(a.receivedAmount || 0);
    const notes = (a.performanceNotes || '').trim();
    const img = a.image;

    if (exp > 0 || spent > 0 || rec > 0 || notes || img) {
      const empRaw = (a.employeeName || 'Unknown').trim();
      let empKey = empRaw;
      if (empRaw.toLowerCase().includes('sarmad')) empKey = 'Sarmad Islam';
      else if (empRaw.toLowerCase().includes('shahzaib')) empKey = 'Shahzaib';
      else if (empRaw.toLowerCase().includes('shehzad') || empRaw.toLowerCase().includes('shezad')) empKey = 'Ali Shehzad';
      else if (empRaw.toLowerCase().includes('asif rashid') || empRaw.toLowerCase().includes('asif rasheed')) empKey = 'Asif Rashid';
      else if (empRaw.toLowerCase().includes('faisal')) empKey = 'Muhammad Faisal';
      else if (empRaw.toLowerCase().includes('asif') && !empRaw.toLowerCase().includes('rashid')) empKey = 'Muhammad Asif';
      else if (empRaw.toLowerCase().includes('danish')) empKey = 'Muhammad Danish';
      else if (empRaw.toLowerCase().includes('rehman')) empKey = 'Rehman Ali';
      else if (empRaw.toLowerCase().includes('ali') && !empRaw.toLowerCase().includes('rehman') && !empRaw.toLowerCase().includes('shehzad')) empKey = 'Muhammad Ali';

      if (!appExpenses[empKey]) appExpenses[empKey] = [];
      appExpenses[empKey].push({
        date: a.date,
        exp: exp || spent,
        rec: rec,
        notes: notes || 'Daily Work / Expense Mentioned',
        image: img || null
      });
    }
  });

  // Group bank transactions by employee key
  const bankByEmp = {};
  bankTransactions.forEach(t => {
    if (!bankByEmp[t.empKey]) bankByEmp[t.empKey] = [];
    bankByEmp[t.empKey].push(t);
  });

  // Combine all employee keys
  const allEmpKeys = Array.from(new Set([...Object.keys(appExpenses), ...Object.keys(bankByEmp)])).sort();

  let grandAppExpense = 0;
  let grandBankDebit = 0;

  allEmpKeys.forEach(empKey => {
    const appList = appExpenses[empKey] || [];
    const bankList = bankByEmp[empKey] || [];
    grandAppExpense += appList.reduce((s, r) => s + r.exp, 0);
    grandBankDebit += bankList.reduce((s, r) => s + r.amount, 0);
  });

  const grandDifference = grandBankDebit - grandAppExpense;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>August 2026 - Cross-Checked Employee Expenses & Bank Debits Report</title>
  <style>
    @media print {
      body { background: #fff !important; color: #000 !important; font-size: 10pt; }
      .no-print { display: none !important; }
      .employee-section { page-break-before: always; border: 1px solid #ccc !important; background: #fff !important; color: #000 !important; }
      .employee-section:first-of-type { page-break-before: avoid; }
      .bank-table, .app-table { background: #fff !important; color: #000 !important; }
      th { background: #e2e8f0 !important; color: #000 !important; }
      td { border-color: #cbd5e1 !important; color: #000 !important; }
    }
    * { box-sizing: border-box; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0f172a; color: #f8fafc; margin: 0; padding: 25px; font-size: 13px; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    
    .print-actions { display: flex; gap: 15px; justify-content: flex-end; margin-bottom: 20px; }
    .btn { padding: 10px 20px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-primary:hover { background: #4338ca; }

    .report-header { text-align: center; border-bottom: 2px solid #334155; padding-bottom: 20px; margin-bottom: 25px; }
    .report-header h1 { margin: 0 0 5px 0; color: #818cf8; font-size: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
    .report-header h2 { margin: 0 0 10px 0; color: #f8fafc; font-size: 17px; font-weight: 500; }
    .report-header p { margin: 0; color: #94a3b8; font-size: 13px; }

    .grand-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .g-card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center; }
    .g-card .g-val { font-size: 20px; font-weight: 700; margin-top: 5px; }
    .g-card .g-lbl { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }

    .employee-section { margin-bottom: 45px; border: 1px solid #334155; border-radius: 10px; overflow: hidden; background: #1e293b; }
    .employee-header { background: linear-gradient(135deg, #1e1b4b, #312e81); padding: 16px 22px; border-bottom: 1px solid #4338ca; display: flex; justify-content: space-between; align-items: center; }
    .employee-title { font-size: 19px; font-weight: 700; color: #fff; margin: 0; }
    
    .emp-summary-bar { background: #0f172a; padding: 12px 20px; border-bottom: 1px solid #334155; display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-around; font-size: 13px; }
    .emp-summary-item { text-align: center; }
    .emp-summary-item strong { display: block; font-size: 15px; margin-top: 2px; }

    .sub-heading { background: #1e293b; padding: 10px 18px; font-size: 13.5px; font-weight: 700; color: #a5b4fc; border-bottom: 1px solid #334155; border-top: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }

    table { width: 100%; border-collapse: collapse; text-align: left; margin-bottom: 0; }
    th { background: #0f172a; color: #94a3b8; padding: 10px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #334155; }
    td { padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 12.5px; vertical-align: top; }
    tr:nth-child(even) { background: rgba(15, 23, 42, 0.3); }

    .badge-debit { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 11px; }
    .badge-app { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 11px; }
    .badge-rec { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 11px; }
    .badge-diff-positive { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; }
    .badge-diff-negative { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; }
    .bank-tag { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; background: #334155; color: #cbd5e1; }

    .bill-img { max-width: 170px; max-height: 170px; border-radius: 6px; border: 1px solid #475569; margin-top: 6px; display: block; object-fit: cover; }
  </style>
</head>
<body>

  <div class="container">
    <div class="print-actions no-print">
      <button onclick="window.print()" class="btn btn-primary">
        🖨️ Print / Save as PDF
      </button>
    </div>

    <div class="report-header">
      <h1>Fast Engineering Solutions</h1>
      <h2>AUGUST 2026 — EMPLOYEE EXPENSES & BANK STATEMENTS DIFFERENCE REPORT</h2>
      <p>Cross-referenced from System Daily App Logs vs UBL Account #2121-317846744 & Bank Alfalah Account #00761007345220 PDFs</p>
    </div>

    <div class="grand-summary">
      <div class="g-card">
        <div class="g-lbl">Total App Expenses Claimed</div>
        <div class="g-val" style="color: #38bdf8;">PKR ${grandAppExpense.toLocaleString()}</div>
      </div>
      <div class="g-card">
        <div class="g-lbl">Total Bank Transfers Sent</div>
        <div class="g-val" style="color: #f87171;">PKR ${grandBankDebit.toLocaleString()}</div>
      </div>
      <div class="g-card">
        <div class="g-lbl">Overall Net Difference</div>
        <div class="g-val" style="color: ${grandDifference >= 0 ? '#34d399' : '#f87171'};">
          ${grandDifference >= 0 ? '+' : ''}PKR ${grandDifference.toLocaleString()}
          <span style="font-size:11px; display:block; font-weight:400; color:#94a3b8;">(${grandDifference >= 0 ? 'Bank Sent > App Expense' : 'App Expense > Bank Sent'})</span>
        </div>
      </div>
    </div>
`;

  allEmpKeys.forEach((empKey, index) => {
    const formattedName = toProperCase(empKey);
    const aliasTitle = nameAliases[empKey] || formattedName;
    const appList = appExpenses[empKey] || [];
    const bankList = bankByEmp[empKey] || [];

    const totalAppExp = appList.reduce((s, r) => s + r.exp, 0);
    const totalBankDebit = bankList.reduce((s, r) => s + r.amount, 0);
    const diff = totalBankDebit - totalAppExp;

    html += `
    <div class="employee-section">
      <div class="employee-header">
        <div>
          <span class="employee-title">${index + 1}. ${aliasTitle}</span>
        </div>
      </div>

      <div class="emp-summary-bar">
        <div class="emp-summary-item">
          <span style="color:#94a3b8; font-size:11px; text-transform:uppercase;">App Claimed Expenses</span>
          <strong style="color:#38bdf8;">PKR ${totalAppExp.toLocaleString()}</strong>
        </div>
        <div class="emp-summary-item">
          <span style="color:#94a3b8; font-size:11px; text-transform:uppercase;">Bank Debits Sent</span>
          <strong style="color:#f87171;">PKR ${totalBankDebit.toLocaleString()}</strong>
        </div>
        <div class="emp-summary-item">
          <span style="color:#94a3b8; font-size:11px; text-transform:uppercase;">Difference (Bank - App)</span>
          <strong style="color: ${diff >= 0 ? '#34d399' : '#f87171'};">
            ${diff >= 0 ? '+' : ''}PKR ${diff.toLocaleString()}
            <span style="font-size:11px; font-weight:400; display:inline;">(${diff >= 0 ? 'Surplus / Advance' : 'Pending Claim'})</span>
          </strong>
        </div>
      </div>

      <!-- 1. DATES & MENTIONED EXPENSES FROM APP -->
      <div class="sub-heading">
        <span>📝 1. App Mentioned Expenses & Attached Bill Receipts (${appList.length} Logged Dates)</span>
        <span style="font-size: 12px; color: #cbd5e1;">Total App Expense: PKR ${totalAppExp.toLocaleString()}</span>
      </div>
`;

    if (appList.length === 0) {
      html += `<div style="padding: 12px 18px; color: #94a3b8; font-style: italic;">No daily app expenses or bill receipts logged for this employee in August.</div>`;
    } else {
      html += `
      <table>
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 14%;">Logged Date</th>
            <th style="width: 18%;">Claimed Expense</th>
            <th style="width: 18%;">Received Amount</th>
            <th style="width: 25%;">Work Description & Notes</th>
            <th style="width: 20%;">Attached Bill Receipt</th>
          </tr>
        </thead>
        <tbody>
`;
      appList.forEach((a, aIdx) => {
        html += `
          <tr>
            <td><strong>${aIdx + 1}</strong></td>
            <td><strong>${a.date}</strong></td>
            <td><span class="badge-app">PKR ${a.exp.toLocaleString()}</span></td>
            <td><span class="badge-rec">PKR ${a.rec.toLocaleString()}</span></td>
            <td>${a.notes}</td>
            <td>
              ${a.image ? `<img src="${a.image}" class="bill-img" alt="Bill Photo ${a.date}" />` : `<span style="color:#64748b; font-size:11px;">No image attached</span>`}
            </td>
          </tr>
`;
      });
      html += `</tbody></table>`;
    }

    // 2. DATES & DEBIT TRANSACTIONS FROM BANK PDFS
    html += `
      <!-- 2. DATES & DEBIT TRANSACTIONS IN BANK STATEMENT PDFS -->
      <div class="sub-heading">
        <span>🏦 2. Bank Statement Transfers / Debits (${bankList.length} Transactions)</span>
        <span style="font-size: 12px; color: #cbd5e1;">Total Bank Paid: PKR ${totalBankDebit.toLocaleString()}</span>
      </div>
`;

    if (bankList.length === 0) {
      html += `<div style="padding: 12px 18px; color: #94a3b8; font-style: italic;">No direct bank statement debits found in UBL or Bank Alfalah statements for this employee in August.</div>`;
    } else {
      html += `
      <table>
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 14%;">Bank Date</th>
            <th style="width: 14%;">Bank Source</th>
            <th style="width: 18%;">Debit Amount</th>
            <th style="width: 49%;">Transaction Description / Account Details</th>
          </tr>
        </thead>
        <tbody>
`;
      bankList.forEach((b, bIdx) => {
        html += `
          <tr>
            <td><strong>${bIdx + 1}</strong></td>
            <td><strong>${b.date}</strong></td>
            <td><span class="bank-tag">${b.bank}</span></td>
            <td><span class="badge-debit">PKR ${b.amount.toLocaleString()}</span></td>
            <td>${b.type}</td>
          </tr>
`;
      });
      html += `</tbody></table>`;
    }

    html += `</div>`;
  });

  html += `
  </div>
</body>
</html>
`;

  const outputPath = path.join(__dirname, '..', 'public', 'August_2026_Cross_Checked_Employee_Bills.html');
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`\n✅ Difference cross-checked report successfully created at: ${outputPath}`);
}

buildCrossCheckReport().catch(console.error);
