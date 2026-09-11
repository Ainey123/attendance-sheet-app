const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const htmlFile = path.join(__dirname, '..', 'public', 'August_2026_Bank_Statements_Compact_Report.html');
const pdfFile = path.join(__dirname, '..', 'public', 'August_2026_Bank_Statements_Compact_Report.pdf');

console.log('Converting HTML report to binary PDF file...');

try {
  const cmd = `"${edgePath}" --headless --no-sandbox --disable-gpu --print-to-pdf="${pdfFile}" "file:///${htmlFile.replace(/\\/g, '/')}"`;
  execSync(cmd, { stdio: 'inherit' });
  
  if (fs.existsSync(pdfFile)) {
    const size = fs.statSync(pdfFile).size;
    console.log(`✅ PDF created successfully! Path: ${pdfFile} | Size: ${size} bytes`);
  } else {
    console.error('PDF file was not found after command execution.');
  }
} catch (err) {
  console.error('Conversion error:', err.message);
}
