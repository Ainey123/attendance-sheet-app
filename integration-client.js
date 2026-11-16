/**
 * FES Attendance App <-> Accounts App Integration Security & Client Module
 * Phase 2: Server-to-Server HMAC-SHA256 Signing, Verification, Replay Protection,
 * Idempotency Tracking, and Zero-Duplication Attachment Metadata Handling.
 */

const crypto = require('crypto');

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes replay tolerance
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;   // 10 minutes in-memory idempotency cache TTL
const DEFAULT_TIMEOUT_MS = 8000;

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

const BILL_STATUS_TO_ACCOUNTS_APPROVAL_STATUS = {
  SUBMITTED: 'RECEIVED',
  PENDING_VERIFICATION: 'RECEIVED',
  PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  VERIFIED: 'VERIFIED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

// In-memory replay & idempotency registry: key -> { bodyHash, path, method, timestamp, result }
const _idempotencyStore = new Map();

function cleanupIdempotencyStore(now = Date.now()) {
  for (const [key, entry] of _idempotencyStore.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      _idempotencyStore.delete(key);
    }
  }
}

function getIntegrationConfig(overrides = {}) {
  const enabledRaw = overrides.enabled ?? process.env.FES_INTEGRATION_ENABLED ?? 'true';
  const enabled = String(enabledRaw).toLowerCase() !== 'false' && String(enabledRaw) !== '0';
  const accountsBaseUrl = String(overrides.accountsBaseUrl ?? process.env.ACCOUNTS_APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(overrides.apiKey ?? process.env.FES_INTEGRATION_API_KEY ?? '').trim();
  const secret = String(overrides.secret ?? process.env.FES_INTEGRATION_SECRET ?? '').trim();
  const timeoutMs = Number(overrides.timeoutMs ?? process.env.FES_INTEGRATION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  return {
    enabled,
    accountsBaseUrl,
    apiKey,
    secret,
    timeoutMs,
    isConfigured: Boolean(enabled && accountsBaseUrl && apiKey && secret)
  };
}

/**
 * Normalizes a URL or path to a canonical "/path?query" format so both
 * sender and receiver compute the exact same HMAC canonical string.
 */
function normalizeIntegrationPath(pathOrUrl) {
  const raw = String(pathOrUrl || '/').trim();
  if (!raw) return '/';

  let pathname = raw;
  let search = '';

  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    pathname = parsed.pathname;
    search = parsed.search || '';
  } else {
    const qIdx = raw.indexOf('?');
    if (qIdx !== -1) {
      pathname = raw.slice(0, qIdx);
      search = raw.slice(qIdx);
    }
  }

  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '');
  }

  // Canonicalize query parameters if present
  if (search && search.length > 1) {
    const params = new URLSearchParams(search.slice(1));
    const sortedKeys = Array.from(new Set(params.keys())).sort();
    const sortedParams = new URLSearchParams();
    for (const k of sortedKeys) {
      const values = params.getAll(k).sort();
      for (const v of values) {
        sortedParams.append(k, v);
      }
    }
    const qs = sortedParams.toString();
    search = qs ? `?${qs}` : '';
  } else {
    search = '';
  }

  return `${pathname}${search}`;
}

/**
 * Computes SHA-256 hex digest of a request body string or object.
 */
function hashPayloadBody(body) {
  let rawString = '';
  if (typeof body === 'string') {
    rawString = body;
  } else if (Buffer.isBuffer(body)) {
    return crypto.createHash('sha256').update(body).digest('hex');
  } else if (body !== undefined && body !== null) {
    rawString = JSON.stringify(body);
  }
  return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
}

/**
 * Builds the canonical string signed by HMAC-SHA256.
 * Format:
 *   METHOD\nNORMALIZED_PATH\nTIMESTAMP\nIDEMPOTENCY_KEY\nBODY_SHA256_HEX
 */
function buildCanonicalString({ method, path, timestamp, idempotencyKey, bodyHash }) {
  const normMethod = String(method || 'POST').toUpperCase().trim();
  const normPath = normalizeIntegrationPath(path);
  const normTs = String(timestamp ?? '').trim();
  const normIdem = String(idempotencyKey ?? '').trim();
  const normHash = String(bodyHash ?? '').trim().toLowerCase();

  return [normMethod, normPath, normTs, normIdem, normHash].join('\n');
}

/**
 * Computes HMAC-SHA256 hex signature over the canonical request components.
 */
