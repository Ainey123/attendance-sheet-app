const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('--- Starting Admin Security & Password Change Tests ---');
  
  // 1. Direct unit test of isPasscodeValid logic from api/index.js
  const db = require('../db');
  const currentSettings = await db.getSettings();
  console.log('Database settings loaded:', {
    officeName: currentSettings.officeName,
    adminPasscode: currentSettings.adminPasscode,
    seniorAdminPasscode: currentSettings.seniorAdminPasscode
  });

  const apiHandler = require('../api/index');

  function makeMockReqRes(path, method, body = null, headers = {}, query = {}) {
    return new Promise((resolve) => {
      const chunks = [];
      const listeners = {};
      const req = {
        url: `/api/${path}`,
        method,
        headers: { 'content-type': 'application/json', ...headers },
        query,
        on: (event, handler) => {
          listeners[event] = handler;
        }
      };

      const res = {
        statusCode: 200,
        headers: {},
        setHeader: (k, v) => { res.headers[k] = v; },
        status: (code) => {
          res.statusCode = code;
          return res;
        },
        json: (data) => {
          resolve({ status: res.statusCode, data });
        },
        send: (data) => {
          resolve({ status: res.statusCode, data });
        },
        end: () => {
          resolve({ status: res.statusCode, data: null });
        }
      };

      // Call handler
      apiHandler(req, res);

      // Simulate body stream
      setTimeout(() => {
        if (body !== null && listeners['data']) {
          listeners['data'](typeof body === 'string' ? body : JSON.stringify(body));
        }
        if (listeners['end']) listeners['end']();
      }, 10);
    });
  }

  // TEST 1: Empty or whitespace passcode in verify
  console.log('\n[Test 1] Verify rejects empty passcode');
  let res = await makeMockReqRes('settings/verify', 'POST', { passcode: '' });
  assert.strictEqual(res.status, 401, 'Empty passcode must return 401');
  assert.strictEqual(res.data.success, false, 'success must be false');
  console.log('✓ Rejected empty passcode with 401');

  console.log('\n[Test 2] Verify rejects whitespace passcode');
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: '   ' });
  assert.strictEqual(res.status, 401, 'Whitespace passcode must return 401');
  console.log('✓ Rejected whitespace passcode with 401');

  console.log('\n[Test 3] Verify rejects invalid passcodes (0000, invalidpass)');
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: '0000' });
  assert.strictEqual(res.status, 401, '0000 must return 401');
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: 'invalidpass' });
  assert.strictEqual(res.status, 401, 'invalidpass must return 401');
  console.log('✓ Rejected invalid passcodes with 401');

  console.log('\n[Test 4] Verify accepts authentic admin passcode');
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: currentSettings.adminPasscode });
  assert.strictEqual(res.status, 200, 'Valid admin passcode must return 200');
  assert.strictEqual(res.data.success, true, 'success must be true');
  console.log('✓ Accepted authentic admin passcode with 200');

  console.log('\n[Test 5] Verify accepts senior admin passcode');
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: currentSettings.seniorAdminPasscode });
  assert.strictEqual(res.status, 200, 'Senior admin passcode must return 200');
  assert.strictEqual(res.data.success, true, 'success must be true');
  console.log('✓ Accepted senior admin passcode with 200');

  console.log('\n[Test 6] Admin attendance endpoint rejects unauthenticated visitor');
  res = await makeMockReqRes('attendance', 'GET', null, {});
  assert.strictEqual(res.status, 401, 'No passcode must return 401');
  console.log('✓ Rejected unauthenticated attendance GET with 401');

  console.log('\n[Test 7] Admin attendance endpoint rejects wrong passcode');
  res = await makeMockReqRes('attendance', 'GET', null, { 'x-admin-passcode': 'random_wrong_pass' });
  assert.strictEqual(res.status, 401, 'Wrong passcode must return 401');
  console.log('✓ Rejected wrong passcode on attendance GET with 401');

  console.log('\n[Test 8] Admin attendance endpoint accepts authentic passcode');
  res = await makeMockReqRes('attendance', 'GET', null, { 'x-admin-passcode': currentSettings.adminPasscode });
  assert.strictEqual(res.status, 200, 'Valid passcode must return 200');
  assert.ok(Array.isArray(res.data), 'Returns logs array');
  console.log('✓ Accepted authentic passcode on attendance GET with 200');

  console.log('\n[Test 9] Password Change Workflow: Update passcode and verify immediate effect');
  const tempPass = '8888';
  // Attempt update without passcode -> 401
  res = await makeMockReqRes('settings/update', 'POST', { adminPasscode: tempPass }, {});
  assert.strictEqual(res.status, 401, 'Update settings without admin auth must return 401');
  console.log('✓ Update without auth rejected with 401');

  // Update with authentic passcode
  res = await makeMockReqRes('settings/update', 'POST', { adminPasscode: tempPass }, { 'x-admin-passcode': currentSettings.adminPasscode });
  assert.strictEqual(res.status, 200, 'Update with valid auth must return 200');
  assert.strictEqual(res.data.settings.adminPasscode, tempPass, 'New passcode returned');
  console.log('✓ Password updated to ' + tempPass);

  // Now verify that the old passcode is rejected!
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: currentSettings.adminPasscode });
  assert.strictEqual(res.status, 401, 'Old passcode must now be rejected with 401');
  console.log('✓ Old passcode is now rejected with 401');

  // Verify that the new passcode works!
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: tempPass });
  assert.strictEqual(res.status, 200, 'New passcode must be accepted with 200');
  console.log('✓ New passcode 8888 is accepted with 200');

  // Revert back to original passcode
  console.log('\n[Test 10] Revert passcode back to ' + currentSettings.adminPasscode);
  res = await makeMockReqRes('settings/update', 'POST', { adminPasscode: currentSettings.adminPasscode }, { 'x-admin-passcode': tempPass });
  assert.strictEqual(res.status, 200, 'Reverting passcode must return 200');
  assert.strictEqual(res.data.settings.adminPasscode, currentSettings.adminPasscode);
  console.log('✓ Passcode restored to ' + currentSettings.adminPasscode);

  // Final verification that original passcode works again and temp is rejected
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: currentSettings.adminPasscode });
  assert.strictEqual(res.status, 200);
  res = await makeMockReqRes('settings/verify', 'POST', { passcode: tempPass });
  assert.strictEqual(res.status, 401);
  console.log('✓ Restored passcode verified and tempPass rejected');

  console.log('\n========================================');
  console.log('ALL ADMIN SECURITY & PASSCODE TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
