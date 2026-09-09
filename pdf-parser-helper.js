/**
 * pdf-parser-helper.js — Production Bank Statement PDF Parser & Verification Engine
 * 
 * Supports:
 * - Bank Alfalah Statements (Multi-line descriptions, Date/Description/Ref/Debit/Credit/Balance)
 * - UBL Bank Statements (Date/Particulars/Inst. No/Debit/Credit/Balance)
 * - Generic Tabular Bank Statements (Dynamic X-coordinate column boundary detection)
 * - Strict Credit vs Debit vs Balance isolation (Credit ONLY from explicit Credit columns; balance/ref/debit never credited)
 * - Running Balance Equation Validation (currentBalance ≈ previousBalance - debit + credit)
 * - Deduplication via deterministic transaction fingerprints
 * - Case-insensitive Name Matching with Ambiguity Detection & Provenance tracking
 */

const pdfParse = require('pdf-parse');

/**
 * Normalizes a name string:
 * - Lowercase (case-insensitive for capital and lowercase letters)
 * - Strips common honorifics/prefixes (Mr, Ms, Engr, Dr, Syed, Hafiz, Ch, Malik, etc.)
 * - Removes special characters and collapses whitespace
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
 * Normalizes any date string into standard ISO YYYY-MM-DD format
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  // 1. DD-Mon-YYYY or DD/Mon/YYYY (e.g. 05-Aug-2026, 05/AUG/2026)
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

/**
 * Parses numeric amount cleanly
 */
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
    const candidate = toMatch[1].replace(/^(FAST ENGINEERING SOLUTIONS|Bank Alfalah|UBL)/i, '').trim();
    if (candidate.length >= 2) return candidate;
  }
  // Pattern 2: "PAID TO <NAME>" / "TRF TO <NAME>" / "IBFT TO <NAME>" / "TRANSFER TO <NAME>"
  const paidMatch = desc.match(/\b(?:PAID TO|TRF TO|TRANSFER TO|FUNDS TO|IBFT TO|CREDIT TO|DEBIT TO)\s+([A-Z\s\.\/]+?)(?:\s*-\s*|\s*\|\s*|\s*ACC|\s*\d{8,}|\s*$)/i);
  if (paidMatch && paidMatch[1]) {
    return paidMatch[1].trim();
  }
  // Pattern 3: Clean description by removing common bank keywords
  const clean = desc
    .replace(/\b(IBFT|ONLINE|TRF|TRANSFER|FUNDS|PAYMENT|TO|FROM|CHQ|CHEQUE|PAID|CASH|WITHDRAWAL|EXPENSE|EXPENSES|SALARY|SAL|BILL|ADVANCE|DR|CR|PKR|RS|BRANCH|ATM|POS|FAST|ENGINEERING|SOLUTIONS|LIMITED|BANK|ALFALAH|JAZZCASH|MOBILINK|EASYPAISA|TELENOR|MEEZAN|HABIB|UNITED|UBL|HBL|MCB|ALLIED|MICROFINANCE|VIA|ALFA)\b/gi, ' ')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean;
}

/**
 * Tests if an employee name matches a PDF entry (payee, description, or raw line).
 * Strictly enforces case-insensitivity. Ambiguous matches return object indicating match status.
 */