function computeHmacSignature({ secret, method, path, timestamp, idempotencyKey, body, bodyHash }) {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('Integration signing secret (FES_INTEGRATION_SECRET) is required.');
  }
  const resolvedBodyHash = bodyHash || hashPayloadBody(body);
  const canonical = buildCanonicalString({
    method,
    path,
    timestamp,
    idempotencyKey,
    bodyHash: resolvedBodyHash
  });
  return crypto.createHmac('sha256', secret.trim()).update(canonical, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function safeCompareStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates deterministic or random idempotency key.
 */
function generateIdempotencyKey(prefix = 'fes', deterministicSuffix = null) {
  if (deterministicSuffix) {
    const cleanSuffix = String(deterministicSuffix).replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    return `${prefix}_${cleanSuffix}`;
  }
  const uuid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `${prefix}_${uuid}`;
}

/**
 * Creates signed HTTP headers for an outbound server-to-server request.
 */
function createSignedHeaders({
  method = 'POST',
  path = '/',
  body = '',
  idempotencyKey = null,
  timestamp = Date.now(),
  apiKey = process.env.FES_INTEGRATION_API_KEY,
  secret = process.env.FES_INTEGRATION_SECRET
} = {}) {
  const cleanApiKey = String(apiKey || '').trim();
  const cleanSecret = String(secret || '').trim();
  if (!cleanApiKey || !cleanSecret) {
    throw new Error('Missing FES_INTEGRATION_API_KEY or FES_INTEGRATION_SECRET for signing request.');
  }

  const tsStr = String(timestamp);
  const idemKey = idempotencyKey ? String(idempotencyKey).trim() : generateIdempotencyKey('att');
  const bodyHash = hashPayloadBody(body);
  const signature = computeHmacSignature({
    secret: cleanSecret,
    method,
    path,
    timestamp: tsStr,
    idempotencyKey: idemKey,
    bodyHash
  });

  return {
    'Content-Type': 'application/json',
    'X-FES-Api-Key': cleanApiKey,
    'X-FES-Timestamp': tsStr,
    'X-FES-Idempotency-Key': idemKey,
    'X-FES-Signature': signature
  };
}

/**
 * Verifies an inbound signed server-to-server request or webhook.
 * Checks:
 *  1. Integration enabled & configured
 *  2. Valid X-FES-Api-Key (constant-time)
 *  3. Valid X-FES-Timestamp within ±5 minutes
 *  4. Valid X-FES-Idempotency-Key & replay conflict check
 *  5. Valid X-FES-Signature (HMAC-SHA256, constant-time)
 */
function verifySignedRequest({
  method = 'POST',
  path = '/',
  headers = {},
  rawBody = '',
  apiKey = process.env.FES_INTEGRATION_API_KEY,
  secret = process.env.FES_INTEGRATION_SECRET,
  now = Date.now(),
  maxSkewMs = MAX_TIMESTAMP_SKEW_MS,
  recordIdempotency = true
} = {}) {
  const expectedApiKey = String(apiKey || '').trim();
  const expectedSecret = String(secret || '').trim();
  if (!expectedApiKey || !expectedSecret) {
    return {
      valid: false,
      status: 503,
      code: 'INTEGRATION_NOT_CONFIGURED',
      error: 'Integration credentials are not configured on the server.'
    };
  }

  // Case-insensitive header lookup
  const getHeader = (name) => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers || {})) {
      if (k.toLowerCase() === lower) {
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return undefined;
  };

  const providedApiKey = String(getHeader('x-fes-api-key') || '').trim();
  const providedTimestamp = String(getHeader('x-fes-timestamp') || '').trim();
  const providedIdempotencyKey = String(getHeader('x-fes-idempotency-key') || '').trim();
  const providedSignature = String(getHeader('x-fes-signature') || '').trim().toLowerCase();

  if (!providedApiKey || !providedTimestamp || !providedIdempotencyKey || !providedSignature) {
    return {
      valid: false,
      status: 401,
      code: 'MISSING_AUTH_HEADERS',
      error: 'Missing required FES integration authentication headers.'
    };
  }

  if (!safeCompareStrings(providedApiKey, expectedApiKey)) {
    return {
      valid: false,
      status: 401,
      code: 'INVALID_API_KEY',
      error: 'Invalid X-FES-Api-Key.'
    };
  }

  const tsNum = Number(providedTimestamp);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return {
      valid: false,
      status: 401,
      code: 'INVALID_TIMESTAMP',
      error: 'Invalid X-FES-Timestamp header format.'
    };
  }

  const skew = Math.abs(now - tsNum);
  if (skew > maxSkewMs) {
    return {
      valid: false,
      status: 401,
      code: 'TIMESTAMP_EXPIRED',
      error: `Request timestamp outside allowed ±${Math.round(maxSkewMs / 1000)}s replay window.`
    };
  }

  const bodyHash = hashPayloadBody(rawBody);
  const expectedSignature = computeHmacSignature({
    secret: expectedSecret,
    method,
    path,
    timestamp: providedTimestamp,
    idempotencyKey: providedIdempotencyKey,
    bodyHash
  });

  if (!safeCompareStrings(providedSignature, expectedSignature)) {
    return {
      valid: false,
      status: 401,
      code: 'INVALID_SIGNATURE',
      error: 'HMAC-SHA256 signature verification failed.'
    };
  }

  cleanupIdempotencyStore(now);
  const normPath = normalizeIntegrationPath(path);
  const normMethod = String(method || 'POST').toUpperCase().trim();
  const existingEntry = _idempotencyStore.get(providedIdempotencyKey);

  if (existingEntry) {
    if (existingEntry.bodyHash !== bodyHash || existingEntry.path !== normPath || existingEntry.method !== normMethod) {
      return {
        valid: false,
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        error: 'Idempotency key was already used with a different request payload or endpoint.'
      };
    }
    return {
      valid: true,
      status: 200,
      isDuplicateReplay: true,
      idempotencyKey: providedIdempotencyKey,
      timestamp: tsNum,
      bodyHash,
      cachedResult: existingEntry.result || null
    };
  }

  if (recordIdempotency) {
    _idempotencyStore.set(providedIdempotencyKey, {
      bodyHash,
      path: normPath,
      method: normMethod,
      timestamp: now,
      result: null
    });
  }

  return {
    valid: true,
    status: 200,
    isDuplicateReplay: false,
    idempotencyKey: providedIdempotencyKey,
    timestamp: tsNum,
    bodyHash
  };
}

