const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Complete Parsed Bank Debit Transactions from UBL & Bank Alfalah Statements (August 2026)
const bankTransactions = [
  // --- UBL DEBITS ---
  { bank: 'UBL', date: '01-Aug-2026', empKey: 'Muhammad Danish', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL010826125823312120455)' },
  { bank: 'UBL', date: '01-Aug-2026', empKey: 'Sarmad Islam', amount: 5000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL010826051523940084539)' },
  { bank: 'UBL', date: '01-Aug-2026', empKey: 'Muhammad Asif', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL010826055816817-031424)' },
  { bank: 'UBL', date: '01-Aug-2026', empKey: 'Asif Rashid', amount: 8040, desc: 'RAAST P2P FT TO SHARAFAT ALI JAZZCASH (MSGID: UBL010826073551790-085586)' },
  { bank: 'UBL', date: '01-Aug-2026', empKey: 'Muhammad Asif', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH (MSGID: UBL010826084709708-280648)' },
  { bank: 'UBL', date: '02-Aug-2026', empKey: 'Rehman Ali', amount: 5000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '03-Aug-2026', empKey: 'Asif Rashid', amount: 10000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL030826110425182-733824)' },
  { bank: 'UBL', date: '03-Aug-2026', empKey: 'Muhammad Danish', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL030826031751878650261)' },
  { bank: 'UBL', date: '03-Aug-2026', empKey: 'Muhammad Ali', amount: 1500, desc: 'RAAST P2P FT TO MUHAMMAD ALI HASSAN JAZZCASH (MSGID: UBL030826031927494313763)' },
  { bank: 'UBL', date: '03-Aug-2026', empKey: 'Muhammad Danish', amount: 10000, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL030826072853341196048)' },
  { bank: 'UBL', date: '03-Aug-2026', empKey: 'Rehman Ali', amount: 50000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '04-Aug-2026', empKey: 'Ali Shehzad', amount: 40000, desc: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH (MSGID: UBL040826105127346-541407)' },
  { bank: 'UBL', date: '04-Aug-2026', empKey: 'Asif Rashid', amount: 30000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL040826105214938-761134)' },
  { bank: 'UBL', date: '04-Aug-2026', empKey: 'Muhammad Asif', amount: 10000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH (MSGID: UBL040826110857945-722788)' },
  { bank: 'UBL', date: '05-Aug-2026', empKey: 'Muhammad Ali', amount: 500, desc: 'RAAST P2P FT TO MUHAMMAD ALI HASSAN JAZZCASH (MSGID: UBL050826014604510786974)' },
  { bank: 'UBL', date: '06-Aug-2026', empKey: 'Muhammad Danish', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL060826101633519723960)' },
  { bank: 'UBL', date: '06-Aug-2026', empKey: 'Muhammad Faisal', amount: 5000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL060826101726444-939774)' },
  { bank: 'UBL', date: '06-Aug-2026', empKey: 'Muhammad Asif', amount: 3000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL060826010715612-280476)' },
  { bank: 'UBL', date: '06-Aug-2026', empKey: 'Muhammad Asif', amount: 3000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL060826020924005-016629)' },
  { bank: 'UBL', date: '08-Aug-2026', empKey: 'Muhammad Faisal', amount: 5000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL080826095305870726228)' },
  { bank: 'UBL', date: '09-Aug-2026', empKey: 'Asif Rashid', amount: 5000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL090826103443775-050087)' },
  { bank: 'UBL', date: '09-Aug-2026', empKey: 'Rehman Ali', amount: 15000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '09-Aug-2026', empKey: 'Rehman Ali', amount: 5000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '10-Aug-2026', empKey: 'Muhammad Asif', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL100826032714287-225279)' },
  { bank: 'UBL', date: '11-Aug-2026', empKey: 'Muhammad Danish', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL110826113119794460731)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Muhammad Faisal', amount: 27984, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL120826020809454932092)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Muhammad Danish', amount: 41650, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL120826020922959297043)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Asif Rashid', amount: 27088, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL120826021050194-033002)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Muhammad Asif', amount: 25872, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL120826021210019-890855)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Rehman Ali', amount: 50000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Muhammad Asif', amount: 15000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH (MSGID: UBL120826025419735-452905)' },
  { bank: 'UBL', date: '12-Aug-2026', empKey: 'Sarmad Islam', amount: 25000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL120826081430886950062)' },
  { bank: 'UBL', date: '13-Aug-2026', empKey: 'Muhammad Asif', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL130826011612622-764288)' },
  { bank: 'UBL', date: '13-Aug-2026', empKey: 'Muhammad Ali', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL130826041239644-789000)' },
  { bank: 'UBL', date: '13-Aug-2026', empKey: 'Muhammad Ali', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL130826042616386-487449)' },
  { bank: 'UBL', date: '13-Aug-2026', empKey: 'Asif Rashid', amount: 20000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL130826051611913439163)' },
  { bank: 'UBL', date: '14-Aug-2026', empKey: 'Rehman Ali', amount: 5000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '14-Aug-2026', empKey: 'Ali Shehzad', amount: 5000, desc: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH (MSGID: UBL140826123658155-928004)' },
  { bank: 'UBL', date: '14-Aug-2026', empKey: 'Sarmad Islam', amount: 5000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL140826123835002090513)' },
  { bank: 'UBL', date: '16-Aug-2026', empKey: 'Muhammad Asif', amount: 3000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL160826033324253-613339)' },
  { bank: 'UBL', date: '16-Aug-2026', empKey: 'Asif Rashid', amount: 5000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL160826080605276-486443)' },
  { bank: 'UBL', date: '17-Aug-2026', empKey: 'Muhammad Faisal', amount: 10000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL170826071112998-271350)' },
  { bank: 'UBL', date: '17-Aug-2026', empKey: 'Sarmad Islam', amount: 3000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL170826071521764421139)' },
  { bank: 'UBL', date: '18-Aug-2026', empKey: 'Muhammad Asif', amount: 10000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL180826093611934-157476)' },
  { bank: 'UBL', date: '19-Aug-2026', empKey: 'Asif Rashid', amount: 15000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL190826090011313-902731)' },
  { bank: 'UBL', date: '20-Aug-2026', empKey: 'Muhammad Ali', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD ALI HASSAN JAZZCASH (MSGID: UBL200826115444903236507)' },
  { bank: 'UBL', date: '20-Aug-2026', empKey: 'Muhammad Asif', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL200826041802606-161652)' },
  { bank: 'UBL', date: '20-Aug-2026', empKey: 'Muhammad Asif', amount: 2500, desc: 'RAAST P2P FT TO MUHAMMAD ASIF JAZZCASH (MSGID: UBL200826042652583-533898)' },
  { bank: 'UBL', date: '20-Aug-2026', empKey: 'Muhammad Faisal', amount: 5000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL200826043453817-781735)' },
  { bank: 'UBL', date: '20-Aug-2026', empKey: 'Sarmad Islam', amount: 2000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL200826052506470579138)' },
  { bank: 'UBL', date: '20-Aug-2026', empKey: 'Muhammad Ali', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL200826090340976-936443)' },
  { bank: 'UBL', date: '21-Aug-2026', empKey: 'Asif Rashid', amount: 5000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL210826065943230-128093)' },
  { bank: 'UBL', date: '21-Aug-2026', empKey: 'Sarmad Islam', amount: 1500, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL210826115518370053889)' },
  { bank: 'UBL', date: '21-Aug-2026', empKey: 'Sarmad Islam', amount: 5000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL210826125439074648741)' },
  { bank: 'UBL', date: '21-Aug-2026', empKey: 'Rehman Ali', amount: 3000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '21-Aug-2026', empKey: 'Sarmad Islam', amount: 11000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL210826032431224143064)' },
  { bank: 'UBL', date: '22-Aug-2026', empKey: 'Sarmad Islam', amount: 2000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL220826122618287928993)' },
  { bank: 'UBL', date: '22-Aug-2026', empKey: 'Sarmad Islam', amount: 5000, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL220826033309188577826)' },
  { bank: 'UBL', date: '22-Aug-2026', empKey: 'Muhammad Faisal', amount: 10000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL220826050743518-826135)' },
  { bank: 'UBL', date: '22-Aug-2026', empKey: 'Muhammad Ali', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL220826063743159-612702)' },
  { bank: 'UBL', date: '23-Aug-2026', empKey: 'Muhammad Faisal', amount: 30000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL230826063156106-961425)' },
  { bank: 'UBL', date: '24-Aug-2026', empKey: 'Ali Shehzad', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD TAUSEEF JAZZCASH (MSGID: UBL240826122345944936804)' },
  { bank: 'UBL', date: '24-Aug-2026', empKey: 'Muhammad Asif', amount: 2000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL240826040800940-052746)' },
  { bank: 'UBL', date: '24-Aug-2026', empKey: 'Muhammad Danish', amount: 13350, desc: 'RAAST P2P FT TO MUHAMMAD DANISH ALI EASYPAISA (MSGID: UBL240826070052617428925)' },
  { bank: 'UBL', date: '24-Aug-2026', empKey: 'Muhammad Faisal', amount: 5000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL240826070245755-430002)' },
  { bank: 'UBL', date: '25-Aug-2026', empKey: 'Muhammad Ali', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL250826085452735-044151)' },
  { bank: 'UBL', date: '25-Aug-2026', empKey: 'Sarmad Islam', amount: 1700, desc: 'RAAST P2P FT TO HAFIZ MUHAMMAD ISLAM EASYPAISA (MSGID: UBL250826124845402591421)' },
  { bank: 'UBL', date: '27-Aug-2026', empKey: 'Muhammad Ali', amount: 10000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL270826040913145-853971)' },
  { bank: 'UBL', date: '28-Aug-2026', empKey: 'Muhammad Faisal', amount: 3000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL280826084837383-506281)' },
  { bank: 'UBL', date: '28-Aug-2026', empKey: 'Asif Rashid', amount: 5000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL280826100610224-567457)' },
  { bank: 'UBL', date: '28-Aug-2026', empKey: 'Muhammad Asif', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ASIF EASYPAISA (MSGID: UBL280826050451716-239439)' },
  { bank: 'UBL', date: '28-Aug-2026', empKey: 'Asif Rashid', amount: 5000, desc: 'RAAST P2P FT TO ASIF RASHEED JAZZCASH (MSGID: UBL280826074254338-911003)' },
  { bank: 'UBL', date: '29-Aug-2026', empKey: 'Rehman Ali', amount: 20000, desc: 'UBL DIGITAL:INTERNAL FUNDS TRANSFER TO REHMAN ALI (A/C 0003****9374)' },
  { bank: 'UBL', date: '29-Aug-2026', empKey: 'Ali Shehzad', amount: 2500, desc: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH (MSGID: UBL290826033026518-593897)' },
  { bank: 'UBL', date: '29-Aug-2026', empKey: 'Muhammad Ali', amount: 5000, desc: 'RAAST P2P FT TO MUHAMMAD ALI JAZZCASH (MSGID: UBL290826035547435-042469)' },
  { bank: 'UBL', date: '29-Aug-2026', empKey: 'Muhammad Faisal', amount: 5000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL290826040159266767074)' },
  { bank: 'UBL', date: '31-Aug-2026', empKey: 'Muhammad Faisal', amount: 5000, desc: 'RAAST P2P FT TO FES FAISAL ELEC VEHA JAZZCASH (MSGID: UBL310826020810514-370808)' },
  { bank: 'UBL', date: '31-Aug-2026', empKey: 'Ali Shehzad', amount: 40000, desc: 'RAAST P2P FT TO ALI SHAHZAD JAZZCASH (MSGID: UBL310826064838545-296214)' },

  // --- BANK ALFALAH DEBITS ---
  { bank: 'Bank Alfalah', date: '05-Aug-2026', empKey: 'Asif Rashid', amount: 2000, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To SHARAFAT ALI - JazzCash/Mobilink' },
  { bank: 'Bank Alfalah', date: '05-Aug-2026', empKey: 'Sajid Ali', amount: 1640, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To SAJID ALI - JazzCash/Mobilink' },
  { bank: 'Bank Alfalah', date: '07-Aug-2026', empKey: 'Muhammad Asif', amount: 3000, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To MUHAMMAD ASIF - Easypaisa/Telenor' },
  { bank: 'Bank Alfalah', date: '07-Aug-2026', empKey: 'Rehman Ali', amount: 5000, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To REHMAN ALI - United Bank Limited' },
  { bank: 'Bank Alfalah', date: '07-Aug-2026', empKey: 'Muhammad Ali', amount: 5000, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To MUHAMMAD ALI - JazzCash/Mobilink' },
  { bank: 'Bank Alfalah', date: '13-Aug-2026', empKey: 'Shahzaib', amount: 10000, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To SHAH ZAIB NAWAZ - Easypaisa/Telenor' },
  { bank: 'Bank Alfalah', date: '19-Aug-2026', empKey: 'Shahzaib', amount: 20800, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To SHAH ZAIB NAWAZ - Easypaisa/Telenor' },
  { bank: 'Bank Alfalah', date: '24-Aug-2026', empKey: 'Muhammad Imran', amount: 3000, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To MUHAMMAD IMRAN - Easypaisa/Telenor' },
  { bank: 'Bank Alfalah', date: '25-Aug-2026', empKey: 'Muhammad Rafeeq', amount: 2100, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To MUHAMMAD RAFEEQ - JazzCash/Mobilink' },
  { bank: 'Bank Alfalah', date: '27-Aug-2026', empKey: 'Muhammad Ibrahim', amount: 48273, desc: 'IBFT From FAST ENGINEERING SOLUTIONS To MUHAMMAD IBRAHIM - Meezan Bank Limited' }
];

// Display name aliases (Upper & Lower case + Bank Name Mapping)
const nameAliases = {
  'Sarmad Islam': 'Sarmad Islam (Bank Account: Hafiz Muhammad Islam)',
  'Shahzaib': 'Shahzaib (Bank Account: Shah Zaib Nawaz)',
  'Ali Shehzad': 'Ali Shehzad (Bank Account: Ali Shahzad)',
  'Asif Rashid': 'Asif Rashid (Bank Account: Asif Rasheed / Sharafat Ali)',
  'Muhammad Faisal': 'Muhammad Faisal (Bank Account: FES Faisal Elec Veha)'
};

function toProperCase(str) {
  if (!str) return '';
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

async function buildCompactBankReport() {
  console.log('Generating Compact Bank Statements PDF Report...');

  // Fetch App attendance expenses to compute summary claims per employee
  const { data: att } = await supabase
    .from('attendance')
    .select('*')
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31');

  const appExpensesMap = {};
  (att || []).forEach(a => {
    const exp = Number(a.expenseAmount || 0);
    const spent = Number(a.moneySpent || 0);
    if (exp > 0 || spent > 0) {
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

      if (!appExpensesMap[empKey]) appExpensesMap[empKey] = 0;
      appExpensesMap[empKey] += (exp || spent);
    }
  });

  // Group bank transactions by employee key
  const bankByEmp = {};
  bankTransactions.forEach(t => {
    if (!bankByEmp[t.empKey]) bankByEmp[t.empKey] = [];
    bankByEmp[t.empKey].push(t);
  });

  const allEmpKeys = Array.from(new Set([...Object.keys(bankByEmp), ...Object.keys(appExpensesMap)])).sort();

  let totalGrandBankPaid = 0;
  let totalGrandAppClaimed = 0;

  allEmpKeys.forEach(k => {
    const bList = bankByEmp[k] || [];
    totalGrandBankPaid += bList.reduce((s, x) => s + x.amount, 0);
    totalGrandAppClaimed += (appExpensesMap[k] || 0);
  });

  const totalGrandDiff = totalGrandBankPaid - totalGrandAppClaimed;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>August 2026 - Employee Bank Statement Transfers & Claims Summary</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    @media print {
      body { background: #fff !important; color: #000 !important; font-size: 9pt; }
      .no-print { display: none !important; }
      .emp-card { break-inside: avoid; border: 1px solid #cbd5e1 !important; background: #fff !important; color: #000 !important; margin-bottom: 12px !important; }
      .emp-head { background: #1e293b !important; color: #fff !important; -webkit-print-color-adjust: exact; }
      .summary-box { background: #f8fafc !important; border-color: #cbd5e1 !important; color: #000 !important; }
      th { background: #e2e8f0 !important; color: #000 !important; }
      td { border-color: #cbd5e1 !important; color: #000 !important; }
    }
    * { box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; }
    body { background: #0f172a; color: #f8fafc; margin: 0; padding: 15px; font-size: 12px; line-height: 1.35; }
    .container { max-width: 1000px; margin: 0 auto; background: #1e293b; padding: 20px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    
    .print-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; background: #0f172a; padding: 10px 15px; border-radius: 8px; border: 1px solid #334155; }
    .btn-print { background: #4f46e5; color: #fff; border: none; padding: 8px 16px; font-weight: 700; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
    .btn-print:hover { background: #4338ca; }

    .header-box { text-align: center; border-bottom: 2px solid #334155; padding-bottom: 12px; margin-bottom: 15px; }
    .header-box h1 { margin: 0; color: #818cf8; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px; }
    .header-box h2 { margin: 4px 0 2px 0; color: #f8fafc; font-size: 15px; font-weight: 600; }
    .header-box p { margin: 0; color: #94a3b8; font-size: 11.5px; }

    .grand-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 15px; }
    .g-item { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; text-align: center; }
    .g-item .val { font-size: 16px; font-weight: 700; margin-top: 2px; }
    .g-item .lbl { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }

    .emp-card { border: 1px solid #334155; border-radius: 8px; margin-bottom: 14px; overflow: hidden; background: #1e293b; }
    .emp-head { background: linear-gradient(135deg, #1e1b4b, #312e81); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #4338ca; }
    .emp-name { font-size: 15px; font-weight: 700; color: #fff; }
    
    .summary-box { background: #0f172a; padding: 8px 14px; display: flex; justify-content: space-around; border-bottom: 1px solid #334155; font-size: 11.5px; }
    .s-box-item strong { display: block; font-size: 13px; margin-top: 1px; }

    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: #0f172a; color: #94a3b8; padding: 7px 10px; font-size: 10px; text-transform: uppercase; border-bottom: 1px solid #334155; }
    td { padding: 7px 10px; border-bottom: 1px solid #334155; font-size: 11.5px; vertical-align: middle; }
    tr:nth-child(even) { background: rgba(15, 23, 42, 0.3); }

    .badge-debit { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px; }
    .tag-bank { background: #334155; color: #cbd5e1; padding: 2px 5px; border-radius: 3px; font-size: 9.5px; font-weight: 700; }
  </style>
</head>
<body>

  <div class="container">
    <div class="print-bar no-print">
      <span style="font-weight: 600; color: #a5b4fc;">📄 August 2026 Bank Statements & Claim Summary Report</span>
      <button onclick="window.print()" class="btn-print">
        🖨️ Print / Save Small PDF
      </button>
    </div>

    <div class="header-box">
      <h1>Fast Engineering Solutions</h1>
      <h2>AUGUST 2026 — EMPLOYEE BANK STATEMENT TRANSFERS & CLAIMS SUMMARY</h2>
      <p>Source: UBL Account #2121-317846744 & Bank Alfalah Account #00761007345220 PDF Statements</p>
    </div>

    <div class="grand-summary">
      <div class="g-item">
        <div class="lbl">Total Bank Paid (PDFs)</div>
        <div class="val" style="color: #f87171;">PKR ${totalGrandBankPaid.toLocaleString()}</div>
      </div>
      <div class="g-item">
        <div class="lbl">Total App Claims</div>
        <div class="val" style="color: #38bdf8;">PKR ${totalGrandAppClaimed.toLocaleString()}</div>
      </div>
      <div class="g-item">
        <div class="lbl">Net Surplus Difference</div>
        <div class="val" style="color: ${totalGrandDiff >= 0 ? '#34d399' : '#f87171'};">
          ${totalGrandDiff >= 0 ? '+' : ''}PKR ${totalGrandDiff.toLocaleString()}
        </div>
      </div>
    </div>
`;

  allEmpKeys.forEach((empKey, idx) => {
    const formattedName = toProperCase(empKey);
    const aliasTitle = nameAliases[empKey] || formattedName;
    const bList = bankByEmp[empKey] || [];
    const appClaim = appExpensesMap[empKey] || 0;
    const totalPaid = bList.reduce((s, x) => s + x.amount, 0);
    const diff = totalPaid - appClaim;

    html += `
    <div class="emp-card">
      <div class="emp-head">
        <span class="emp-name">${idx + 1}. ${aliasTitle}</span>
        <span style="font-size: 12px; color: #a5b4fc; font-weight:600;">${bList.length} Bank Transactions</span>
      </div>

      <!-- CLAIM & BANK SUMMARY BOX -->
      <div class="summary-box">
        <div class="s-box-item">
          <span style="color:#94a3b8;">Total Bank Transfers Paid:</span>
          <strong style="color:#f87171;">PKR ${totalPaid.toLocaleString()}</strong>
        </div>
        <div class="s-box-item">
          <span style="color:#94a3b8;">Total App Claims Mentioned:</span>
          <strong style="color:#38bdf8;">PKR ${appClaim.toLocaleString()}</strong>
        </div>
        <div class="s-box-item">
          <span style="color:#94a3b8;">Difference (Bank - Claims):</span>
          <strong style="color: ${diff >= 0 ? '#34d399' : '#f87171'};">
            ${diff >= 0 ? '+' : ''}PKR ${diff.toLocaleString()} (${diff >= 0 ? 'Surplus / Advance' : 'Pending Claim'})
          </strong>
        </div>
      </div>

      <!-- BANK STATEMENT DEBIT TRANSACTIONS TABLE -->
      <table>
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 14%;">Bank Date</th>
            <th style="width: 14%;">Bank Source</th>
            <th style="width: 18%;">Debit Amount</th>
            <th style="width: 49%;">Transaction Details & Reference</th>
          </tr>
        </thead>
        <tbody>
`;

    if (bList.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center; color:#94a3b8; font-style:italic;">No direct bank debits recorded in PDF bank statements for August.</td></tr>`;
    } else {
      bList.forEach((b, bIdx) => {
        html += `
          <tr>
            <td><strong>${bIdx + 1}</strong></td>
            <td><strong>${b.date}</strong></td>
            <td><span class="tag-bank">${b.bank}</span></td>
            <td><span class="badge-debit">PKR ${b.amount.toLocaleString()}</span></td>
            <td>${b.desc}</td>
          </tr>
`;
      });
    }

    html += `
        </tbody>
      </table>
    </div>
`;
  });

  html += `
  </div>
</body>
</html>
`;

  const outputPath = path.join(__dirname, '..', 'public', 'August_2026_Bank_Statements_Compact_Report.html');
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`\n✅ Compact Bank PDF Report successfully generated at: ${outputPath}`);
}

buildCompactBankReport().catch(console.error);
