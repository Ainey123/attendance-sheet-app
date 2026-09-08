/**
 * pdf-parser-helper.js
 * Server-Compatible Intelligent PDF Parser & Bank Statement / Accounts Comparator
 * 
 * Works seamlessly in Node.js, Next.js, and Vercel Serverless Functions
 * with ZERO worker dependencies, ZERO browser fake-worker errors, and ZERO DOMMatrix requirements.
 * 
 * Supports:
 * - Bank Alfalah & other Pakistani Bank Statements of Account (180+ pages)
 * - Multi-column and multi-line tabular data (Date, Description, Cheq/Ref#, Debit, Credit, Balance)
 * - Standard Accounts Department expense sheets (Name: PKR Amount, tabular lists)
 * - Case-insensitive Name Matching (both small and capital letters, phonetic aliases)
 * - Exact Date-Level Cross-Checking against Attendance Clock-Out Expenses
 * - Strict separation of Debit (Expenses) vs Credit (Deposits) vs Running Balance
 */

const pdfParse = require('pdf-parse');

/**
 * Normalizes a name string:
 * - Converts to lower case (case-insensitive for both small and capital letters)
 * - Strips honorifics and job titles (Mr, Ms, Engr, Dr, Syed, Hafiz, Ch, Malik, etc.)
 * - Strips special characters and collapses excess whitespace
 */
function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^(mr\.|ms\.|mrs\.|engr\.|dr\.|muhammad\s+engr\.|m\.|md\.|syed|hafiz|ch\.|malik|advocate)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates canonical phonetic tokens for common Pakistani/Urdu name variations
 */
function getCanonicalToken(token) {
  if (!token) return '';
  let t = token.toLowerCase();
  if (/^(rashid|rasheed|rashed)$/.test(t)) return 'rashid';
  if (/^(shehzad|shahzad|shezad|shahzaad|shahzade)$/.test(t)) return 'shehzad';
  if (/^(rehman|rahman|rahmaan)$/.test(t)) return 'rehman';
  if (/^(muhammad|mohammad|mohammed|muhamad|mhd|md)$/.test(t)) return 'muhammad';
  if (/^(hussain|hussein|husain)$/.test(t)) return 'hussain';
  if (/^(syed|sayed|sayyed)$/.test(t)) return 'syed';
  if (/^(usman|osman|uthman)$/.test(t)) return 'usman';
  if (/^(shoaib|shoaeb|shuayb)$/.test(t)) return 'shoaib';
  if (/^(nazeer|nazir)$/.test(t)) return 'nazeer';
  if (/^(naveed|navid)$/.test(t)) return 'naveed';
  if (/^(tariq|tarik)$/.test(t)) return 'tariq';
  if (/^(bilal|belaal)$/.test(t)) return 'bilal';
  if (/^(faisal|faysal)$/.test(t)) return 'faisal';
  if (/^(imran|emran)$/.test(t)) return 'imran';
  if (/^(asif|aasef)$/.test(t)) return 'asif';
  return t;
}

/**
 * Normalizes any date string into standard ISO YYYY-MM-DD format
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  // 1. DD-Mon-YYYY or DD/Mon/YYYY (e.g. 05-Sep-2026, 05-SEP-26)
  const dMonY = s.match(/^(\d{1,2})[-\/\.\s]([A-Za-z]{3})[-\/\.\s](\d{2,4})$/i);
  if (dMonY) {
    const day = dMonY[1].padStart(2, '0');
    const monKey = dMonY[2].toLowerCase();
    const mon = months[monKey] || '01';
    let yr = dMonY[3];
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${mon}-${day}`;
  }

  // 2. DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const mon = dmy[2].padStart(2, '0');
    let yr = dmy[3];
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${mon}-${day}`;
  }

  // 3. YYYY-MM-DD
  const ymd = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
  if (ymd) {
    const yr = ymd[1];
    const mon = ymd[2].padStart(2, '0');
    const day = ymd[3].padStart(2, '0');
    return `${yr}-${mon}-${day}`;
  }

  return s;
}

function parseAmount(amountStr) {
  if (typeof amountStr === 'number') return isNaN(amountStr) ? 0 : Math.abs(amountStr);
  if (!amountStr) return 0;
  
  const cleaned = String(amountStr)
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '')
    .trim();
  
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(Math.abs(val) * 100) / 100;
}

/**
 * Extracts clean payee name from transaction description
 */