function storeIdempotencyResult(idempotencyKey, result) {
  if (!idempotencyKey) return;
  const entry = _idempotencyStore.get(idempotencyKey);
  if (entry) {
    entry.result = result;
  }
}

function clearIdempotencyStore() {
  _idempotencyStore.clear();
}

/**
 * Validates and normalizes an attachment MIME type against the safe allowlist.
 * Blocks dangerous types such as image/svg+xml, text/html, application/javascript.
 */
function validateAttachmentMimeType(mimeType, fileName = '') {
  const rawType = String(mimeType || '').toLowerCase().trim().split(';')[0];
  if (ALLOWED_ATTACHMENT_MIME_TYPES.has(rawType)) {
    return {
      valid: true,
      normalizedType: rawType === 'image/jpg' ? 'image/jpeg' : rawType
    };
  }

  // Fallback check from dataUrl or extension only if safe
  const ext = String(fileName || '').toLowerCase().trim();
  if (!rawType) {
    if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return { valid: true, normalizedType: 'image/jpeg' };
    if (ext.endsWith('.png')) return { valid: true, normalizedType: 'image/png' };
    if (ext.endsWith('.webp')) return { valid: true, normalizedType: 'image/webp' };
    if (ext.endsWith('.pdf')) return { valid: true, normalizedType: 'application/pdf' };
  }

  return {
    valid: false,
    normalizedType: null,
    error: `Unsupported or unsafe attachment MIME type "${rawType || 'unknown'}". Allowed: JPEG, PNG, WEBP, PDF.`
  };
}

/**
 * Extracts lightweight attachment metadata from a bill's attachments array,
 * stripping all raw Base64 dataUrl strings so large blobs are NEVER duplicated
 * into the Accounts App database.
 */
