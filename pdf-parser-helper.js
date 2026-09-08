/**
 * pdf-parser-helper.js
 * Server-Compatible Intelligent PDF Parser & Bank Statement / Accounts Comparator
 * 
 * Works seamlessly in Node.js, Next.js, and Vercel Serverless Functions
 * with ZERO worker dependencies, ZERO browser fake-worker errors, and ZERO DOMMatrix requirements.
 * 
 * Supports:
 * - Bank Alfalah & other Pakistani Bank Statements of Account (180+ pages)
 * - Multi-column tabular data (Date, Description, Cheq/Ref#, Debit, Credit, Balance)
 * - Standard Accounts Department expense sheets (Name: PKR Amount, tabular lists)
 * - Strict separation of Debit (Expenses) vs Credit (Deposits) vs Running Balance
 */

const pdfParse = require('pdf-parse');

function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^(mr\.|ms\.|mrs\.|engr\.|dr\.|muhammad\s+engr\.|m\.)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Parses a single line from a Bank Statement
 */
function parseBankStatementLine(line) {
  if (!line || line.length < 5) return null;

  // Check for date pattern at start (DD-MM-YYYY, DD/MM/YYYY, DD-Mon-YYYY, YYYY-MM-DD, etc.)
  const dateRegex = /^\s*(\d{1,2}[-\/\.](?:[A-Za-z]{3}|\d{1,2})[-\/\.]\d{2,4})\s*(?:(\d{1,2}[-\/\.](?:[A-Za-z]{3}|\d{1,2})[-\/\.]\d{2,4})\s*)?/i;
  const dateMatch = line.match(dateRegex);
  if (!dateMatch) return null;

  const postDate = dateMatch[1];
  const valueDate = dateMatch[2] || postDate;
  let remaining = line.substring(dateMatch[0].length).trim();

  // Find all number amounts on the line (e.g., 15,000.00, 485,000.00, 0.00)
  const numberRegex = /(?:\b|\s)([\d,]+\.\d{2}|\b\d{1,3}(?:,\d{3})+(?!\.\d)\b)(?:\b|\s)/g;
  const numberMatches = [...remaining.matchAll(numberRegex)];
  
  if (numberMatches.length === 0) return null;

  const amounts = numberMatches.map(m => {
    const raw = m[1];
    const val = parseFloat(raw.replace(/,/g, ''));
    return { raw, val, index: m.index };
  }).filter(a => !isNaN(a.val));

  if (amounts.length === 0) return null;

  let debit = 0;
  let credit = 0;
  let balance = 0;
  let descriptionEndIdx = remaining.length;

  if (amounts.length >= 3) {
    // 3+ columns: Debit, Credit, Balance
    const balObj = amounts[amounts.length - 1];
    const credObj = amounts[amounts.length - 2];
    const debObj = amounts[amounts.length - 3];
    balance = balObj.val;
    credit = credObj.val;
    debit = debObj.val;
    descriptionEndIdx = debObj.index;
  } else if (amounts.length === 2) {
    // 2 columns: either [Debit, Balance] or [Credit, Balance]
    const balObj = amounts[1];
    const txObj = amounts[0];
    balance = balObj.val;
    descriptionEndIdx = txObj.index;
    
    const descText = remaining.substring(0, descriptionEndIdx).toUpperCase();
    if (/(DEPOSIT|CREDIT|\bCR\b|PROFIT|RECEIV|REFUND)/i.test(descText) && !/(DEBIT|\bDR\b|TRANSFER TO|IBFT TO|PAID|WD)/i.test(descText)) {
      credit = txObj.val;
    } else {
      debit = txObj.val;
    }
  } else if (amounts.length === 1) {
    debit = amounts[0].val;
    descriptionEndIdx = amounts[0].index;
  }

  let description = remaining.substring(0, descriptionEndIdx).trim();

  // Extract Cheque/Ref #
  let refNo = '';
  const refMatch = description.match(/\b(FT\d+|CHQ\s*#?\s*\d+|IBFT\w*|\b\d{6,14}\b)/i);
  if (refMatch) {
    refNo = refMatch[0];
    description = description.replace(refNo, ' ').trim();
  }

  // Clean description to get clean payee name
  let cleanName = description
    .replace(/\b(IBFT|ONLINE|TRF|TRANSFER|FUNDS|PAYMENT|TO|FROM|CHQ|CHEQUE|PAID|CASH|WITHDRAWAL|EXPENSE|EXPENSES|SALARY|SAL|BILL|ADVANCE|DR|CR|PKR|RS|BRANCH|ATM|POS)\b/gi, ' ')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    postDate,
    valueDate,
    description,
    cleanName,
    refNo,
    debit,
    credit,
    balance,
    amount: debit > 0 ? debit : credit,
    rawLine: line
  };
}

/**
 * Main parser entry point
 * @param {Buffer} pdfBuffer - Raw PDF file buffer
 * @returns {Promise<{ numPages: number, pdfInfo: object, extractedEntries: Array }>}
 */
async function parseAccountsPdf(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('Invalid PDF data provided: expected a Buffer');
  }

  let data;
  try {
    // Pure Node.js in-process extraction via pdf-parse@1.1.1
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip statement headers, footers, pagination
    if (/^(page\s+\d+|statement\s+of\s+account|bank\s+alfalah|account\s+number|branch\s*:|statement\s+period|post\s+date|val\s+date|particulars|sr#|sr\.|s\.no|total\s*:|--\s*\d+\s+of\s+\d+\s*--)/i.test(line)) {
      continue;
    }

    // 1. Try Bank Statement transaction line parsing
    const bankTx = parseBankStatementLine(line);
    if (bankTx) {
      // For expense verification, we are interested in Debit (or expense amounts)
      const amt = bankTx.debit > 0 ? bankTx.debit : (bankTx.amount > 0 ? bankTx.amount : 0);
      if (amt > 0 && bankTx.cleanName.length >= 2) {
        extractedEntries.push({
          extractedName: bankTx.cleanName,
          amount: amt,
          debit: bankTx.debit,
          credit: bankTx.credit,
          balance: bankTx.balance,
          date: bankTx.postDate,
          refNo: bankTx.refNo,
          description: bankTx.description,
          rawLine: line,
          details: `Date: ${bankTx.postDate} | Debit: PKR ${amt.toLocaleString()} | Bal: PKR ${bankTx.balance.toLocaleString()} | ${bankTx.description}`
        });
        continue;
      }
    }

    // 2. Try Key-Value Format: "Name: PKR Amount" or "Employee: Amount"
    if (line.includes(':') && /\d+/.test(line)) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const potentialName = parts[0].replace(/^(employee|staff|name|emp|payee)\s+/i, '').trim();
        const potentialAmountMatch = parts[parts.length - 1].match(/([\d,]+(?:\.\d{2})?)/);
        if (potentialName.length > 2 && potentialAmountMatch) {
          const amt = parseAmount(potentialAmountMatch[1]);
          if (amt > 0) {
            extractedEntries.push({
              extractedName: potentialName,
              amount: amt,
              debit: amt,
              credit: 0,
              balance: 0,
              rawLine: line,
              details: line
            });
            continue;
          }
        }
      }
    }

    // 3. Try Generic Tabular Row Format: "Name ... Amount"
    const amountMatches = line.match(/(?:pkr|rs\.?|rs)?\s*([\d,]+(?:\.\d{2})?)\s*(?:\/-)?/gi);
    if (amountMatches && amountMatches.length > 0) {
      const validAmounts = [];
      amountMatches.forEach(m => {
        const amt = parseAmount(m);
        const isYear = (amt >= 2020 && amt <= 2035 && !m.includes('.') && !m.includes(',') && !/pkr|rs/i.test(m));
        if (amt > 0 && !isYear) {
          validAmounts.push({ raw: m, val: amt });
        }
      });

      if (validAmounts.length > 0) {
        // In generic row, first valid amount is transaction amount
        const targetAmount = validAmounts[0].val;

        let namePortion = line;
        validAmounts.forEach(va => {
          namePortion = namePortion.replace(va.raw, ' ');
        });

        namePortion = namePortion
          .replace(/^\s*\d+[\.\)\-]?\s*/, '')
          .replace(/\b(pkr|rs|staff|employee|dr|cr|cash|online|transfer)\b/gi, ' ')
          .replace(/[\t|]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (namePortion.length >= 2 && /[a-zA-Z]/.test(namePortion)) {
          extractedEntries.push({
            extractedName: namePortion,
            amount: targetAmount,
            debit: targetAmount,
            credit: 0,
            balance: 0,
            rawLine: line,
            details: line
          });
        }
      }
    }
  }

  return {
    numPages,
    pdfInfo,
    extractedEntries
  };
}

