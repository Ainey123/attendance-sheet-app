const db = require('./db');
const integration = require('./integration-client');

/**
 * Shared HMAC-SHA256 authenticated handler for Full Bill Management
 * endpoints across Express (`server.js`) and Vercel (`api/index.js`).
 */
async function executeBillManagementAction(action, billId, body = {}) {
  const skipAccountsSync = body.skipAccountsSync === true;
  switch (action) {
    case 'verify-category': {
      const updated = await db.verifyBillCategory(billId, {
        category: body.category,
        verifiedAmount: body.verifiedAmount,
        verificationComment: body.verificationComment || body.verifiedComment || body.comment || '',
        verifiedBy: body.verifiedBy || 'Accounts Staff',
        skipAccountsSync
      });
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: { success: true, bill: detail.bill || integration.buildBillManagementIntegrationDto(updated) }
      };
    }

    case 'approve-category': {
      const updated = await db.approveBillCategory(billId, {
        category: body.category,
        approvedAmount: body.approvedAmount,
        approvalComment: body.approvalComment || body.approvedComment || body.comment || '',
        approvedBy: body.approvedBy || 'Senior Admin',
        skipAccountsSync
      });
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: { success: true, bill: detail.bill || integration.buildBillManagementIntegrationDto(updated) }
      };
    }

    case 'reject-category': {
      const reason = body.rejectionReason || body.reason || '';
      const updated = await db.rejectBillCategory(billId, {
        category: body.category,
        rejectionReason: reason,
        reason,
        rejectedBy: body.rejectedBy || 'Admin',
        stage: body.stage || 'verification',
        skipAccountsSync
      });
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: { success: true, bill: detail.bill || integration.buildBillManagementIntegrationDto(updated) }
      };
    }

    case 'reject': {
      const updated = await db.rejectBill(billId, {
        rejectionReason: body.rejectionReason || body.reason || '',
        rejectedBy: body.rejectedBy || 'Admin',
        skipAccountsSync
      });
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: { success: true, bill: detail.bill || integration.buildBillManagementIntegrationDto(updated) }
      };
    }

    case 'override-duplicate': {
      const updated = await db.overrideBillDuplicate(billId, {
        overrideBy: body.overrideBy || body.verifiedBy || 'Admin',
        note: body.note || 'Admin verified bill is legitimate and not a duplicate.'
      });
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: { success: true, bill: detail.bill || integration.buildBillManagementIntegrationDto(updated) }
      };
    }

    case 'retry-sync': {
      const res = await db.syncBillToAccounts(billId);
      if (res.skipped) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'BILL_UNLINKED',
            error: res.syncResult?.error || 'Only LINKED bills can be synced to Accounts.'
          }
        };
      }
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: {
          success: Boolean(res.ok),
          bill: detail.bill || integration.buildBillManagementIntegrationDto(res.bill),
          syncResult: res.syncResult
        }
      };
    }

    case 'link-ticket': {
      const res = await db.linkBillToAccountsTicket(
        billId,
        {
          ticketId: body.ticketId ?? body.externalTicketId,
          serialNo: body.serialNo ?? body.externalTicketSerialNo,
          jobMetadataId: body.jobMetadataId ?? body.externalJobMetadataId,
          branchName: body.branchName,
          clientName: body.clientName,
          workNature: body.workNature,
          subject: body.subject ?? body.ticketSubject,
          ticketSelectionToken: body.ticketSelectionToken,
          linkedBy: body.linkedBy || 'Admin'
        },
        { verifyWithAccounts: body.verifyWithAccounts === true }
      );
      const detail = await db.getBillForIntegrationManagementById(billId);
      return {
        status: 200,
        body: {
          success: true,
          bill: detail.bill || integration.buildBillManagementIntegrationDto(res.bill),
          syncResult: res.syncResult
        }
      };
    }

    case 'retry-failed-syncs': {
      const summary = await db.retryAllFailedBillSyncs({
        includePending: body.includePending !== false
      });
      return { status: 200, body: { success: true, ...summary } };
    }

    default:
      return { status: 400, body: { success: false, error: `Unsupported action: ${action}` } };
  }
}