function extractAttachmentMetadata(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  const sanitized = [];
  attachments.forEach((att, index) => {
    if (!att || typeof att !== 'object') return;
    const name = String(att.name || `attachment_${index + 1}`).replace(/[^\w.\- ()]/g, '_').slice(0, 120);

    let detectedMime = att.type || '';
    if (!detectedMime && typeof att.dataUrl === 'string') {
      const m = att.dataUrl.match(/^data:([^;,]+)[;,]/i);
      if (m) detectedMime = m[1];
    }

    const mimeCheck = validateAttachmentMimeType(detectedMime, name);
    if (!mimeCheck.valid) {
      return; // Skip unsafe/disallowed MIME types
    }

    let sizeBytes = Number(att.size) || 0;
    if (!sizeBytes && typeof att.dataUrl === 'string') {
      const commaIdx = att.dataUrl.indexOf(',');
      const b64 = commaIdx !== -1 ? att.dataUrl.slice(commaIdx + 1) : att.dataUrl;
      sizeBytes = Math.floor((b64.length * 3) / 4);
    }

    const hasBinary = Boolean(
      (typeof att.dataUrl === 'string' && /^data:[^;,]+;base64,[A-Za-z0-9+/=\r\n]+$/i.test(att.dataUrl.trim())) ||
      (typeof att.url === 'string' && /^https?:\/\//i.test(att.url.trim()))
    );

    sanitized.push({
      index,
      name,
      type: mimeCheck.normalizedType,
      size: sizeBytes,
      isPdf: mimeCheck.normalizedType === 'application/pdf',
      hasBinary
    });
  });

  return sanitized;
}

/**
 * Builds the relative proxy path stored in Accounts App `Expense.imageUrl`
 * for on-demand authenticated streaming of the bill's receipt.
 */
function buildAttachmentProxyUrl(billId, index = 0) {
  if (!billId) return null;
  return `/api/integration/attachments?billId=${encodeURIComponent(String(billId).trim())}&index=${Number(index) || 0}`;
}

/**
 * Maps an Attendance App bill record to the exact Accounts App approvalStatus
 * and enforces the business rule:
 * "Claimed expenses should appear as RECEIVED/PENDING APPROVAL but must not count
 *  toward the approved complaint expense total until approval."
 */
function resolveSyncedExpenseAmounts(bill = {}) {
  const rawStatus = String(bill.status || 'SUBMITTED').toUpperCase().trim();
  const approvalStatus = BILL_STATUS_TO_ACCOUNTS_APPROVAL_STATUS[rawStatus] || 'RECEIVED';

  const claimedAmount = Math.max(0, Number(bill.totalClaimedAmount ?? bill.claimedAmount) || 0);
  const verifiedAmount = bill.totalVerifiedAmount !== null && bill.totalVerifiedAmount !== undefined
    ? Math.max(0, Number(bill.totalVerifiedAmount) || 0)
    : (bill.verifiedAmount !== null && bill.verifiedAmount !== undefined ? Math.max(0, Number(bill.verifiedAmount) || 0) : null);

  const approvedAmount = bill.totalApprovedAmount !== null && bill.totalApprovedAmount !== undefined
    ? Math.max(0, Number(bill.totalApprovedAmount) || 0)
    : (bill.approvedAmount !== null && bill.approvedAmount !== undefined ? Math.max(0, Number(bill.approvedAmount) || 0) : null);

  // Business Rule: Only APPROVED / PARTIALLY_APPROVED bills contribute to the approved expense `amount`.
  // While RECEIVED, PARTIALLY_VERIFIED, VERIFIED, or REJECTED, `amount` is 0 and `claimedAmount` holds the claim.
  const isApprovedStage = approvalStatus === 'APPROVED' || approvalStatus === 'PARTIALLY_APPROVED';
  const effectiveApprovedAmount = isApprovedStage
    ? (approvedAmount !== null ? approvedAmount : 0)
    : 0;

  return {
    approvalStatus,
    claimedAmount,
    verifiedAmount,
    approvedAmount: isApprovedStage ? effectiveApprovedAmount : approvedAmount,
    effectiveApprovedAmount
  };
}

/**
 * Builds a clean, Base64-free sync payload from an Attendance App bill record.
 */
function buildExpenseSyncPayload(bill) {
  if (!bill || !bill.id) {
    throw new Error('Valid bill object with id is required to build sync payload.');
  }

  const amounts = resolveSyncedExpenseAmounts(bill);
  const attachmentsMeta = extractAttachmentMetadata(bill.attachments || []);

  return {
    externalBillId: String(bill.id).trim(),
    billNumber: String(bill.billNumber || '').trim(),
    employeeId: String(bill.employeeId || '').trim(),
    employeeName: String(bill.employeeName || 'Employee').trim(),
    siteName: String(bill.siteName || '').trim(),
    clientName: bill.clientName ? String(bill.clientName).trim() : null,
    workNature: bill.workNature ? String(bill.workNature).trim() : null,
    ticketId: bill.externalTicketId ? Number(bill.externalTicketId) : null,
    ticketSerialNo: bill.externalTicketSerialNo ? String(bill.externalTicketSerialNo).trim() : null,
    jobMetadataId: bill.externalJobMetadataId ? Number(bill.externalJobMetadataId) : null,
    billDate: bill.billDate || bill.date || null,
    submittedAt: bill.submittedAt || bill.createdAt || new Date().toISOString(),
    description: String(bill.description || '').trim(),
    breakdown: {
      transportation: Math.max(0, Number(bill.transportationExpense) || 0),
      material: Math.max(0, Number(bill.materialExpense) || 0),
      labour: Math.max(0, Number(bill.labourExpense) || 0),
      accommodation: Math.max(0, Number(bill.accommodationExpense) || 0),
      other: Math.max(0, Number(bill.otherExpense) || 0),
      categories: bill.categories || {}
    },
    totalClaimedAmount: amounts.claimedAmount,
    totalVerifiedAmount: amounts.verifiedAmount,
    totalApprovedAmount: amounts.approvedAmount,
    effectiveApprovedAmount: amounts.effectiveApprovedAmount,
    billStatus: bill.status || 'SUBMITTED',
    approvalStatus: amounts.approvalStatus,
    verifiedBy: bill.verifiedBy || null,
    verifiedAt: bill.verifiedAt || null,
    verificationComment: bill.verificationComment || null,
    approvedBy: bill.approvedBy || null,
    approvedAt: bill.approvedAt || null,
    approvalComment: bill.approvalComment || null,
    rejectedBy: bill.rejectedBy || null,
    rejectedAt: bill.rejectedAt || null,
    rejectionReason: bill.rejectionReason || null,
    attachmentsMeta,
    primaryAttachmentProxyUrl: attachmentsMeta.length > 0 ? buildAttachmentProxyUrl(bill.id, attachmentsMeta[0].index) : null
  };
}

/**
 * Redacts sensitive headers and Base64 blobs before logging.
 */
function sanitizeForLog(obj = {}) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveKeys = ['x-fes-api-key', 'x-fes-signature', 'x-admin-passcode', 'x-senior-passcode', 'secret', 'apikey', 'password', 'pin', 'dataurl'];

  for (const key of Object.keys(copy)) {
    const lower = key.toLowerCase();
    if (sensitiveKeys.some(sk => lower.includes(sk))) {
      copy[key] = '[REDACTED]';
    } else if (typeof copy[key] === 'object' && copy[key] !== null) {
      copy[key] = sanitizeForLog(copy[key]);
    }
  }
  return copy;
}