function extractPayeeFromDesc(desc) {
  if (!desc) return '';
  // Pattern 1: "To <NAME> - <Bank>" or "To <NAME> | Via"
  const toMatch = desc.match(/\bTo\s+([A-Z\s\.\/]+?)(?:\s*-\s*|\s*\|\s*|\s*Easypaisa|\s*JazzCash|\s*Microfinance|\s*Bank|\s*Limited|\s*\d{8,}|\s*$)/i);
  if (toMatch && toMatch[1]) {
    const candidate = toMatch[1].replace(/^(FAST ENGINEERING SOLUTIONS|Bank Alfalah)/i, '').trim();
    if (candidate.length >= 2) return candidate;
  }
  // Pattern 2: "PAID TO <NAME>" / "TRF TO <NAME>" / "IBFT TO <NAME>"
  const paidMatch = desc.match(/\b(?:PAID TO|TRF TO|TRANSFER TO|FUNDS TO|IBFT TO)\s+([A-Z\s\.\/]+?)(?:\s*-\s*|\s*\|\s*|\s*ACC|\s*\d{8,}|\s*$)/i);
  if (paidMatch && paidMatch[1]) {
    return paidMatch[1].trim();
  }
  // Pattern 3: Clean description removing bank transaction keywords
  const clean = desc
    .replace(/\b(IBFT|ONLINE|TRF|TRANSFER|FUNDS|PAYMENT|TO|FROM|CHQ|CHEQUE|PAID|CASH|WITHDRAWAL|EXPENSE|EXPENSES|SALARY|SAL|BILL|ADVANCE|DR|CR|PKR|RS|BRANCH|ATM|POS|FAST|ENGINEERING|SOLUTIONS|LIMITED|BANK|ALFALAH|JAZZCASH|MOBILINK|EASYPAISA|TELENOR|MEEZAN|HABIB|UNITED|UBL|HBL|MCB|ALLIED|MICROFINANCE|VIA|ALFA)\b/gi, ' ')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean;
}

/**
 * Tests if an employee name matches a PDF entry (payee, description, or raw line).
 * Accepts both small and capital letters (case-insensitive) and phonetic variations.
 */
function isNameMatch(empName, pdfPayee, rawText = '') {
  if (!empName || (!pdfPayee && !rawText)) return false;

  const empNorm = normalizeName(empName);
  const pdfNorm = normalizeName(pdfPayee || '');
  const rawLower = String(rawText).toLowerCase();
  const empLower = String(empName).toLowerCase();

  // 1. Exact normalized match (case-insensitive)
  if (empNorm && pdfNorm && empNorm === pdfNorm) return true;

  // 2. Raw text contains exact employee name
  if (rawLower.includes(empLower) || (empNorm.length >= 3 && rawLower.includes(empNorm))) return true;

  // 3. Substring match
  if (empNorm.length >= 3 && pdfNorm.length >= 3) {
    if (pdfNorm.includes(empNorm) || empNorm.includes(pdfNorm)) return true;
  }

  // 4. Token & Phonetic matching (e.g. "Asif Rashid" vs "ASIF RASHEED", "Ali Shehzad" vs "ALI SHAHZAD")
  const empCanonicalTokens = empNorm.split(' ').map(getCanonicalToken).filter(t => t.length > 1);
  const pdfCanonicalTokens = (pdfNorm + ' ' + normalizeName(rawText)).split(' ').map(getCanonicalToken).filter(t => t.length > 1);

  if (empCanonicalTokens.length > 0) {
    const matchingTokens = empCanonicalTokens.filter(t => pdfCanonicalTokens.includes(t));
    if (empCanonicalTokens.length === 1 && matchingTokens.length === 1) {
      return true;
    }
    if (empCanonicalTokens.length >= 2 && matchingTokens.length >= Math.min(empCanonicalTokens.length, 2)) {
      return true;
    }
  }

  return false;
}

/**
 * Main parser entry point: parses both single-line & multi-line Pakistani bank statements and accounts PDFs
 * @param {Buffer} pdfBuffer - Raw PDF file buffer
 * @returns {Promise<{ numPages: number, pdfInfo: object, extractedEntries: Array }>}
 */
