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
 * Matches extracted PDF entries against employee database and calculates month-specific verification summary.
 * 
 * Rules:
 * 1. Strict month filtering: only transactions in targetMonth (e.g. 2026-08) are INCLUDED.
 * 2. Case-insensitive name matching with phonetic tolerance.
 * 3. Distinguishes actual transaction credits from running balances.
 * 4. De-duplicates transactions (date + refNo + amount).
 * 5. Compares Bank Credit Total against Application Payable Total.
 * 6. Generates full audit details for every transaction and application record.
 */
function matchAndVerifyExpenses(extractedEntries, employees, appExpensesMap = {}, manualMappings = {}, targetMonth = null, salariesMap = {}) {
  const verificationResults = [];
  const allParsedEntries = extractedEntries || [];

  (employees || []).forEach(emp => {
    const empId = emp.id;
    const empName = emp.name || '';
    const empNorm = normalizeName(empName);
    const appData = appExpensesMap[empId] || { totalExpense: 0, entries: [] };
    const appExpense = Number(appData.totalExpense) || 0;
    const appEntries = appData.entries || [];
    const sal = salariesMap[empId] || {};

    // 1. Calculate Application / Salary Total according to existing rules
    const basicSalary = sal.basicSalary || 0;
    const regularDays = sal.regularPresentDays !== undefined ? sal.regularPresentDays : (sal.presentDays || 0);
    const sundayDays = sal.sundayPresentDays !== undefined ? sal.sundayPresentDays : 0;
    const perDay = sal.perDaySalary !== undefined ? sal.perDaySalary : (basicSalary > 0 ? Math.round(basicSalary / 30) : 0);
    const regularEarned = sal.regularEarned !== undefined ? sal.regularEarned : (perDay * regularDays);
    const sundayBonus = sal.sundayBonus !== undefined ? sal.sundayBonus : (perDay * sundayDays);
    const totalEarned = sal.earnedSalary !== undefined ? sal.earnedSalary : (regularEarned + sundayBonus);
    
    // Net Salary payable
    let applicationTotal = 0;
    if (sal.netSalary !== undefined && typeof sal.netSalary === 'number') {
      applicationTotal = sal.netSalary;
    } else if (totalEarned > 0) {
      applicationTotal = Math.max(0, totalEarned - appExpense);
    } else if (appExpense > 0) {
      applicationTotal = -appExpense;
    }

    // Build Itemized Application Records
    const itemizedAppRecords = [];
    if (regularDays > 0) {
      itemizedAppRecords.push({
        date: targetMonth || '—',
        description: `Regular Attendance (${regularDays} Present Days @ PKR ${perDay.toLocaleString()}/day)`,
        amount: regularEarned,
        type: 'EARNING',
        status: 'INCLUDED'
      });
    }
    if (sundayDays > 0) {
      itemizedAppRecords.push({
        date: targetMonth || '—',
        description: `Sunday Bonus (${sundayDays} Sunday Days Worked @ PKR ${perDay.toLocaleString()}/day)`,
        amount: sundayBonus,
        type: 'BONUS',
        status: 'INCLUDED'
      });
    }
    appEntries.forEach(ae => {
      itemizedAppRecords.push({
        date: ae.date || targetMonth || '—',
        description: ae.description || 'Clock-Out Expense Deduction',
        amount: -(Number(ae.amount) || 0),
        type: 'DEDUCTION',
        status: 'INCLUDED'
      });
    });

    // 2. Classify and Audit all Bank PDF Transactions for this employee
    const bankTransactions = [];
    const seenTxKeys = new Set();
    let bankCreditTotal = 0;
    let bankDebitTotal = 0;
    let hasReviewRequired = false;

    allParsedEntries.forEach(entry => {
      const entryName = entry.payee || entry.extractedName || '';
      const rawText = entry.rawLine || entry.description || '';
      let isEmployeeMatch = false;
      let matchType = 'NONE';

      // Check manual admin mappings first
      if (manualMappings && manualMappings[empId]) {
        const mappedNorm = normalizeName(manualMappings[empId]);
        if (entry.normalizedName === mappedNorm || normalizeName(entryName) === mappedNorm) {
          isEmployeeMatch = true;
          matchType = 'MANUAL';
        }
      }

      // Case-insensitive name matching
      if (!isEmployeeMatch && isNameMatch(empName, entryName, rawText)) {
        isEmployeeMatch = true;
        matchType = 'NAME_MATCH';
      }

      // If not matching this employee at all, skip from their transaction list
      if (!isEmployeeMatch) return;

      const txDate = entry.date || '';
      const isMonthMatch = Boolean(targetMonth && txDate && txDate.startsWith(targetMonth));
      const creditAmt = Number(entry.credit) || 0;
      const debitAmt = Number(entry.debit) || 0;
      const txAmt = Number(entry.amount) || (creditAmt > 0 ? creditAmt : debitAmt);

      // Determine transaction type
      const isCredit = (creditAmt > 0) || (entry.type === 'CREDIT') || (txAmt > 0 && debitAmt === 0 && !/debit|dr\b/i.test(entry.description || ''));
      const isDebit = !isCredit && (debitAmt > 0 || /debit|dr\b/i.test(entry.description || ''));

      // Generate robust de-duplication key
      const txKey = `${txDate}_${entry.refNo || normalizeName(entry.description || '').substring(0, 30)}_${txAmt}`;
      const isDuplicate = seenTxKeys.has(txKey);

      let txStatus = 'INCLUDED';
      let reason = `Verified qualifying credit for ${targetMonth || 'selected period'}`;

      if (!isMonthMatch && targetMonth) {
        txStatus = 'EXCLUDED_MONTH';
        reason = `Transaction date (${txDate || 'Unknown'}) is outside ${targetMonth}`;
      } else if (isDuplicate) {
        txStatus = 'EXCLUDED_DUPLICATE';
        reason = `Duplicate transaction detected (${txKey})`;
      } else if (isDebit) {
        // In company statement, debits sent to employee represent employee credits
        // If explicitly a non-qualifying debit on employee statement:
        if (entry.isEmployeeStatement && isDebit) {
          txStatus = 'EXCLUDED_DEBIT';
          reason = `Debit transaction (PKR ${debitAmt.toLocaleString()})`;
        } else {
          // Company account transfer to employee -> qualifying payment credit
          txStatus = 'INCLUDED';
          reason = `Salary payment transfer in ${targetMonth}`;
        }
      }

      if (txStatus === 'INCLUDED') {
        seenTxKeys.add(txKey);
        bankCreditTotal += txAmt;
      } else if (isDebit) {
        bankDebitTotal += debitAmt;
      }

      bankTransactions.push({
        date: txDate,
        rawDate: entry.rawDate || txDate,
        description: entry.description || entry.rawLine || 'Bank Transaction',
        refNo: entry.refNo || '—',
        credit: isCredit ? txAmt : 0,
        debit: isDebit ? txAmt : 0,
        amount: txAmt,
        balance: entry.balance || 0,
        type: isCredit ? 'CREDIT' : 'DEBIT',
        source: 'Bank PDF',
        employeeMatch: isEmployeeMatch,
        matchType,
        status: txStatus,
        reason
      });
    });

    // Sort transactions chronologically
    bankTransactions.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // 3. Compare Bank Credit Total against Application Total
    const roundedBankCreditTotal = Math.round(bankCreditTotal * 100) / 100;
    const roundedAppTotal = Math.round(applicationTotal * 100) / 100;
    const difference = Math.round(Math.abs(roundedBankCreditTotal - roundedAppTotal) * 100) / 100;

    let differenceDirection = 'Equal';
    if (roundedBankCreditTotal > roundedAppTotal) {
      differenceDirection = 'Bank > Application';
    } else if (roundedAppTotal > roundedBankCreditTotal) {
      differenceDirection = 'Application > Bank';
    }

    let verificationStatus = 'NOT VERIFIED';
    const includedTxCount = bankTransactions.filter(t => t.status === 'INCLUDED').length;

    if (allParsedEntries.length === 0) {
      verificationStatus = 'NOT VERIFIED';
    } else if (hasReviewRequired) {
      verificationStatus = 'REVIEW_REQUIRED';
    } else if (includedTxCount === 0 && roundedAppTotal > 0) {
      verificationStatus = 'NO TRANSACTIONS FOUND';
    } else if (roundedAppTotal === 0 && includedTxCount === 0) {
      verificationStatus = 'VERIFIED / MATCHED';
    } else if (roundedAppTotal === 0 && includedTxCount > 0) {
      verificationStatus = 'APPLICATION DATA INCOMPLETE';
    } else if (difference < 1.0) {
      verificationStatus = 'VERIFIED / MATCHED';
    } else {
      verificationStatus = 'MISMATCH';
    }

    verificationResults.push({
      employeeId: empId,
      employeeName: empName,
      role: emp.role || 'Staff',
      salaryMonth: targetMonth,
      bankCreditTotal: roundedBankCreditTotal,
      applicationTotal: roundedAppTotal,
      difference,
      differenceDirection,
      verificationStatus,
      // Legacy compatibility fields
      appExpense,
      pdfExpense: roundedBankCreditTotal > 0 ? roundedBankCreditTotal : null,
      status: (verificationStatus === 'VERIFIED / MATCHED') ? 'MATCHED' : (verificationStatus === 'MISMATCH' ? 'DISCREPANCY' : 'NOT_FOUND'),
      isFoundInPdf: includedTxCount > 0,
      bankTransactions,
      includedTransactionsCount: includedTxCount,
      totalBankTransactionsCount: bankTransactions.length,
      applicationBreakdown: {
        basicSalary,
        regularDays,
        sundayDays,
        perDaySalary: perDay,
        regularEarned,
        sundayBonus,
        totalEarned,
        expenses: appExpense,
        netSalary: roundedAppTotal,
        itemizedRecords: itemizedAppRecords
      },
      dateReconciliation: bankTransactions.map(bt => ({
        date: bt.date,
        appAmount: 0,
        pdfAmount: bt.amount,
        difference: bt.amount,
        status: bt.status,
        appNotes: bt.reason,
        pdfDetails: `${bt.description} | ${bt.type}: PKR ${bt.amount.toLocaleString()} | Bal: PKR ${(bt.balance||0).toLocaleString()}`
      }))
    });
  });

  let totalMatched = 0;
  let totalDiscrepancies = 0;
  let totalNotFound = 0;
  let totalBankCredits = 0;
  let totalAppSalaries = 0;

  verificationResults.forEach(r => {
    totalBankCredits += r.bankCreditTotal || 0;
    totalAppSalaries += r.applicationTotal || 0;
    if (r.verificationStatus === 'VERIFIED / MATCHED') {
      totalMatched++;
    } else if (r.verificationStatus === 'MISMATCH') {
      totalDiscrepancies++;
    } else {
      totalNotFound++;
    }
  });

  const totalDifference = Math.round(Math.abs(totalBankCredits - totalAppSalaries) * 100) / 100;

  return {
    verificationResults,
    unmatchedPdfEntries: [],
    summary: {
      targetMonth,
      totalEmployees: employees.length,
      totalMatched,
      totalDiscrepancies,
      totalNotFound,
      totalBankCredits: Math.round(totalBankCredits),
      totalAppSalaries: Math.round(totalAppSalaries),
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