const SELECTION_ATTN_FALLBACK = crypto
  .createHash('sha256')
  .update(String(process.env.VERCEL_URL || process.cwd() || 'fes-attendance-local'))
  .digest('hex');

function getSelectionSigningKey(explicitSecret = null) {
  const configured = String(explicitSecret || process.env.FES_INTEGRATION_SECRET || '').trim();
  return configured || SELECTION_ATTN_FALLBACK;
}

/**
 * Validates and normalizes an authoritative ticket object returned by the Accounts App.
 * Rejects any incomplete ticket/JobMetadata entry.
 */
function normalizeAuthoritativeTicket(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ticketId = Number(raw.ticketId ?? raw.id);
  const jobMetadataId = Number(raw.jobMetadataId ?? raw.jobId);
  const serialNo = String(raw.serialNo ?? raw.ticketNumber ?? '').trim();
  const branchName = String(raw.branchName ?? '').trim();
  const clientName = String(raw.clientName ?? '').trim();
  const workNature = String(raw.workNature ?? '').trim();

  if (
    !Number.isInteger(ticketId) ||
    ticketId <= 0 ||
    !Number.isInteger(jobMetadataId) ||
    jobMetadataId <= 0 ||
    !serialNo ||
    !branchName ||
    !clientName ||
    !workNature
  ) {
    return null;
  }

  return {
    ticketId,
    serialNo,
    ticketNumber: serialNo,
    jobMetadataId,
    branchName,
    clientName,
    personOfContact: String(raw.personOfContact ?? '').trim(),
    workNature,
    subject: String(raw.subject ?? '').trim(),
    ticketStatus: String(raw.ticketStatus ?? 'RELEVANT').trim(),
    exactDate: raw.exactDate ? String(raw.exactDate).slice(0, 10) : null,
    exactMatch: Boolean(raw.exactMatch)
  };
}

/**
 * Signs an authoritative ticket snapshot on the Attendance server before sending
 * results to the browser so the browser cannot tamper with authoritative metadata
 * prior to bill submission.
 */