async function parseAccountsPdf(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('Invalid PDF data provided: expected a Buffer');
  }

  let data;
  try {
    data = await pdfParse(pdfBuffer);
  } catch (err) {
    const rawMsg = err.message || String(err);
    console.error('PDF Parser Internal Error:', rawMsg);
    if (/password|encrypt/i.test(rawMsg)) {
      throw new Error('This PDF is password-protected or encrypted. Please upload an unprotected PDF.');
    }
    if (/format|invalid|bad xref|corrupt/i.test(rawMsg)) {
      throw new Error('The uploaded file is corrupt or not a valid PDF document.');
    }
    throw new Error('Unable to process this PDF: ' + rawMsg);
  }

  const pdfText = data.text || '';
  const numPages = data.numpages || 1;
  const pdfInfo = data.info || {};

  if (!pdfText || pdfText.trim().length === 0) {
    throw new Error('No readable text found in this PDF. It may be a scanned image without selectable text.');
  }

  const lines = pdfText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const extractedEntries = [];
  let runningBalance = 0;
  let currentTx = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check opening balance
    if (line.includes('Opening Balance')) {
      const m = line.match(/Opening Balance\s+([\d,]+\.\d{2})/i);
      if (m) {
        runningBalance = parseFloat(m[1].replace(/,/g, ''));
      }
      continue;
    }

    // Skip headers/footers/pagination
    if (/^(Statement Of Account|From Date|To Date|Title Of Account|Account #|FAST ENGINEERING|Registered|HOUSE NO|HOUSING|AVENUE|LAHORE PH|IBAN|Nature of Account|Currency|Date Of Account|PKR|CA AKK|PK80ALFH|Raiwind Road|DateDescriptionCheq|Page \d+ of \d+|\d{8}Page \d+ of \d+|^2026\d{4}$)/i.test(line)) {
      continue;
    }

    // Check if line starts with a date (e.g. DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD)
    const dateRegex = /^(\d{1,2}[-\/\.](?:[A-Za-z]{3}|\d{1,2})[-\/\.]\d{2,4})\s*(?:(\d{1,2}[-\/\.](?:[A-Za-z]{3}|\d{1,2})[-\/\.]\d{2,4})\s*)?/i;
    const dateMatch = line.match(dateRegex);

    if (dateMatch) {
      if (currentTx && currentTx.amount > 0) {
        extractedEntries.push(finalizeTransaction(currentTx));
      }

      const rawDate = dateMatch[1];
      const normDate = normalizeDate(rawDate);
      const rest = line.substring(dateMatch[0].length).trim();

      currentTx = {
        date: normDate,
        rawDate,
        rawText: rest,
        debit: 0,
        credit: 0,
        balance: 0,
        amount: 0,
        rawLine: line
      };

      // Check if rest contains numbers on same line
      const lineNumMatches = [...rest.matchAll(/(?:\b|\s)([\d,]+\.\d{2}|\b\d{1,3}(?:,\d{3})+(?!\.\d)\b)(?:\b|\s)/g)];
      if (lineNumMatches.length > 0) {
        const amt = parseFloat(lineNumMatches[0][1].replace(/,/g, ''));
        if (amt > 0) {
          currentTx.debit = amt;
          currentTx.amount = amt;
        }
      }
      continue;
    }

    // Multi-line block accumulator
    if (currentTx) {
      if (/^2026\d{4}$/.test(line)) continue; // skip statement date headers

      // Check if line is purely numbers (e.g. "170007309834.63" or "5000.00")
      const numMatch = line.match(/^(\d+)(?:\.(\d{2}))?$/);
      if (numMatch) {
        const fullNumStr = line;
        let matchedSplit = false;

        if (fullNumStr.includes('.')) {
          const parts = fullNumStr.split('.');
          const intPart = parts[0];
          const decPart = parts[1];

          // 1. Try exact balance arithmetic match
          if (runningBalance > 0) {
            for (let splitIdx = 1; splitIdx < intPart.length; splitIdx++) {
              const debStr = intPart.substring(0, splitIdx);
              const balIntStr = intPart.substring(splitIdx);
              const debVal = parseFloat(debStr);
              const balVal = parseFloat(balIntStr + '.' + decPart);

              if (Math.abs((runningBalance - debVal) - balVal) < 0.05) {
                currentTx.debit = debVal;
                currentTx.amount = debVal;
                currentTx.balance = balVal;
                runningBalance = balVal;
                matchedSplit = true;
                break;
              }
              if (Math.abs((runningBalance + debVal) - balVal) < 0.05) {
                currentTx.credit = debVal;
                currentTx.amount = debVal;
                currentTx.balance = balVal;
                runningBalance = balVal;
                matchedSplit = true;
                break;
              }
            }
          }

          // 2. Heuristic split: typical Pakistani bank debit is 3-6 digits, balance is 6-8 digits
          if (!matchedSplit) {
            for (let splitIdx = 1; splitIdx <= Math.min(6, intPart.length - 6); splitIdx++) {
              const debStr = intPart.substring(0, splitIdx);
              const balIntStr = intPart.substring(splitIdx);
              const debVal = parseFloat(debStr);
              const balVal = parseFloat(balIntStr + '.' + decPart);
              if (debVal >= 10 && balVal >= 1000) {
                currentTx.debit = debVal;
                currentTx.amount = debVal;
                currentTx.balance = balVal;
                runningBalance = balVal;
                matchedSplit = true;
                break;
              }
            }
          }
        }

        if (!matchedSplit) {
          const amt = parseFloat(line.replace(/,/g, ''));
          if (amt > 0 && amt !== 20260101 && amt !== 20260813) {
            currentTx.debit = amt;
            currentTx.amount = amt;
          }
        }
        continue;
      }

      // Check Key-Value or tabular patterns in sub-line
      if (line.includes(':') && /\d+/.test(line)) {
        const parts = line.split(':');
        const amtMatch = parts[parts.length - 1].match(/([\d,]+(?:\.\d{2})?)/);
        if (amtMatch) {
          const amt = parseAmount(amtMatch[1]);
          if (amt > 0) {
            currentTx.debit = amt;
            currentTx.amount = amt;
          }
        }
      }

      currentTx.rawText += ' ' + line;
      currentTx.rawLine += ' ' + line;
    }
  }

  if (currentTx && currentTx.amount > 0) {
    extractedEntries.push(finalizeTransaction(currentTx));
  }

  return {
    numPages,
    pdfInfo,
    extractedEntries
  };
}

