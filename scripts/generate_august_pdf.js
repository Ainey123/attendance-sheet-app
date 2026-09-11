const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function generateReport() {
  console.log('Fetching August 2026 bill and expense records...');

  const { data: att, error } = await supabase
    .from('attendance')
    .select('*')
    .gte('date', '2026-08-01')
    .lte('date', '2026-08-31')
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching attendance:', error.message);
    return;
  }

  const byEmp = {};
  (att || []).forEach(a => {
    const exp = Number(a.expenseAmount || 0);
    const spent = Number(a.moneySpent || 0);
    const rec = Number(a.receivedAmount || 0);
    const notes = (a.performanceNotes || '').trim();
    const img = a.image;

    if (exp > 0 || spent > 0 || rec > 0 || notes || img) {
      const emp = a.employeeName || 'Unknown Employee';
      if (!byEmp[emp]) {
        byEmp[emp] = {
          name: emp,
          role: a.role || 'Staff',
          records: []
        };
      }
      byEmp[emp].records.push({
        id: a.id,
        date: a.date,
        exp: exp || spent,
        spent: spent || exp,
        rec,
        notes: notes || 'No description provided',
        image: img || null
      });
    }
  });

  const employeeNames = Object.keys(byEmp).sort();
  let totalGrandExpense = 0;
  let totalGrandReceived = 0;
  let totalBillCount = 0;
  let totalPhotoCount = 0;

  employeeNames.forEach(emp => {
    byEmp[emp].records.forEach(r => {
      totalGrandExpense += r.exp;
      totalGrandReceived += r.rec;
      totalBillCount++;
      if (r.image) totalPhotoCount++;
    });
  });

  // Build HTML document
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>August 2026 - Employee Bills & Expense Claims Report</title>
  <style>
    @media print {
      body { background: #fff !important; color: #000 !important; font-size: 11pt; }
      .no-print { display: none !important; }
      .employee-section { page-break-before: always; }
      .employee-section:first-of-type { page-break-before: avoid; }
      .bill-card { break-inside: avoid; }
    }
    * { box-sizing: border-box; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; font-size: 14px; line-height: 1.5; }
    .container { max-width: 1100px; margin: 0 auto; background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    
    .print-actions { display: flex; gap: 15px; justify-content: flex-end; margin-bottom: 20px; }
    .btn { padding: 10px 20px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-primary:hover { background: #4338ca; }
    .btn-secondary { background: #334155; color: #f8fafc; }
    .btn-secondary:hover { background: #475569; }

    .report-header { text-align: center; border-bottom: 2px solid #334155; padding-bottom: 20px; margin-bottom: 25px; }
    .report-header h1 { margin: 0 0 5px 0; color: #818cf8; font-size: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
    .report-header h2 { margin: 0 0 10px 0; color: #f8fafc; font-size: 18px; font-weight: 500; }
    .report-header p { margin: 0; color: #94a3b8; font-size: 13px; }

    .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center; }
    .card .value { font-size: 20px; font-weight: 700; color: #38bdf8; margin-top: 5px; }
    .card .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }

    .employee-section { margin-bottom: 40px; border: 1px solid #334155; border-radius: 10px; overflow: hidden; background: #1e293b; }
    .employee-header { background: linear-gradient(135deg, #1e1b4b, #312e81); padding: 15px 20px; border-bottom: 1px solid #4338ca; display: flex; justify-content: space-between; align-items: center; }
    .employee-title { font-size: 18px; font-weight: 700; color: #fff; margin: 0; }
    .employee-role { font-size: 13px; color: #a5b4fc; background: rgba(255,255,255,0.1); padding: 3px 10px; border-radius: 12px; margin-left: 10px; font-weight: 400; }
    .employee-total { font-size: 15px; font-weight: 600; color: #34d399; }

    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: #0f172a; color: #94a3b8; padding: 12px 15px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #334155; }
    td { padding: 12px 15px; border-bottom: 1px solid #334155; font-size: 13px; vertical-align: top; }
    tr:nth-child(even) { background: rgba(15, 23, 42, 0.4); }
    
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-exp { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-rec { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    
    .bill-img { max-width: 180px; max-height: 180px; border-radius: 6px; border: 1px solid #475569; margin-top: 8px; display: block; object-fit: cover; cursor: pointer; }
    .no-img { color: #64748b; font-size: 11px; font-style: italic; }
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
      <h1>Office Attendance & Expense Tracking</h1>
      <h2>AUGUST 2026 — EMPLOYEE BILLS & EXPENSE CLAIMS REPORT</h2>
      <p>Report Period: August 01, 2026 – August 31, 2026 | Generated on: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>

    <div class="summary-cards">
      <div class="card">
        <div class="label">Total Employees</div>
        <div class="value">${employeeNames.length}</div>
      </div>
      <div class="card">
        <div class="label">Total Bill / Expense Entries</div>
        <div class="value">${totalBillCount}</div>
      </div>
      <div class="card">
        <div class="label">Total Expense Claimed</div>
        <div class="value">PKR ${totalGrandExpense.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="label">Attached Receipt Photos</div>
        <div class="value">${totalPhotoCount}</div>
      </div>
    </div>
`;

  employeeNames.forEach((empName, index) => {
    const empData = byEmp[empName];
    const totalExp = empData.records.reduce((s, r) => s + r.exp, 0);
    const totalRec = empData.records.reduce((s, r) => s + r.rec, 0);
    const photoCount = empData.records.filter(r => r.image).length;

    html += `
    <div class="employee-section">
      <div class="employee-header">
        <div>
          <span class="employee-title">${index + 1}. ${empName}</span>
          <span class="employee-role">${empData.role}</span>
        </div>
        <div class="employee-total">
          Total August Expense: PKR ${totalExp.toLocaleString()} | Receipts: ${photoCount}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 12%;">Date</th>
            <th style="width: 15%;">Expense (PKR)</th>
            <th style="width: 15%;">Received (PKR)</th>
            <th style="width: 33%;">Work / Expense Description</th>
            <th style="width: 20%;">Attached Receipt / Photo</th>
          </tr>
        </thead>
        <tbody>
`;

    empData.records.forEach((rec, rIdx) => {
      html += `
          <tr>
            <td><strong>${rIdx + 1}</strong></td>
            <td><strong>${rec.date}</strong></td>
            <td><span class="badge badge-exp">PKR ${rec.exp.toLocaleString()}</span></td>
            <td><span class="badge badge-rec">PKR ${rec.rec.toLocaleString()}</span></td>
            <td>${rec.notes}</td>
            <td>
              ${rec.image ? `<img src="${rec.image}" class="bill-img" alt="Bill Photo Date ${rec.date}" />` : `<span class="no-img">No photo attached</span>`}
            </td>
          </tr>
`;
    });

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

  const outputPath = path.join(__dirname, '..', 'public', 'August_2026_Employee_Bill_Report.html');
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`\n✅ August Bill Report generated successfully at: ${outputPath}`);
}

generateReport().catch(console.error);