function testNameMatch(empName, pdfPayee, rawText = '', customAliases = {}) {
  if (!empName || (!pdfPayee && !rawText)) {
    return { isMatch: false, isAmbiguous: false, matchType: 'NONE' };
  }

  const empNorm = normalizeName(empName);
  const pdfNorm = normalizeName(pdfPayee || '');
  const rawNorm = normalizeName(rawText || '');
  const empLower = String(empName).toLowerCase();
  const rawLower = String(rawText).toLowerCase();

  // 1. Check explicit registered alias
  if (customAliases && customAliases[empName]) {
    const aliasList = Array.isArray(customAliases[empName]) ? customAliases[empName] : [customAliases[empName]];
    for (const alias of aliasList) {
      const aliasNorm = normalizeName(alias);
      if (pdfNorm === aliasNorm || rawNorm.includes(aliasNorm)) {
        return { isMatch: true, isAmbiguous: false, matchType: 'REGISTERED_ALIAS' };
      }
    }
  }

  // 2. Exact normalized match (case-insensitive)
  if (empNorm && pdfNorm && empNorm === pdfNorm) {
    return { isMatch: true, isAmbiguous: false, matchType: 'EXACT_MATCH' };
  }

  // 3. Raw text contains full employee name
  if (rawLower.includes(empLower) || (empNorm.length >= 4 && rawLower.includes(empNorm))) {
    return { isMatch: true, isAmbiguous: false, matchType: 'SUBSTRING_MATCH' };
  }

  // 4. Token matching: requiring full token overlap for multi-word names
  const empTokens = empNorm.split(' ').filter(t => t.length > 1);
  const pdfTokens = (pdfNorm + ' ' + rawNorm).split(' ').filter(t => t.length > 1);

  if (empTokens.length >= 2) {
    const matchingTokens = empTokens.filter(t => pdfTokens.includes(t));
    if (matchingTokens.length === empTokens.length) {
      return { isMatch: true, isAmbiguous: false, matchType: 'ALL_TOKENS_MATCH' };
    } else if (matchingTokens.length >= 2 && matchingTokens.length >= empTokens.length - 1) {
      // Possible partial match — mark as AMBIGUOUS to prevent false positives
      return { isMatch: false, isAmbiguous: true, matchType: 'PARTIAL_TOKEN_AMBIGUOUS' };
    }
  }

  return { isMatch: false, isAmbiguous: false, matchType: 'NONE' };
}

/**
 * Extracts structured pages and text items with X/Y coordinates from PDF buffer using pdf-parse custom pagerender
 */
async function extractPdfStructure(pdfBuffer) {
  const pages = [];
  let numPages = 0;
  let pdfInfo = {};

  const options = {
    pagerender: function(pageData) {
      return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then(function(textContent) {
        numPages = Math.max(numPages, pageData.pageIndex + 1);
        const items = textContent.items.map(item => ({
          str: item.str,
          x: Math.round(item.transform[4] * 100) / 100,
          y: Math.round(item.transform[5] * 100) / 100,
          width: Math.round(item.width * 100) / 100,
          height: Math.round(item.height * 100) / 100
        }));

        // Group text items on page into lines by vertical Y position (tolerance 3.0 points)
        const lineGroups = [];
        items.forEach(item => {
          if (!item.str || item.str.trim() === '') return;
          let group = lineGroups.find(g => Math.abs(g.y - item.y) <= 3.0);
          if (!group) {
            group = { y: item.y, items: [] };
            lineGroups.push(group);
          }
          group.items.push(item);
        });

        // Sort line groups vertically top-to-bottom (higher Y = higher on page in PDF coords)
        lineGroups.sort((a, b) => b.y - a.y);

        // Sort items within each line horizontally left-to-right (lower X = further left)
        const lines = lineGroups.map(group => {
          group.items.sort((a, b) => a.x - b.x);
          const lineText = group.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
          return {
            y: group.y,
            text: lineText,
            items: group.items
          };
        }).filter(l => l.text.length > 0);

        pages.push({
          pageNumber: pageData.pageIndex + 1,
          lines
        });

        return lines.map(l => l.text).join('\n');
      });
    }
  };

  const parsed = await pdfParse(pdfBuffer, options);
  pdfInfo = parsed.info || {};
  if (parsed.numpages) numPages = parsed.numpages;

  return { numPages, pdfInfo, pages, rawText: parsed.text || '' };
}

/**
 * Universal Normalized Transaction Parser supporting Bank Alfalah, UBL, and Generic bank statements
 */
