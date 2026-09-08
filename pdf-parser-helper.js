/**
 * pdf-parser-helper.js
 * Intelligent PDF Parser & Employee Expense Comparator
 * 
 * Extracts employee names, dates, descriptions, and expense amounts from
 * Accounts Department PDFs without confusing balances, account numbers, or serials.
 */

// Polyfill DOMMatrix, Path2D, and ImageData for Node.js / Vercel Serverless (required by pdfjs-dist / pdf-parse v2)
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrix {
    constructor(init) {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
      this.is2D = true;
      this.isIdentity = true;

      if (Array.isArray(init)) {
        if (init.length === 6) {
          this.a = this.m11 = init[0];
          this.b = this.m12 = init[1];
          this.c = this.m21 = init[2];
          this.d = this.m22 = init[3];
          this.e = this.m41 = init[4];
          this.f = this.m42 = init[5];
        } else if (init.length === 16) {
          this.m11 = this.a = init[0]; this.m12 = this.b = init[1]; this.m13 = init[2]; this.m14 = init[3];
          this.m21 = this.c = init[4]; this.m22 = this.d = init[5]; this.m23 = init[6]; this.m24 = init[7];
          this.m31 = init[8]; this.m32 = init[9]; this.m33 = init[10]; this.m34 = init[11];
          this.m41 = this.e = init[12]; this.m42 = this.f = init[13]; this.m43 = init[14]; this.m44 = init[15];
          this.is2D = false;
        }
      }
    }
    multiply() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint(p) { return p || { x: 0, y: 0, z: 0, w: 1 }; }
    inverse() { return new DOMMatrix(); }
    toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
  }
  globalThis.DOMMatrix = DOMMatrix;
  if (typeof global !== 'undefined') global.DOMMatrix = DOMMatrix;
}

if (typeof globalThis.Path2D === 'undefined') {
  class Path2D {
    constructor() {}
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
  }
  globalThis.Path2D = Path2D;
  if (typeof global !== 'undefined') global.Path2D = Path2D;
}

if (typeof globalThis.ImageData === 'undefined') {
  class ImageData {
    constructor(width, height) {
      this.width = width || 1;
      this.height = height || 1;
      this.data = new Uint8ClampedArray((this.width * this.height) * 4);
    }
  }
  globalThis.ImageData = ImageData;
  if (typeof global !== 'undefined') global.ImageData = ImageData;
}

const pdfParseModule = require('pdf-parse');

function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^(mr\.|ms\.|mrs\.|engr\.|dr\.|muhammad\s+engr\.)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmount(amountStr) {
  if (typeof amountStr === 'number') return isNaN(amountStr) ? 0 : amountStr;
  if (!amountStr) return 0;
  
  const cleaned = String(amountStr)
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '')
    .trim();
  
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(Math.abs(val) * 100) / 100;
}

async function parseAccountsPdf(pdfBuffer) {
  let pdfText = '';
  let numPages = 1;
  let pdfInfo = {};

  try {
    if (typeof pdfParseModule === 'function') {
      const data = await pdfParseModule(pdfBuffer);
      pdfText = data.text || '';
      numPages = data.numpages || 1;
      pdfInfo = data.info || {};
    } else if (pdfParseModule && pdfParseModule.PDFParse) {
      const parser = new pdfParseModule.PDFParse({ data: pdfBuffer });
      const textResult = await parser.getText();
      pdfText = textResult.text || '';
      numPages = textResult.pages ? textResult.pages.length : (textResult.numpages || 1);
      pdfInfo = textResult.info || {};
    } else {
      throw new Error('Unsupported PDF parse module export');
    }
  } catch (err) {
    throw new Error('Unable to process this PDF. Please verify that the PDF is valid and readable: ' + err.message);
  }

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

    if (/^(page\s+\d+|salary\s+sheet|accounts\s+department|monthly\s+report|generated\s+on|sr#|sr\.|s\.no|total\s*:)/i.test(line)) {
      continue;
    }

    if (line.includes(':') && /\d+/.test(line)) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const potentialName = parts[0].replace(/^(employee|staff|name|emp)\s+/i, '').trim();
        const potentialAmountMatch = parts[parts.length - 1].match(/([\d,]+(?:\.\d{2})?)/);
        if (potentialName.length > 2 && potentialAmountMatch) {
          const amt = parseAmount(potentialAmountMatch[1]);
          if (amt > 0) {
            extractedEntries.push({
              extractedName: potentialName,
              amount: amt,
              rawLine: line,
              details: line
            });
            continue;
          }
        }
      }
    }

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
        const targetAmount = validAmounts[validAmounts.length - 1].val;

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

    if (manualMappings && manualMappings[empId]) {
      const mappedNorm = normalizeName(manualMappings[empId]);
      if (pdfEmployeeMap.has(mappedNorm)) {
        matchedPdfItem = pdfEmployeeMap.get(mappedNorm);
        matchedPdfNorms.add(mappedNorm);
        confidence = 1.0;
        matchType = 'MANUAL';
      }
    }

    if (!matchedPdfItem && pdfEmployeeMap.has(empNorm)) {
      matchedPdfItem = pdfEmployeeMap.get(empNorm);
      matchedPdfNorms.add(empNorm);
      confidence = 1.0;
      matchType = 'EXACT_NAME';
    }

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
  parseAmount
};