function finalizeTransaction(tx) {
  const payee = extractPayeeFromDesc(tx.rawText);
  return {
    extractedName: payee || tx.rawText.substring(0, 40),
    payee,
    normalizedName: normalizeName(payee),
    amount: tx.amount,
    debit: tx.debit,
    credit: tx.credit,
    balance: tx.balance,
    date: tx.date,
    rawDate: tx.rawDate,
    description: tx.rawText,
    rawLine: tx.rawLine,
    details: `Date: ${tx.date} | Debit: PKR ${(tx.amount || 0).toLocaleString()} | Payee: ${payee || 'N/A'}`
  };
}

/**
 * Matches extracted PDF entries against employee database and calculates date-level verification summary
 * Accepts both small and capital letters (case-insensitive) and cross-checks exact dates.
 */
function matchAndVerifyExpenses(extractedEntries, employees, appExpensesMap = {}, manualMappings = {}, targetMonth = null) {
  const verificationResults = [];
  const matchedPdfIndices = new Set();

  // 1. Filter PDF entries by targetMonth (if provided)
  const monthFilteredEntries = (extractedEntries || []).filter(entry => {
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) return true;
    if (entry.date && entry.date.startsWith(targetMonth)) return true;
    return false;
  });

  // Fall back to all entries if month filter yielded 0 (e.g. general expense sheet without dates)
  const activeEntries = monthFilteredEntries.length > 0 ? monthFilteredEntries : (extractedEntries || []);

  (employees || []).forEach(emp => {
    const empId = emp.id;
    const empName = emp.name || '';
    const empNorm = normalizeName(empName);
    const appData = appExpensesMap[empId] || { totalExpense: 0, entries: [] };
    const appExpense = Number(appData.totalExpense) || 0;
    const appEntries = appData.entries || [];

    // Find all matching PDF entries for this employee
    const matchedEntries = [];
    let confidence = 0;
    let matchType = 'NONE';

    activeEntries.forEach((entry, idx) => {
      let isMatch = false;

      // 1. Check manual admin mappings first
      if (manualMappings && manualMappings[empId]) {
        const mappedNorm = normalizeName(manualMappings[empId]);
        if (entry.normalizedName === mappedNorm || normalizeName(entry.extractedName) === mappedNorm) {
          isMatch = true;
          confidence = 1.0;
          matchType = 'MANUAL';
        }
      }

      // 2. Case-insensitive Name & Alias matching
      if (!isMatch && isNameMatch(empName, entry.payee || entry.extractedName, entry.rawLine || entry.description)) {
        isMatch = true;
        confidence = 0.95;
        matchType = 'NAME_MATCH';
      }

      if (isMatch) {
        matchedEntries.push(entry);
        matchedPdfIndices.add(idx);
      }
    });

    const isFoundInPdf = matchedEntries.length > 0;
    const pdfExpense = isFoundInPdf ? matchedEntries.reduce((sum, e) => sum + (Number(e.amount) || Number(e.debit) || 0), 0) : 0;
    const roundedPdfExpense = Math.round(pdfExpense * 100) / 100;
    const difference = isFoundInPdf ? Math.round((appExpense - roundedPdfExpense) * 100) / 100 : appExpense;

    // Build Date-by-Date cross-check reconciliation
    const dateReconciliation = [];
    const usedPdfIndexesForDate = new Set();

    appEntries.forEach(appEntry => {
      const appDate = appEntry.date;
      const appAmt = Number(appEntry.amount) || 0;

      // Find matching PDF entry on the exact same date
      const exactDateMatchIdx = matchedEntries.findIndex((pe, pIdx) => !usedPdfIndexesForDate.has(pIdx) && pe.date === appDate);
      if (exactDateMatchIdx !== -1) {
        const pe = matchedEntries[exactDateMatchIdx];
        usedPdfIndexesForDate.add(exactDateMatchIdx);
        const peAmt = Number(pe.amount) || Number(pe.debit) || 0;
        const diff = Math.round((appAmt - peAmt) * 100) / 100;

        dateReconciliation.push({
          date: appDate,
          appAmount: appAmt,
          pdfAmount: peAmt,
          difference: diff,
          status: Math.abs(diff) < 0.01 ? 'EXACT_MATCH' : 'AMOUNT_DIFF',
          appNotes: appEntry.description || 'Clock-Out Expense',
          pdfDetails: pe.details || pe.description || `Debit: PKR ${peAmt.toLocaleString()}`
        });
      } else {
        dateReconciliation.push({
          date: appDate,
          appAmount: appAmt,
          pdfAmount: 0,
          difference: appAmt,
          status: 'APP_ONLY',
          appNotes: appEntry.description || 'Clock-Out Expense',
          pdfDetails: 'No corresponding entry in PDF on this date'
        });
      }
    });

    // Add remaining PDF entries that had no matching App date
    matchedEntries.forEach((pe, pIdx) => {
      if (!usedPdfIndexesForDate.has(pIdx)) {
        const peAmt = Number(pe.amount) || Number(pe.debit) || 0;
        dateReconciliation.push({
          date: pe.date || '—',
          appAmount: 0,
          pdfAmount: peAmt,
          difference: -peAmt,
          status: 'PDF_ONLY',
          appNotes: 'No attendance expense logged on this date',
          pdfDetails: pe.details || pe.description || `Debit: PKR ${peAmt.toLocaleString()}`
        });
      }
    });

    // Sort reconciliation by date
    dateReconciliation.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let status = 'NOT_FOUND';
    if (isFoundInPdf) {
      if (Math.abs(difference) < 0.01) {
        status = 'MATCHED';
      } else {
        status = 'DISCREPANCY';
      }
    } else if (appExpense === 0) {
      status = 'MATCHED_ZERO';
    }

    verificationResults.push({
      employeeId: empId,
      employeeName: empName,
      role: emp.role || 'Staff',
      appExpense,
      pdfExpense: isFoundInPdf ? roundedPdfExpense : null,
      difference: isFoundInPdf ? difference : null,
      status,
      confidence,
      matchType,
      isFoundInPdf,
      pdfExtractedName: isFoundInPdf ? (matchedEntries[0].payee || matchedEntries[0].extractedName) : null,
      pdfEntries: matchedEntries,
      appEntries,
      dateReconciliation
    });
  });

  const unmatchedPdfEntries = [];
  activeEntries.forEach((entry, idx) => {
    if (!matchedPdfIndices.has(idx)) {
      unmatchedPdfEntries.push(entry);
    }
  });

  let totalMatched = 0;
  let totalDiscrepancies = 0;
  let totalNotFound = 0;
  let totalAppExpenses = 0;
  let totalPdfExpenses = 0;

  verificationResults.forEach(r => {
    totalAppExpenses += r.appExpense || 0;
    if (r.pdfExpense !== null) {
      totalPdfExpenses += r.pdfExpense;
    }
    if (r.status === 'MATCHED' || r.status === 'MATCHED_ZERO') {
      totalMatched++;
    } else if (r.status === 'DISCREPANCY') {
      totalDiscrepancies++;
    } else if (r.status === 'NOT_FOUND') {
      totalNotFound++;
    }
  });

  const totalDifference = Math.round(Math.abs(totalAppExpenses - totalPdfExpenses) * 100) / 100;

  return {
    verificationResults,
    unmatchedPdfEntries,
    summary: {
      targetMonth,
      totalEmployees: employees.length,
      totalMatched,
      totalDiscrepancies,
      totalNotFound,
      totalUnmatchedInPdf: unmatchedPdfEntries.length,
      totalAppExpenses: Math.round(totalAppExpenses),
      totalPdfExpenses: Math.round(totalPdfExpenses),
      totalDifference
    }
  };
}

module.exports = {
  parseAccountsPdf,
  matchAndVerifyExpenses,
  normalizeName,
  normalizeDate,
  parseAmount,
  isNameMatch,
  extractPayeeFromDesc
};