/**
 * Matches extracted PDF entries against employee database and calculates verification summary
 */
function matchAndVerifyExpenses(extractedEntries, employees, appExpensesMap = {}, manualMappings = {}) {
  const pdfEmployeeMap = new Map();

  (extractedEntries || []).forEach(entry => {
    const rawName = (entry.extractedName || '').trim();
    if (!rawName) return;
    const norm = normalizeName(rawName);
    
    if (!pdfEmployeeMap.has(norm)) {
      pdfEmployeeMap.set(norm, {
        originalName: rawName,
        normalizedName: norm,
        totalAmount: 0,
        entries: []
      });
    }

    const item = pdfEmployeeMap.get(norm);
    item.totalAmount += Number(entry.amount) || 0;
    item.entries.push(entry);
  });

  const matchedPdfNorms = new Set();
  const verificationResults = [];

  (employees || []).forEach(emp => {
    const empId = emp.id;
    const empName = emp.name || '';
    const empNorm = normalizeName(empName);
    const appData = appExpensesMap[empId] || { totalExpense: 0, entries: [] };
    const appExpense = Number(appData.totalExpense) || 0;

    let matchedPdfItem = null;
    let confidence = 0;
    let matchType = 'NONE';

    // 1. Check manual admin mappings first
    if (manualMappings && manualMappings[empId]) {
      const mappedNorm = normalizeName(manualMappings[empId]);
      if (pdfEmployeeMap.has(mappedNorm)) {
        matchedPdfItem = pdfEmployeeMap.get(mappedNorm);
        matchedPdfNorms.add(mappedNorm);
        confidence = 1.0;
        matchType = 'MANUAL';
      }
    }

    // 2. Exact normalized name match
    if (!matchedPdfItem && pdfEmployeeMap.has(empNorm)) {
      matchedPdfItem = pdfEmployeeMap.get(empNorm);
      matchedPdfNorms.add(empNorm);
      confidence = 1.0;
      matchType = 'EXACT_NAME';
    }

    // 3. Fuzzy token match (e.g. "Muhammad Ali" matches "Ali" or "M Ali" in bank description)
    if (!matchedPdfItem) {
      for (const [normKey, pdfItem] of pdfEmployeeMap.entries()) {
        if (matchedPdfNorms.has(normKey)) continue;

        const empTokens = empNorm.split(' ').filter(t => t.length > 1);
        const pdfTokens = normKey.split(' ').filter(t => t.length > 1);

        const matchingTokens = empTokens.filter(t => pdfTokens.includes(t));
        if (empTokens.length > 0 && matchingTokens.length >= Math.min(empTokens.length, 2)) {
          matchedPdfItem = pdfItem;
          matchedPdfNorms.add(normKey);
          confidence = 0.85;
          matchType = 'FUZZY_NAME';
          break;
        }

        // Substring check
        if (empNorm.length > 3 && (normKey.includes(empNorm) || empNorm.includes(normKey))) {
          matchedPdfItem = pdfItem;
          matchedPdfNorms.add(normKey);
          confidence = 0.90;
          matchType = 'SUBSTRING';
          break;
        }
      }
    }

    const pdfExpense = matchedPdfItem ? Math.round(matchedPdfItem.totalAmount * 100) / 100 : 0;
    const isFoundInPdf = Boolean(matchedPdfItem);
    const difference = isFoundInPdf ? Math.round((appExpense - pdfExpense) * 100) / 100 : appExpense;

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
      pdfExpense: isFoundInPdf ? pdfExpense : null,
      difference: isFoundInPdf ? difference : null,
      status,
      confidence,
      matchType,
      isFoundInPdf,
      pdfExtractedName: matchedPdfItem ? matchedPdfItem.originalName : null,
      pdfEntries: matchedPdfItem ? matchedPdfItem.entries : [],
      appEntries: appData.entries || []
    });
  });

  const unmatchedPdfEntries = [];
  for (const [normKey, pdfItem] of pdfEmployeeMap.entries()) {
    if (!matchedPdfNorms.has(normKey)) {
      unmatchedPdfEntries.push({
        extractedName: pdfItem.originalName,
        normalizedName: normKey,
        totalAmount: pdfItem.totalAmount,
        entries: pdfItem.entries
      });
    }
  }

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
  parseAmount,
  parseBankStatementLine
};