function signAuthoritativeTicketSelection(ticket, secretOverride = null) {
  const norm = normalizeAuthoritativeTicket(ticket);
  if (!norm) return null;
  const key = getSelectionSigningKey(secretOverride);
  const canonical = JSON.stringify([
    norm.ticketId,
    norm.serialNo,
    norm.jobMetadataId,
    norm.branchName,
    norm.clientName,
    norm.workNature,
    norm.subject
  ]);
  return crypto.createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
}

function verifyAuthoritativeTicketSelection(ticket, token, secretOverride = null) {
  if (!token || typeof token !== 'string') return false;
  const expected = signAuthoritativeTicketSelection(ticket, secretOverride);
  if (!expected) return false;
  return safeCompareStrings(String(token).trim().toLowerCase(), expected.toLowerCase());
}

/**
 * Server-to-server call from Attendance App -> Accounts App:
 * POST /api/integration/tickets/lookup
 * Never exposes API key or HMAC secret to frontend code.
 */
async function lookupAuthoritativeTickets(criteria = {}, options = {}) {
  const cfg = getIntegrationConfig(options.config || {});
  if (!cfg.enabled) {
    return {
      ok: false,
      unavailable: true,
      status: 503,
      code: 'INTEGRATION_DISABLED',
      error: 'Accounts ticket lookup is currently disabled. You can still submit an unlinked bill.',
      tickets: []
    };
  }

  const query = String(criteria.query ?? criteria.q ?? criteria.search ?? '').trim();
  const serialNo = String(criteria.serialNo ?? criteria.ticketNumber ?? '').trim();
  const branchName = String(criteria.branchName ?? criteria.siteName ?? '').trim();
  const clientName = String(criteria.clientName ?? '').trim();
  const workNature = String(criteria.workNature ?? '').trim();
  const personOfContact = String(criteria.personOfContact ?? '').trim();
  const limit = Number(criteria.limit) || 15;

  if (!query && !serialNo && !branchName && !clientName && !workNature && !personOfContact) {
    return {
      ok: false,
      unavailable: false,
      status: 400,
      code: 'MISSING_SEARCH_CRITERIA',
      error: 'Please enter a ticket number, client name, branch/site, or work nature to search.',
      tickets: []
    };
  }

  if (!cfg.isConfigured) {
    return {
      ok: false,
      unavailable: true,
      status: 503,
      code: 'INTEGRATION_NOT_CONFIGURED',
      error: 'Accounts ticket integration is not configured yet. You can continue with an unlinked bill.',
      tickets: []
    };
  }

  const endpointUrl = `${cfg.accountsBaseUrl}/api/integration/tickets/lookup`;
  const payloadObj = {
    query: query || undefined,
    serialNo: serialNo || undefined,
    branchName: branchName || undefined,
    clientName: clientName || undefined,
    workNature: workNature || undefined,
    personOfContact: personOfContact || undefined,
    limit
  };
  const rawBody = JSON.stringify(payloadObj);

  const signedHeaders = createSignedHeaders({
    method: 'POST',
    path: endpointUrl,
    body: rawBody,
    idempotencyKey: options.idempotencyKey || generateIdempotencyKey('tkt'),
    apiKey: cfg.apiKey,
    secret: cfg.secret
  });

  const fetchImpl = options.fetchFn || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      unavailable: true,
      status: 503,
      code: 'FETCH_UNAVAILABLE',
      error: 'Server HTTP client is unavailable.',
      tickets: []
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let response;
  let responseText = '';
  try {
    response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: signedHeaders,
      body: rawBody,
      signal: controller.signal
    });
    responseText = await response.text();
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort'));
    return {
      ok: false,
      unavailable: true,
      status: isTimeout ? 504 : 503,
      code: isTimeout ? 'ACCOUNTS_TIMEOUT' : 'ACCOUNTS_UNAVAILABLE',
      error: isTimeout
        ? 'Accounts App ticket lookup timed out. Please retry or continue with an unlinked bill.'
        : 'Unable to reach Accounts App right now. You can continue submitting your bill as Unlinked.',
      tickets: []
    };
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    return {
      ok: false,
      unavailable: true,
      status: 502,
      code: 'MALFORMED_RESPONSE',
      error: 'Accounts App returned a malformed response. You can retry or submit an unlinked bill.',
      tickets: []
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      unavailable: true,
      status: 502,
      code: 'MALFORMED_RESPONSE',
      error: 'Accounts App returned an invalid response payload.',
      tickets: []
    };
  }

  if (!response.ok || parsed.success === false) {
    const code = String(parsed.code || `HTTP_${response.status}`);
    const isAuthOrConfig = response.status === 401 || response.status === 403 || response.status === 503;
    return {
      ok: false,
      unavailable: response.status >= 500 || isAuthOrConfig,
      status: response.status || 502,
      code,
      error:
        response.status === 401 || response.status === 403
          ? 'Accounts integration authentication failed. Please contact Admin or submit as an unlinked bill.'
          : (parsed.error || 'Ticket lookup failed. You can retry or continue with an unlinked bill.'),
      tickets: []
    };
  }

  if (!Array.isArray(parsed.tickets)) {
    return {
      ok: false,
      unavailable: true,
      status: 502,
      code: 'MALFORMED_RESPONSE',
      error: 'Accounts App response was missing the tickets list.',
      tickets: []
    };
  }

  const seenIds = new Set();
  const normalizedTickets = [];
  for (const item of parsed.tickets) {
    const clean = normalizeAuthoritativeTicket(item);
    if (!clean) continue; // Reject incomplete/non-authoritative items client-side too
    if (seenIds.has(clean.ticketId)) continue;
    seenIds.add(clean.ticketId);
    normalizedTickets.push({
      ...clean,
      selectionToken: signAuthoritativeTicketSelection(clean, cfg.secret)
    });
  }

  return {
    ok: true,
    unavailable: false,
    status: 200,
    count: normalizedTickets.length,
    multipleMatches: normalizedTickets.length > 1,
    noMatch: normalizedTickets.length === 0,
    tickets: normalizedTickets
  };
}