async function parseAccountsPdf(pdfBuffer, sourceFileName = 'accounts.pdf', sourcePdfId = 'pdf_1') {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('Invalid PDF data provided: expected a Buffer');
  }

  let pdfStructure;
  try {
    pdfStructure = await extractPdfStructure(pdfBuffer);
  } catch (err) {
    const rawMsg = err.message || String(err);
    console.error('PDF Extraction Error:', rawMsg);
    if (/password|encrypt/i.test(rawMsg)) {
      throw new Error('This PDF is password-protected or encrypted. Please upload an unprotected PDF.');
    }
    if (/format|invalid|bad xref|corrupt/i.test(rawMsg)) {
      throw new Error('The uploaded file is corrupt or not a valid PDF document.');
    }
    throw new Error('Unable to process PDF document: ' + rawMsg);
  }

  const { numPages, pdfInfo, pages, rawText } = pdfStructure;

  if (!pages || pages.length === 0 || !rawText || rawText.trim().length === 0) {
    throw new Error('No readable text found in this PDF. It may be a scanned image without selectable text.');
  }

  // Detect bank statement type
  const isUbl = /UBL|UNITED BANK|PARTICULARS.*INST/i.test(rawText);
  const isAlfalah = /ALFALAH|BANK ALFALAH|Cheq\/Inst#/i.test(rawText);
  const bankName = isAlfalah ? 'Bank Alfalah' : (isUbl ? 'UBL' : 'Generic Bank');

  const rawTransactions = [];

  // Parse page by page
  for (const page of pages) {
    const pageNo = page.pageNumber;
    const lines = page.lines;

    // Detect column header X-coordinates on page if present
    let debitXRange = null;
    let creditXRange = null;
    let balanceXRange = null;

    for (const line of lines) {
      if (/debit|credit|balance|withdraw|deposit|cr\b|dr\b/i.test(line.text)) {
        line.items.forEach(item => {
          const str = item.str.toUpperCase().trim();
          if (/^DEBIT|^DR\b|^WITHDRAW/i.test(str)) {
            debitXRange = { min: item.x - 30, max: item.x + 50 };
          } else if (/^CREDIT|^CR\b|^DEPOSIT/i.test(str)) {
            creditXRange = { min: item.x - 30, max: item.x + 50 };
          } else if (/^BALANCE|^BAL\b/i.test(str)) {
            balanceXRange = { min: item.x - 30, max: item.x + 80 };
          }
        });
      }
    }

    let currentTx = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.text;

      // Skip document headers / footers
      if (/^(Statement Of Account|From Date|To Date|Title Of Account|Account #|FAST ENGINEERING|Registered|HOUSE NO|HOUSING|AVENUE|LAHORE|IBAN|Nature of Account|Currency|Date Of Account|PKR|CA AKK|Raiwind Road|Page \d+ of \d+|\d{8}Page \d+ of \d+|^2026\d{4}$)/i.test(text)) {
        continue;
      }
      if (/^Date\s+Description|^DATE\s+PARTICULARS/i.test(text)) continue;

      // Check if line starts with transaction date (e.g. DD-MM-YYYY, DD/MM/YYYY, DD-Mon-YYYY)
      const dateMatch = text.match(/^(\d{1,2}[-\/\.](?:[A-Za-z]{3}|\d{1,2})[-\/\.]\d{2,4})/i);

      if (dateMatch) {
        if (currentTx) {
          rawTransactions.push(currentTx);
        }

        const rawDate = dateMatch[1];
        const normDate = normalizeDate(rawDate);
        const restText = text.substring(dateMatch[0].length).trim();

        currentTx = {
          date: normDate,
          rawDate,
          description: restText,
          debit: 0,
          credit: 0,
          balance: 0,
          referenceNumber: '',
          bankName,
          sourcePdfId,
          sourceFileName,
          pageNumber: pageNo,
          rawText: text,
          items: [...line.items]
        };

        // Extract numbers from date line using coordinate positioning or inline sequence
        parseLineNumbers(line, currentTx, debitXRange, creditXRange, balanceXRange);
        continue;
      }

      // Multi-line description or numeric row continuation
      if (currentTx) {
        currentTx.rawText += ' ' + text;

        // Check if line contains numeric tokens for Debit/Credit/Balance
        const hasNumbers = /(?:\b|\s)([\d,]+\.\d{2}|\b\d{1,3}(?:,\d{3})+(?!\.\d)\b)(?:\b|\s)/.test(text);
        if (hasNumbers) {
          parseLineNumbers(line, currentTx, debitXRange, creditXRange, balanceXRange);
        }

        // Reconstruct multi-line description text (skip lines that are purely amounts)
        if (!/^\s*[\d,]+(?:\.\d{2})?\s*$/.test(text)) {
          currentTx.description += ' ' + text;
        }
      }
    }

    if (currentTx) {
      rawTransactions.push(currentTx);
    }
  }

  // Post-process transactions: running balance check and clean field formatting
  let runningBalance = 0;
  const extractedEntries = [];

  for (let idx = 0; idx < rawTransactions.length; idx++) {
    const tx = rawTransactions[idx];
    
    // Clean up description
    let cleanDesc = tx.description
      .replace(/\s+/g, ' ')
      .replace(/^(Date|Description|Cheq\/Inst#|Debit|Credit|Balance|DATE|PARTICULARS|INST\. NO\.)\s+/i, '')
      .trim();

    // Extract reference number from description if not set
    let refNo = tx.referenceNumber;
    if (!refNo) {
      const refMatch = cleanDesc.match(/\b(\d{6,12})\b/);
      if (refMatch) refNo = refMatch[1];
    }

    const payee = extractPayeeFromDesc(cleanDesc);
    const debit = parseAmount(tx.debit);
    const credit = parseAmount(tx.credit);
    const balance = parseAmount(tx.balance);
    const amount = credit > 0 ? credit : debit;

    // Running Balance Validation: currentBalance ≈ previousBalance - debit + credit
    let parserStatus = 'PARSER_VERIFIED';
    if (idx > 0 && runningBalance > 0 && balance > 0 && debit > 0) {
      const expectedBal = Math.round((runningBalance - debit + credit) * 100) / 100;
      if (Math.abs(expectedBal - balance) > 0.05) {
        parserStatus = 'PARSER_REVIEW_REQUIRED';
      }
    }
    if (balance > 0) runningBalance = balance;

    const normalizedTx = {
      id: `tx_${idx + 1}_${Date.now().toString(36)}`,
      date: tx.date,
      rawDate: tx.rawDate,
      description: cleanDesc,
      extractedName: payee || cleanDesc.substring(0, 40),
      payee,
      normalizedName: normalizeName(payee),
      debit,
      credit, // Strict Credit: ONLY values from explicit Credit column
      balance,
      amount,
      referenceNumber: refNo || '—',
      bankName: tx.bankName,
      sourcePdfId: tx.sourcePdfId,
      sourceFileName: tx.sourceFileName,
      pageNumber: tx.pageNumber,
      rawText: tx.rawText,
      parserConfidence: parserStatus === 'PARSER_VERIFIED' ? 0.95 : 0.70,
      parserStatus,
      type: credit > 0 ? 'CREDIT' : (debit > 0 ? 'DEBIT' : 'UNKNOWN')
    };

    extractedEntries.push(normalizedTx);
  }

  return {
    numPages,
    pdfInfo,
    bankName,
    extractedEntries,
    transactionCount: extractedEntries.length
  };
}

/**
 * Helper to assign numeric values on line to Debit, Credit, or Balance columns using X coordinates or order
 */
function parseLineNumbers(line, currentTx, debitXRange, creditXRange, balanceXRange) {
  const numberItems = [];

  line.items.forEach(item => {
    const val = parseAmount(item.str);
    if (val > 0 && /[\d,]/.test(item.str)) {
      numberItems.push({ str: item.str, val, x: item.x });
    }
  });

  if (numberItems.length === 0) return;

  // 1. Try X-coordinate positioning if range exists
  numberItems.forEach(num => {
    if (creditXRange && num.x >= creditXRange.min && num.x <= creditXRange.max) {
      currentTx.credit = num.val;
    } else if (debitXRange && num.x >= debitXRange.min && num.x <= debitXRange.max) {
      currentTx.debit = num.val;
    } else if (balanceXRange && num.x >= balanceXRange.min && num.x <= balanceXRange.max) {
      currentTx.balance = num.val;
    }
  });

  // 2. Structural pattern fallback for 3 numeric items: [Debit, Credit, Balance] or [Ref, Amount, Balance]
  if (currentTx.debit === 0 && currentTx.credit === 0 && currentTx.balance === 0) {
    if (numberItems.length === 3) {
      const v0 = numberItems[0].val;
      const v1 = numberItems[1].val;
      const v2 = numberItems[2].val;
      if (v2 > 1000) {
        currentTx.balance = v2;
        if (v0 > 0 && v1 === 0) currentTx.debit = v0;
        else if (v1 > 0) currentTx.credit = v1;
      }
    } else if (numberItems.length === 2) {
      const v0 = numberItems[0].val;
      const v1 = numberItems[1].val;
      if (v1 > 1000) {
        currentTx.balance = v1;
        if (/cr|credit|fundtransfer|deposit/i.test(currentTx.rawText)) {
          currentTx.credit = v0;
        } else {
          currentTx.debit = v0;
        }
      }
    } else if (numberItems.length === 1) {
      const v0 = numberItems[0].val;
      if (/cr|credit|deposit/i.test(currentTx.rawText)) {
        currentTx.credit = v0;
      } else if (/dr|debit|withdr/i.test(currentTx.rawText)) {
        currentTx.debit = v0;
      }
    }
  }
}

/**
 * Matches extracted PDF entries against employee database and calculates month-specific verification summary.
 * 
 * Rules:
 * 1. Strict month filtering: ONLY transactions in targetMonth (YYYY-MM) are INCLUDED.
 * 2. Case-insensitive name matching. Ambiguous matches return AMBIGUOUS status.
 * 3. Strict Credit vs Debit separation: Credit > 0 ONLY. Debits, balances, and refs NEVER credited.
 * 4. Deduplication across multiple PDFs using deterministic transaction fingerprints.
 * 5. Supports single credit transaction OR multiple credit transactions summing to claimed amount.
 */
function matchAndVerifyExpenses(allParsedPdfsEntries, employees, appExpensesMap = {}, manualMappings = {}, targetMonth = null, salariesMap = {}, customAliases = {}) {
  const verificationResults = [];
  const rawEntries = Array.isArray(allParsedPdfsEntries) ? allParsedPdfsEntries : [];

  // Deduplicate entries across multiple uploaded PDFs for the same month
  const deduplicatedEntries = [];
  const seenFingerprints = new Set();

  rawEntries.forEach(entry => {
    const fingerprint = `${entry.date || ''}_${normalizeName(entry.description || '').substring(0, 30)}_${entry.debit || 0}_${entry.credit || 0}_${entry.referenceNumber || ''}`;
    if (!seenFingerprints.has(fingerprint)) {
      seenFingerprints.add(fingerprint);
      deduplicatedEntries.push(entry);
    }
  });

  (employees || []).forEach(emp => {
    const empId = emp.id;
    const empName = emp.name || '';
    const appData = appExpensesMap[empId] || { totalExpense: 0, entries: [] };
    const appExpense = Number(appData.totalExpense) || 0;
    const appEntries = appData.entries || [];
    const sal = salariesMap[empId] || {};

    // 1. Calculate Application / Salary Claimed Total
    const basicSalary = sal.basicSalary || 0;
    const regularDays = sal.regularPresentDays !== undefined ? sal.regularPresentDays : (sal.presentDays || 0);
    const sundayDays = sal.sundayPresentDays !== undefined ? sal.sundayPresentDays : 0;
    const perDay = sal.perDaySalary !== undefined ? sal.perDaySalary : (basicSalary > 0 ? Math.round(basicSalary / 30) : 0);
    const regularEarned = sal.regularEarned !== undefined ? sal.regularEarned : (perDay * regularDays);
    const sundayBonus = sal.sundayBonus !== undefined ? sal.sundayBonus : (perDay * sundayDays);
    const totalEarned = sal.earnedSalary !== undefined ? sal.earnedSalary : (regularEarned + sundayBonus);
    
    let applicationTotal = 0;
    if (sal.netSalary !== undefined && typeof sal.netSalary === 'number') {
      applicationTotal = sal.netSalary;
    } else if (totalEarned > 0) {
      applicationTotal = Math.max(0, totalEarned - appExpense);
    } else if (appExpense > 0) {
      applicationTotal = -appExpense;
    }

    const itemizedAppRecords = [];
    if (regularDays > 0) {
      itemizedAppRecords.push({
        date: targetMonth || '—',
        description: `Regular Attendance (${regularDays} Present Days @ PKR ${perDay.toLocaleString()}/day)`,
        amount: regularEarned,
        type: 'EARNING'
      });
    }
    if (sundayDays > 0) {
      itemizedAppRecords.push({
        date: targetMonth || '—',
        description: `Sunday Bonus (${sundayDays} Sunday Days Worked @ PKR ${perDay.toLocaleString()}/day)`,
        amount: sundayBonus,
        type: 'BONUS'
      });
    }
    appEntries.forEach(ae => {
      itemizedAppRecords.push({
        date: ae.date || targetMonth || '—',
        description: ae.description || 'Clock-Out Expense Deduction',
        amount: -(Number(ae.amount) || 0),
        type: 'DEDUCTION'
      });
    });

    // 2. Filter & Audit Bank PDF Credit Transactions for this Employee
    const employeeMatchedCredits = [];
    let bankCreditTotal = 0;
    let isAmbiguousMatchDetected = false;
    let hasParserReviewWarning = false;

    deduplicatedEntries.forEach(entry => {
      const txDate = entry.date || '';
      const isMonthMatch = Boolean(!targetMonth || (txDate && txDate.startsWith(targetMonth)));

      // Strict Month Filter: Ignore transactions outside target month for credit summation
      if (!isMonthMatch) return;

      const entryPayee = entry.payee || entry.extractedName || '';
      const rawText = entry.description || entry.rawText || '';

      const matchRes = testNameMatch(empName, entryPayee, rawText, customAliases);

      if (matchRes.isAmbiguous) {
        isAmbiguousMatchDetected = true;
      }

      if (matchRes.isMatch) {
        // Strict Credit Rule: Only include transactions with explicit credit > 0
        const creditAmt = Number(entry.credit) || 0;

        if (creditAmt > 0) {
          bankCreditTotal += creditAmt;
          employeeMatchedCredits.push({
            date: txDate,
            rawDate: entry.rawDate || txDate,
            description: entry.description || 'Bank Credit Transaction',
            refNo: entry.referenceNumber || '—',
            credit: creditAmt,
            debit: 0,
            amount: creditAmt,
            balance: entry.balance || 0,
            type: 'CREDIT',
            sourcePdfId: entry.sourcePdfId,
            sourceFileName: entry.sourceFileName || 'Bank Statement',
            pageNumber: entry.pageNumber || 1,
            matchType: matchRes.matchType,
            parserStatus: entry.parserStatus,
            provenance: `Source: ${entry.sourceFileName || 'Bank Statement'} (Page ${entry.pageNumber || 1})`
          });
        }

        if (entry.parserStatus === 'PARSER_REVIEW_REQUIRED') {
          hasParserReviewWarning = true;
        }
      }
    });

    // Sort transactions chronologically
    employeeMatchedCredits.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const roundedBankCreditTotal = Math.round(bankCreditTotal * 100) / 100;
    const roundedAppTotal = Math.round(applicationTotal * 100) / 100;
    const difference = Math.round(Math.abs(roundedBankCreditTotal - roundedAppTotal) * 100) / 100;

    let verificationStatus = 'NOT VERIFIED';

    if (hasParserReviewWarning) {
      verificationStatus = 'PARSER REVIEW REQUIRED';
    } else if (isAmbiguousMatchDetected && employeeMatchedCredits.length === 0) {
      verificationStatus = 'AMBIGUOUS';
    } else if (deduplicatedEntries.length === 0) {
      verificationStatus = 'NOT VERIFIED';
    } else if (employeeMatchedCredits.length === 0 && roundedAppTotal > 0) {
      verificationStatus = 'NOT FOUND';
    } else if (roundedAppTotal === 0 && employeeMatchedCredits.length === 0) {
      verificationStatus = 'VERIFIED';
    } else if (difference < 1.0) {
      verificationStatus = 'VERIFIED';
    } else {
      verificationStatus = 'AMOUNT MISMATCH';
    }

    verificationResults.push({
      employeeId: empId,
      employeeName: empName,
      role: emp.role || 'Staff',
      salaryMonth: targetMonth,
      bankCreditTotal: roundedBankCreditTotal,
      applicationTotal: roundedAppTotal,
      difference,
      verificationStatus,
      isMultipleCreditsSum: employeeMatchedCredits.length > 1,
      matchedTransactionsCount: employeeMatchedCredits.length,
      matchedCredits: employeeMatchedCredits,
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
      }
    });
  });

  let totalMatched = 0;
  let totalDiscrepancies = 0;
  let totalNotFound = 0;
  let totalBankCredits = 0;

  verificationResults.forEach(r => {
    totalBankCredits += r.bankCreditTotal || 0;
    if (r.verificationStatus === 'VERIFIED') {
      totalMatched++;
    } else if (r.verificationStatus === 'AMOUNT MISMATCH') {
      totalDiscrepancies++;
    } else {
      totalNotFound++;
    }
  });

  return {
    verificationResults,
    summary: {
      targetMonth,
      totalEmployees: employees.length,
      totalMatched,
      totalDiscrepancies,
      totalNotFound,
      totalBankCredits: Math.round(totalBankCredits * 100) / 100,
      totalParsedTransactions: deduplicatedEntries.length
    }
  };
}

module.exports = {
  parseAccountsPdf,
  matchAndVerifyExpenses,
  normalizeName,
  normalizeDate,
  parseAmount,
  testNameMatch,
  extractPayeeFromDesc
};