async function handleBillManagementRoute({ method, path, url, query = {}, headers = {}, rawBody = '', parsedBody = null }) {
  const cleanPath = String(path || '').replace(/^\/+|\/+$/g, '');

  if (cleanPath === 'integration/bill-management' && method === 'GET') {
    const verification = integration.verifySignedRequest({
      method: 'GET',
      path: url,
      headers,
      rawBody: '',
      recordIdempotency: false
    });
    if (!verification.valid) {
      return { status: verification.status || 401, body: { success: false, code: verification.code, error: verification.error } };
    }
    const result = await db.getBillManagementDataForIntegration({
      status: query.status || 'ALL',
      employeeId: query.employeeId || null,
      search: query.search || null,
      startDate: query.startDate || null,
      endDate: query.endDate || null
    });
    return { status: 200, body: { success: true, ...result } };
  }

  const detailMatch = cleanPath.match(/^integration\/bill-management\/([^\/]+)$/);
  if (detailMatch && method === 'GET') {
    const verification = integration.verifySignedRequest({
      method: 'GET',
      path: url,
      headers,
      rawBody: '',
      recordIdempotency: false
    });
    if (!verification.valid) {
      return { status: verification.status || 401, body: { success: false, code: verification.code, error: verification.error } };
    }
    const billId = decodeURIComponent(detailMatch[1]);
    const result = await db.getBillForIntegrationManagementById(billId);
    if (!result.found) {
      return { status: result.status || 404, body: { success: false, error: result.error || 'Bill not found.' } };
    }
    return { status: 200, body: { success: true, bill: result.bill } };
  }

  if (cleanPath === 'integration/bill-management/retry-failed-syncs' && method === 'POST') {
    const verification = integration.verifySignedRequest({
      method: 'POST',
      path: url,
      headers,
      rawBody,
      recordIdempotency: true
    });
    if (!verification.valid) {
      return { status: verification.status || 401, body: { success: false, code: verification.code, error: verification.error } };
    }
    if (verification.isDuplicateReplay && verification.cachedResult) {
      return { status: 200, body: { ...verification.cachedResult, idempotentReplay: true } };
    }
    const bodyObj = parsedBody !== null ? parsedBody : (rawBody && rawBody.trim() ? JSON.parse(rawBody) : {});
    const res = await executeBillManagementAction('retry-failed-syncs', null, bodyObj);
    if (res.status === 200) integration.storeIdempotencyResult(verification.idempotencyKey, res.body);
    return res;
  }

  const actionMatch = cleanPath.match(
    /^integration\/bill-management\/([^\/]+)\/(verify-category|approve-category|reject-category|reject|override-duplicate|retry-sync|link-ticket)$/
  );
  if (actionMatch && method === 'POST') {
    const verification = integration.verifySignedRequest({
      method: 'POST',
      path: url,
      headers,
      rawBody,
      recordIdempotency: true
    });
    if (!verification.valid) {
      return { status: verification.status || 401, body: { success: false, code: verification.code, error: verification.error } };
    }
    if (verification.isDuplicateReplay && verification.cachedResult) {
      return { status: 200, body: { ...verification.cachedResult, idempotentReplay: true } };
    }

    let bodyObj = parsedBody;
    if (bodyObj === null) {
      try {
        bodyObj = rawBody && rawBody.trim() ? JSON.parse(rawBody) : {};
      } catch {
        return { status: 400, body: { success: false, code: 'INVALID_JSON', error: 'Invalid JSON body.' } };
      }
    }

    const billId = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    try {
      const res = await executeBillManagementAction(action, billId, bodyObj);
      if (res.status === 200) {
        integration.storeIdempotencyResult(verification.idempotencyKey, res.body);
      }
      return res;
    } catch (err) {
      return { status: err.status || 400, body: { success: false, error: err.message || 'Bill action failed.' } };
    }
  }

  return null;
}

module.exports = {
  executeBillManagementAction,
  handleBillManagementRoute
};