/**
 * Decodes and MIME-validates an attachment entry (containing dataUrl) for
 * secure on-demand binary streaming without trusting unsafe types (e.g. SVG/HTML).
 */
function decodeBillAttachmentDataUrl(attachment) {
  if (!attachment || typeof attachment !== 'object' || typeof attachment.dataUrl !== 'string') {
    return { valid: false, status: 404, error: 'Attachment binary data is unavailable.' };
  }

  const dataUrl = attachment.dataUrl.trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) {
    return { valid: false, status: 422, error: 'Attachment is not a valid Base64 data URI.' };
  }

  const rawMime = String(attachment.type || match[1] || '').toLowerCase().trim();
  const mimeCheck = validateAttachmentMimeType(rawMime, attachment.name || '');
  if (!mimeCheck.valid) {
    return { valid: false, status: 415, error: mimeCheck.error };
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  const safeName = String(attachment.name || 'receipt').replace(/[^\w.\- ()]/g, '_').slice(0, 120);

  return {
    valid: true,
    status: 200,
    mimeType: mimeCheck.normalizedType,
    fileName: safeName,
    buffer
  };
}

/**
 * Sanitizes an outbound error string so secrets/URLs with tokens are never saved in bills.integrationSyncError.
 */
function sanitizeSyncErrorMessage(rawMessage) {
  const clean = String(rawMessage || 'Unknown sync failure')
    .replace(/(x-fes-[\w-]+\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/([A-Za-z0-9_]*secret[A-Za-z0-9_]*\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, 300);
}

/**
 * Server-to-server call from Attendance App -> Accounts App:
 * POST /api/integration/expenses/sync
 * Never blocks Attendance bill submission if Accounts is unavailable.
 */
async function syncBillExpenseToAccounts(bill, options = {}) {
  if (!bill || !bill.id) {
    return {
      ok: false,
      skipped: false,
      retryable: false,
      integrationSyncStatus: 'SYNC_FAILED',
      integrationSyncedAt: null,
      integrationSyncError: 'Valid bill record with id is required for sync.'
    };
  }

  const mode = String(bill.ticketSelectionMode || 'UNLINKED').toUpperCase().trim();
  if (mode !== 'LINKED' || !bill.externalTicketId || !bill.externalTicketSerialNo || !bill.externalJobMetadataId) {
    return {
      ok: false,
      skipped: true,
      retryable: false,
      integrationSyncStatus: 'UNLINKED_LOCAL',
      integrationSyncedAt: null,
      integrationSyncError: null,
      error: 'Bill is UNLINKED and stays local without fabricating Accounts linkage.'
    };
  }

  const cfg = getIntegrationConfig(options.config || {});
  if (!cfg.enabled || !cfg.isConfigured) {
    return {
      ok: false,
      unconfigured: true,
      retryable: true,
      integrationSyncStatus: 'PENDING_SYNC',
      integrationSyncedAt: null,
      integrationSyncError: null,
      error: 'Accounts integration is not configured on the Attendance server yet.'
    };
  }

  const payload = buildExpenseSyncPayload(bill);
  const rawBody = JSON.stringify(payload);
  const endpointUrl = `${cfg.accountsBaseUrl}/api/integration/expenses/sync`;

  // Deterministic idempotency key per bill state unless caller supplies an explicit one
  const deterministicSuffix = [
    bill.id,
    payload.approvalStatus,
    payload.totalClaimedAmount,
    payload.totalVerifiedAmount ?? 'nv',
    payload.totalApprovedAmount ?? 'na'
  ].join('_');

  const idempotencyKey = options.idempotencyKey || generateIdempotencyKey('bill', deterministicSuffix);
  const signedHeaders = createSignedHeaders({
    method: 'POST',
    path: endpointUrl,
    body: rawBody,
    idempotencyKey,
    apiKey: cfg.apiKey,
    secret: cfg.secret
  });

  const fetchImpl = options.fetchFn || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      retryable: true,
      integrationSyncStatus: 'SYNC_FAILED',
      integrationSyncedAt: null,
      integrationSyncError: 'Server HTTP client (fetch) is unavailable.'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let response;
  let responseText = '';
  try {
    response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: signedHeaders,
      body: rawBody,
      signal: controller.signal
    });
    responseText = await response.text();
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort'));
    return {
      ok: false,
      retryable: true,
      status: isTimeout ? 504 : 503,
      code: isTimeout ? 'ACCOUNTS_TIMEOUT' : 'ACCOUNTS_UNAVAILABLE',
      integrationSyncStatus: 'SYNC_FAILED',
      integrationSyncedAt: null,
      integrationSyncError: sanitizeSyncErrorMessage(
        isTimeout
          ? 'Accounts App sync request timed out.'
          : `Accounts App unreachable: ${err?.message || 'network failure'}`
      )
    };
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    return {
      ok: false,
      retryable: true,
      status: response.status || 502,
      code: 'MALFORMED_RESPONSE',
      integrationSyncStatus: 'SYNC_FAILED',
      integrationSyncedAt: null,
      integrationSyncError: 'Accounts App returned malformed JSON during expense sync.'
    };
  }

  if (!response.ok || !parsed || parsed.success !== true) {
    const code = String(parsed?.code || `HTTP_${response.status}`);
    const retryable = response.status >= 500 || response.status === 429;
    return {
      ok: false,
      retryable,
      status: response.status || 502,
      code,
      integrationSyncStatus: 'SYNC_FAILED',
      integrationSyncedAt: null,
      integrationSyncError: sanitizeSyncErrorMessage(parsed?.error || `Accounts returned HTTP ${response.status}`)
    };
  }

  return {
    ok: true,
    retryable: false,
    status: 200,
    integrationSyncStatus: 'SYNCED',
    externalExpenseId: parsed.expenseId ? Number(parsed.expenseId) : null,
    integrationSyncedAt: parsed.syncedAt || new Date().toISOString(),
    integrationSyncError: null,
    response: parsed
  };
}

module.exports = {
  MAX_TIMESTAMP_SKEW_MS,
  IDEMPOTENCY_TTL_MS,
  ALLOWED_ATTACHMENT_MIME_TYPES: Array.from(ALLOWED_ATTACHMENT_MIME_TYPES),
  BILL_STATUS_TO_ACCOUNTS_APPROVAL_STATUS,
  getIntegrationConfig,
  normalizeIntegrationPath,
  hashPayloadBody,
  buildCanonicalString,
  computeHmacSignature,
  safeCompareStrings,
  generateIdempotencyKey,
  createSignedHeaders,
  verifySignedRequest,
  storeIdempotencyResult,
  clearIdempotencyStore,
  validateAttachmentMimeType,
  extractAttachmentMetadata,
  buildAttachmentProxyUrl,
  resolveSyncedExpenseAmounts,
  buildExpenseSyncPayload,
  sanitizeForLog,
  normalizeAuthoritativeTicket,
  signAuthoritativeTicketSelection,
  verifyAuthoritativeTicketSelection,
  lookupAuthoritativeTickets,
  decodeBillAttachmentDataUrl,
  syncBillExpenseToAccounts
};
