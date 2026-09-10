// ==========================================================================
// STATE MANAGEMENT & GLOBALS
// ==========================================================================
let allEmployees = [];
let selectedEmployee = null;
let userLocation = null;
let adminPasscode = (typeof Store !== 'undefined' && Store.loadPasscode) ? Store.loadPasscode() : '';
let currentView = 'employee'; // 'employee' or 'admin'
let activeShiftTimer = null;
let currentAdminTab = 'tab-dashboard';
let selectedDocumentImageBase64 = null;
let settings = {
  organizationName: 'Company Name',
  clockInRadius: 500
};

function getAdminPasscode() {
  if (adminPasscode && typeof adminPasscode === 'string' && adminPasscode.trim()) {
    return adminPasscode.trim();
  }
  try {
    const stored = (typeof Store !== 'undefined' && Store.loadPasscode && Store.loadPasscode()) || localStorage.getItem('attendance_admin_passcode') || '';
    if (stored && stored.trim()) {
      adminPasscode = stored.trim();
      return adminPasscode;
    }
  } catch (e) {}
  return '1290';
}

async function fetchJson(url, options = {}) {
  options.headers = options.headers || {};
  if (!options.headers['X-Admin-Passcode']) {
    options.headers['X-Admin-Passcode'] = getAdminPasscode();
  }
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  // Service Worker offline fallback returns 503 with { error: 'Network error' }
  // Treat this as a non-fatal network issue rather than throwing
  if (response.status === 503 && payload && payload.error === 'Network error') {
    const err = new Error('Network error');
    err.isOffline = true;
    throw err;
  }
  if (response.ok) return payload;
  const errorMessage = payload?.error || payload?.message || `${response.status} ${response.statusText}`;
  const error = new Error(errorMessage);
  error.payload = payload;
  throw error;
}

// Base API endpoints
const API = {
  getSettings: () => fetchJson('/api/settings'),
  getEmployees: () => fetchJson('/api/employees', {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  verifyPasscode: (passcode) => fetchJson('/api/settings/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode })
  }),
  updateSettings: (data) => fetchJson('/api/settings/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  getEmployeeByToken: (token) => fetchJson(`/api/employees/token/${token}`),
  addEmployee: (name, role) => fetchJson('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ name, role })
  }),
  deleteEmployee: (id) => fetchJson(`/api/employees/${id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  resetEmployeeToken: (id) => fetchJson(`/api/employees/${id}/reset-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode }
  }),
  getComments: (employeeId = null) => {
    let url = '/api/comments';
    if (employeeId) url += `?employeeId=${encodeURIComponent(employeeId)}`;
    return fetchJson(url, { headers: { 'X-Admin-Passcode': adminPasscode } });
  },
  addComment: (data) => fetchJson('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  deleteComment: (id) => fetchJson(`/api/comments/${id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  getUnreadMessages: (employeeId) => fetchJson(`/api/comments/unread?employeeId=${encodeURIComponent(employeeId)}`),
  markMessagesRead: (employeeId) => fetchJson('/api/comments/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId })
  }),
  getStats: () => fetchJson('/api/stats'),
  getAttendanceStatus: (employeeId) => fetchJson(`/api/attendance/status/${employeeId}`),
  getMonthlySummary: (month, startDate, endDate) => {
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    return fetchJson(`/api/attendance/monthly-summary?${params.toString()}`);
  },
  getIndividualAttendance: (params = {}) => {
    const q = new URLSearchParams();
    if (params.employeeId) q.append('employeeId', params.employeeId);
    if (params.employeeName) q.append('employeeName', params.employeeName);
    if (params.startDate) q.append('startDate', params.startDate);
    if (params.endDate) q.append('endDate', params.endDate);
    if (params.month) q.append('month', params.month);
    return fetchJson(`/api/attendance/individual?${q.toString()}`);
  },
  // Salary APIs
  getFinalizedSalaryReport: (month) => fetchJson(`/api/salary/finalized-report?month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  getSalaries: (month) => fetchJson(`/api/salary?month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  setSalaryBasic: (employeeId, month, basicSalary) => fetchJson('/api/salary/set-basic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month, basicSalary })
  }),
  generateSalary: (employeeId, month) => fetchJson('/api/salary/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month })
  }),
  generateAllSalaries: (month) => fetchJson('/api/salary/generate-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ month })
  }),
  setManualPresentDays: (employeeId, month, presentDays) => fetchJson('/api/salary/set-present-days', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month, presentDays })
  }),
  resetManualPresentDays: (employeeId, month) => fetchJson('/api/salary/reset-present-days', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month })
  }),
  setManualSundayBonus: (employeeId, month, sundayBonus) => fetchJson('/api/salary/set-sunday-bonus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month, sundayBonus })
  }),
  resetManualSundayBonus: (employeeId, month) => fetchJson('/api/salary/reset-sunday-bonus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month })
  }),
  archiveSalaryEmployee: (employeeId) => fetchJson('/api/salary/archive-employee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId })
  }),
  // Accounts PDF Verification APIs
  getAccountsPdf: (month) => fetchJson(`/api/salary/accounts-pdf?month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  uploadAccountsPdf: (data) => fetchJson('/api/salary/accounts-pdf/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  reverifyAccountsPdf: (month) => fetchJson('/api/salary/accounts-pdf/reverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ month })
  }),
  mapAccountsPdfEmployee: (month, extractedName, targetEmployeeId) => fetchJson('/api/salary/accounts-pdf/map-employee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ month, extractedName, targetEmployeeId })
  }),
  deleteAccountsPdf: (month) => fetchJson(`/api/salary/accounts-pdf?month=${encodeURIComponent(month)}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  deleteAccountsPdfFile: (month, pdfId) => fetchJson(`/api/salary/accounts-pdf/file?month=${encodeURIComponent(month)}&pdfId=${encodeURIComponent(pdfId)}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  getEmployeeExpensesDetail: (employeeId, month) => fetchJson(`/api/salary/employee-expenses-detail?employeeId=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  approveSalary: (data) => fetchJson('/api/salary/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  getSalaryApprovals: (month) => fetchJson(`/api/salary/approvals?month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  revokeSalaryApproval: (employeeId, month, reason) => fetchJson('/api/salary/approve', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ employeeId, month, reason })
  }),
  getExpenseVerifications: (month) => fetchJson(`/api/salary/expense-verifications?month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  verifyExpense: (data) => fetchJson('/api/salary/expense/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  approveExpense: (data) => fetchJson('/api/salary/expense/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode, 'X-Senior-Passcode': (data && (data.passcode || data.seniorPasscode)) || '' },
    body: JSON.stringify(data)
  }),
  getEmployeeCreditHistory: (employeeId) => fetchJson(`/api/salary/employee-credit-history?employeeId=${encodeURIComponent(employeeId)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  // Emergency Salary Generator APIs
  getEmergencySalary: (month) => fetchJson(`/api/emergency-salary?month=${encodeURIComponent(month)}`, {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }),
  uploadEmergencyBankPdf: (data) => fetchJson('/api/emergency-salary/upload-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  verifyEmergencySalary: (data) => fetchJson('/api/emergency-salary/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  approveEmergencySalary: (data) => fetchJson('/api/emergency-salary/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  logEmergencyPdfRun: (data) => fetchJson('/api/emergency-salary/pdf-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }),
  resolveAttendance: (body) => fetchJson('/api/attendance/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(body)
  }),
  getAttendanceLogs: (date) => {
    let url = '/api/attendance';
    if (date) url += `?date=${date}`;
    return fetchJson(url, {
      headers: { 'X-Admin-Passcode': adminPasscode }
    });
  },
  clockIn: (employeeId, location) => {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return Promise.reject(new Error('Please turn on your location first to clock in'));
    }
    return fetchJson('/api/attendance/clock-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, location })
    });
  },
  clockOut: (employeeId, location, performanceNotes, receivedAmount, expenseAmount, image) => fetchJson('/api/attendance/clock-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, location, performanceNotes, receivedAmount, expenseAmount, image })
  }),
  verifyEmployeePin: (employeeId, pin) => fetchJson('/api/employees/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, pin })
  }),
  updateEmployeePin: (employeeId, oldPin, newPin) => fetchJson('/api/employees/update-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, oldPin, newPin })
  }),
  getWorkRecords: (employeeId, month) => {
    let url = '/api/work-records?';
    const params = [];
    if (employeeId) params.push(`employeeId=${encodeURIComponent(employeeId)}`);
    if (month) params.push(`month=${encodeURIComponent(month)}`);
    return fetch(url + params.join('&')).then(r => r.json());
  },
  getWorkProfile: (employeeId, month) =>
    fetch(`/api/work-records/profile?employeeId=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}`).then(r => r.json()),
  saveWorkProfile: (employeeId, month, fatherName) => fetch('/api/work-records/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, month, fatherName })
  }).then(r => r.json()),
  addWorkRecord: (data) => fetch('/api/work-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  deleteWorkRecord: (id, employeeId) =>
    fetch(`/api/work-records/${id}?employeeId=${encodeURIComponent(employeeId)}`, { method: 'DELETE' }).then(r => r.json()),
  getFormSubmissions: (employeeId, type) => {
    let url = '/api/forms?';
    const params = [];
    if (employeeId) params.push(`employeeId=${encodeURIComponent(employeeId)}`);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    return fetchJson(url + params.join('&'));
  },
  saveFormSubmission: (data) => fetchJson('/api/forms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  updateFormSubmission: (id, employeeId, updates) => fetchJson(`/api/forms/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, ...updates })
  }),
  deleteFormSubmission: (id, employeeId) =>
    fetchJson(`/api/forms/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId })
    })
};

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  // Set icon based on type
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
  } else {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 11.517 1.367l-.517.257a1.25 1.25 0 11-.04-1.604z" /></svg>`;
  }

  toast.innerHTML = `
    <div class="loc-icon">${iconSvg}</div>
    <div class="toast-msg">${message}</div>
  `;
  container.appendChild(toast);
  
  // Slide out after 3.5s
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================================================
// DYNAMIC LIVE CLOCK
// ==========================================================================
function initClock() {
  const timeEl = document.getElementById('live-time');
  const dateEl = document.getElementById('live-date');
  
  function updateTime() {
    const now = new Date();
    timeEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateEl.innerText = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  
  updateTime();
  setInterval(updateTime, 1000);
}

// Helper: YYYY-MM-DD local format (in Asia/Karachi PKT timezone)
function getLocalDateString(dateInput = new Date()) {
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(d);
  } catch (err) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const offset = d.getTimezoneOffset();
    const adjustedDate = new Date(d.getTime() - (offset * 60 * 1000));
    return adjustedDate.toISOString().split('T')[0];
  }
}

function getCurrentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatWorkDateDisplay(isoDate) {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length === 3) return `${parseInt(parts[2], 10)}-${parseInt(parts[1], 10)}`;
  return isoDate;
}

function formatRemarksBadge(remark) {
  if (!remark) return '<span class="text-muted">—</span>';
  const cls = {
    COMPLETE: 'remarks-complete',
    VISIT: 'remarks-visit',
    COMPLICATIONS: 'remarks-complications',
    PENDING: 'remarks-pending'
  }[(remark || '').toUpperCase()] || '';
  return cls
    ? `<span class="remarks-badge ${cls}">${remark}</span>`
    : remark;
}

// Helper: Format datetime for table display
function formatDateTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isLeaveRecord(recordOrNotes) {
  const notes = typeof recordOrNotes === 'string' ? recordOrNotes : (recordOrNotes?.performanceNotes || '');
  return String(notes).trim().toUpperCase().startsWith('LEAVE');
}

// ==========================================================================
// GEOLOCATION VERIFICATION
// ==========================================================================
function fetchLocation() {
  const locCard = document.getElementById('location-card');
  const locTitle = document.getElementById('loc-status-title');
  const locText = document.getElementById('loc-status-text');
  const locIcon = document.getElementById('loc-icon-indicator');
  const btnRetry = document.getElementById('btn-retry-location');
  const mapContainer = document.getElementById('map-container');

  // ⚠️ ALWAYS clear cached location at the start so stale data never allows clock-in
  userLocation = null;

  locCard.className = 'location-status-card';
  locIcon.className = 'loc-icon spinner';
  locTitle.innerText = 'Detecting GPS Location...';
  locText.innerText = 'Location is required to clock in. Please wait...';
  btnRetry.classList.add('hidden');
  if (mapContainer) mapContainer.classList.add('hidden');

  // Immediately disable clock-in while GPS is being fetched
  updateClockButtonsDisabledState(false);

  if (!navigator.geolocation) {
    locCard.classList.add('error');
    locIcon.className = 'loc-icon';
    locTitle.innerText = '📍 Location Required';
    locText.innerText = 'Your device or browser does not support GPS. Location is required to clock in.';
    btnRetry.classList.add('hidden');
    // userLocation stays null — clock-in remains disabled
    updateClockButtonsDisabledState(false);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };

      locCard.classList.add('success');
      locIcon.className = 'loc-icon';
      locTitle.innerText = '✅ GPS Location Secured';
      locText.innerText = `Coordinates: ${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)} (±${Math.round(userLocation.accuracy)}m)`;

      if (mapContainer) {
        mapContainer.innerHTML = `<iframe width="100%" height="100%" frameborder="0" scrolling="no" marginheight="0" marginwidth="0" src="https://www.openstreetmap.org/export/embed.html?bbox=${userLocation.longitude-0.005},${userLocation.latitude-0.005},${userLocation.longitude+0.005},${userLocation.latitude+0.005}&layer=mapnik&marker=${userLocation.latitude},${userLocation.longitude}"></iframe>`;
        mapContainer.classList.remove('hidden');
      }

      // Location confirmed — now enable clock-in
      updateClockButtonsDisabledState(false);
    },
    (error) => {
      userLocation = null; // ensure it stays null
      locCard.classList.add('error');
      locIcon.className = 'loc-icon';
      btnRetry.classList.remove('hidden');
      if (mapContainer) mapContainer.classList.add('hidden');

      let errMsg = 'Location permission denied. Please enable GPS/Location in your device settings.';
      if (error.code === error.POSITION_UNAVAILABLE) {
        errMsg = 'Location unavailable. Please enable GPS and try again.';
      } else if (error.code === error.TIMEOUT) {
        errMsg = 'Location request timed out. Please enable GPS and tap Retry.';
      }

      locTitle.innerText = '📍 Location Required';
      locText.innerText = `${errMsg} Clock In is blocked until location is enabled.`;

      // Location failed — clock-in must stay disabled
      updateClockButtonsDisabledState(false);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// Enable/disable clock buttons from employee selection, shift status, and GPS location
function updateClockButtonsDisabledState(disableAll = false) {
  const btnIn = document.getElementById('btn-clock-in');
  const btnOut = document.getElementById('btn-clock-out');
  if (!btnIn || !btnOut) return;

  if (disableAll || !selectedEmployee) {
    btnIn.disabled = true;
    btnOut.disabled = true;
    return;
  }

  // Location is required for clock-in (must have valid coordinates)
  const locationReady = !!(userLocation && typeof userLocation.latitude === 'number' && typeof userLocation.longitude === 'number');

  if (selectedEmployee.status === 'IN') {
    btnIn.disabled = true;
    btnOut.disabled = false;
    btnIn.title = 'Shift currently active';
    btnOut.title = 'Click to clock out';
  } else {
    // Both Clock In and Clock Out are ALLOWED at all times!
    // Employees are never blocked from clocking in or out.
    btnIn.disabled = false;
    btnOut.disabled = false;
    btnIn.title = !locationReady ? 'Location required to clock in' : 'Click to clock in';
    btnOut.title = 'Click to clock out / record shift details';
  }
}

// Helper status badges
function updateEmployeeStatusBadge(status, isCompletedToday = false) {
  const badge = document.getElementById('selected-employee-status');
  const activeShiftCard = document.getElementById('active-shift-card');
  if (!badge) return;
  
  if (status === 'IN') {
    badge.innerText = 'Clocked In';
    badge.className = 'status-indicator status-in';
    if (activeShiftCard) activeShiftCard.classList.remove('hidden');
  } else if (status === 'LEAVE') {
    badge.innerText = 'On Leave';
    badge.className = 'status-indicator status-out';
    if (activeShiftCard) activeShiftCard.classList.add('hidden');
    stopShiftTimer();
  } else if (isCompletedToday || (selectedEmployee && selectedEmployee.isCompletedToday)) {
    badge.innerText = 'Attendance Completed Today';
    badge.className = 'status-indicator status-out';
    if (activeShiftCard) activeShiftCard.classList.add('hidden');
    stopShiftTimer();
  } else {
    badge.innerText = 'Clocked Out';
    badge.className = 'status-indicator status-out';
    if (activeShiftCard) activeShiftCard.classList.add('hidden');
    stopShiftTimer();
  }
}

// ==========================================================================
// INDIVIDUAL SHIFT DURATION TRACKER
// ==========================================================================
function startShiftTimer(clockInIsoString) {
  if (activeShiftTimer) clearInterval(activeShiftTimer);
  
  const startTime = new Date(clockInIsoString);
  const durationVal = document.getElementById('shift-duration');
  
  function updateTicker() {
    const now = new Date();
    const diffMs = now - startTime;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    
    if (hours > 0) {
      durationVal.innerText = `${hours}h ${mins}m`;
    } else {
      durationVal.innerText = `${mins}m`;
    }
  }
  
  updateTicker();
  activeShiftTimer = setInterval(updateTicker, 20000); // Update every 20 seconds
}

function stopShiftTimer() {
  if (activeShiftTimer) {
    clearInterval(activeShiftTimer);
    activeShiftTimer = null;
  }
  document.getElementById('shift-duration').innerText = '0m';
}

// ==========================================================================
// EMPLOYEES PORTAL HANDLERS
// ==========================================================================

// Load employee list into sidebar and select matching ID if specified
async function loadEmployeesList(selectedId = null) {
  try {
    allEmployees = await API.getEmployees();
    // Persist employees to localStorage
    Store.saveEmployees(allEmployees);
    renderEmployeePortalList(allEmployees);
    
    if (selectedId) {
      const refreshed = allEmployees.find(e => e.id === selectedId);
      if (refreshed) {
        selectEmployee(refreshed);
      }
    }
  } catch (err) {
    // Fallback to cached employees from localStorage
    const cached = Store.loadEmployees();
    if (cached && cached.length > 0) {
      allEmployees = cached;
      renderEmployeePortalList(allEmployees);
      showToast('Loaded employee list from cache', 'info');
    } else {
      showToast('Failed to load employee list', 'error');
    }
  }
}

// Search filtering on staff list
function filterPortalEmployees(searchText) {
  const query = searchText.toLowerCase().trim();
  const filtered = allEmployees.filter(e => 
    e.name.toLowerCase().includes(query) || 
    (e.role && e.role.toLowerCase().includes(query))
  );
  renderEmployeePortalList(filtered);
}

// Render employee list elements
function renderEmployeePortalList(list) {
  const ul = document.getElementById('portal-employee-list');
  ul.innerHTML = '';
  
  if (list.length === 0) {
    ul.innerHTML = '<li class="list-empty">No employees found.</li>';
    return;
  }
  
  list.forEach(emp => {
    const li = document.createElement('li');
    li.dataset.id = emp.id;
    if (selectedEmployee && selectedEmployee.id === emp.id) {
      li.className = 'selected';
    }
    
    // Icon badge indicating current status
    const statusDot = emp.status === 'IN' 
      ? '<span class="status-indicator status-in" style="font-size:0.6rem; padding: 0.1rem 0.35rem;">IN</span>' 
      : '<span class="status-indicator status-out" style="font-size:0.6rem; padding: 0.1rem 0.35rem;">OUT</span>';

    li.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="emp-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(emp.name)}</div>
        <div class="emp-role">${escapeHtml(emp.role || 'Staff')}</div>
      </div>
      <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
        ${statusDot}
      </div>
    `;
    
    li.addEventListener('click', () => clickEmployeeFromList(emp));
    ul.appendChild(li);
  });
}

// Select employee profile and inspect status
async function selectEmployee(employee) {
  selectedEmployee = employee;
  
  // Highlight in sidebar
  document.querySelectorAll('#portal-employee-list li').forEach(li => {
    li.classList.remove('selected');
    if (li.dataset.id === employee.id) {
      li.classList.add('selected');
    }
  });

  // Switch Panel Card View
  document.getElementById('clock-card-placeholder').classList.add('hidden');
  const contentCard = document.getElementById('clock-card-content');
  contentCard.classList.remove('hidden');

  // Fill Employee details
  document.getElementById('selected-employee-name').innerText = employee.name;
  document.getElementById('selected-employee-role').innerText = employee.role || 'Staff';
  
  // Initials Avatar
  const initials = employee.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('employee-avatar').innerText = initials;

  // Sync active status state
  updateEmployeeStatusBadge(employee.status);
  
  // Get location
  if (!userLocation) {
    fetchLocation();
  } else {
    updateClockButtonsDisabledState(false);
  }

  // Load today's history logs
  const leaveDateInput = document.getElementById('leave-date');
  if (leaveDateInput && !leaveDateInput.value) {
    leaveDateInput.value = getLocalDateString();
  }
  await loadSelectedEmployeeLogs(employee.id);
  checkAndShowLinkExpiryNotice(employee);
  // Start polling for unread admin messages and request notification permission
  requestBrowserNotificationPermission();
  startMessageNotificationPolling(employee.id);
}

// Helper status badges
function updateEmployeeStatusBadge(status) {
  const badge = document.getElementById('selected-employee-status');
  const activeShiftCard = document.getElementById('active-shift-card');
  
  if (status === 'IN') {
    badge.innerText = 'Clocked In';
    badge.className = 'status-indicator status-in';
    activeShiftCard.classList.remove('hidden');
  } else if (status === 'LEAVE') {
    badge.innerText = 'On Leave';
    badge.className = 'status-indicator status-out';
    activeShiftCard.classList.add('hidden');
    stopShiftTimer();
  } else {
    badge.innerText = 'Clocked Out';
    badge.className = 'status-indicator status-out';
    activeShiftCard.classList.add('hidden');
    stopShiftTimer();
  }
}

// Load personal checkins list
async function loadSelectedEmployeeLogs(employeeId) {
  const timeline = document.getElementById('employee-log-today');
  timeline.innerHTML = '<div class="timeline-empty">Loading logs...</div>';
  
  try {
    const res = await API.getAttendanceStatus(employeeId);
    const record = res.activeRecord;
    const isActiveShift = record && !record.clockOutTime;
    const isLeave = record && isLeaveRecord(record);

    if (isLeave) {
      selectedEmployee.status = 'LEAVE';
      selectedEmployee.isCompletedToday = false;
      updateEmployeeStatusBadge('LEAVE');
      stopShiftTimer();
      document.getElementById('shift-start-time').innerText = '-';

      timeline.innerHTML = `
        <div class="timeline-item">
          <div class="timeline-times">
            <div class="time-box">
              <span class="time-label">Leave Applied</span>
              <span class="time-value">${record.date || '-'}</span>
            </div>
            <span class="time-arrow">➔</span>
            <div class="time-box">
              <span class="time-label">Status</span>
              <span class="time-value" style="color: var(--color-warning);">Marked as Leave</span>
            </div>
          </div>
          <div class="timeline-duration" style="background-color: rgba(245, 158, 11, 0.16); color: var(--color-warning);">
            Leave
          </div>
        </div>
      `;
    } else if (isActiveShift) {
      selectedEmployee.status = 'IN';
      selectedEmployee.isCompletedToday = false;
      updateEmployeeStatusBadge('IN');
      document.getElementById('shift-start-time').innerText = formatDateTime(record.clockInTime);
      startShiftTimer(record.clockInTime);

      timeline.innerHTML = `
        <div class="timeline-item">
          <div class="timeline-times">
            <div class="time-box">
              <span class="time-label">Clocked In</span>
              <span class="time-value">${formatDateTime(record.clockInTime)}</span>
            </div>
            <span class="time-arrow">➔</span>
            <div class="time-box">
              <span class="time-label">Clocked Out</span>
              <span class="time-value" style="color: var(--text-muted);">Active...</span>
            </div>
          </div>
          <div class="timeline-duration" style="background-color: var(--color-indigo-alpha); color: #fff;">
            Active
          </div>
        </div>
      `;
    } else if (record && record.clockOutTime) {
      selectedEmployee.status = 'OUT';
      selectedEmployee.isCompletedToday = true;
      updateEmployeeStatusBadge('OUT', true);
      stopShiftTimer();
      document.getElementById('shift-start-time').innerText = '-';

      timeline.innerHTML = `
        <div class="timeline-item">
          <div class="timeline-times">
            <div class="time-box">
              <span class="time-label">Clocked In</span>
              <span class="time-value">${formatDateTime(record.clockInTime)}</span>
            </div>
            <span class="time-arrow">➔</span>
            <div class="time-box">
              <span class="time-label">Clocked Out</span>
              <span class="time-value">${formatDateTime(record.clockOutTime)}</span>
            </div>
          </div>
          <div class="timeline-duration">
            ${record.duration}m
          </div>
        </div>
      `;
    } else {
      selectedEmployee.status = 'OUT';
      selectedEmployee.isCompletedToday = false;
      updateEmployeeStatusBadge('OUT', false);
      stopShiftTimer();
      document.getElementById('shift-start-time').innerText = '-';
      timeline.innerHTML = '<div class="timeline-empty">No check-ins logged today. Ready to clock in!</div>';
    }

    await loadEmployeeLeaveRequests();
    updateClockButtonsDisabledState(false);
  } catch (err) {
    timeline.innerHTML = '<div class="timeline-empty">Failed to load shifts.</div>';
    await loadEmployeeLeaveRequests();
    updateClockButtonsDisabledState(false);
  }
}

async function handleLeaveApplicationSubmit(e) {
  e.preventDefault();
  if (!selectedEmployee) return;

  const leaveDate = document.getElementById('leave-date').value;
  const leaveType = document.getElementById('leave-type').value;
  const leaveReason = document.getElementById('leave-reason').value.trim();
  const leaveNotes = document.getElementById('leave-notes').value.trim();

  if (!leaveDate || !leaveReason) {
    showToast('Leave date and reason are required', 'error');
    return;
  }

  try {
    const payload = {
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      formType: 'Leave',
      formData: {
        leaveDate,
        leaveType,
        reason: leaveReason,
        notes: leaveNotes
      }
    };

    const res = await API.saveFormSubmission(payload);
    if (res.success || res.submission) {
      showToast('Leave application submitted successfully', 'success');
      document.getElementById('form-leave-application').reset();
      document.getElementById('leave-date').value = getLocalDateString();
      await loadSelectedEmployeeLogs(selectedEmployee.id);
    } else {
      showToast(res.error || 'Failed to submit leave application', 'error');
    }
  } catch (err) {
    console.error('Leave submission error:', err);
    showToast(err.message || 'Network error while saving leave application', 'error');
  }
}

async function loadEmployeeLeaveRequests() {
  if (!selectedEmployee) return;

  try {
    const response = await API.getFormSubmissions(selectedEmployee.id, 'Leave');
    const submissions = Array.isArray(response) ? response : [];
    const tbody = document.querySelector('#emp-leave-table tbody');
    tbody.innerHTML = '';

    if (submissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No leave applications submitted yet.</td></tr>';
      return;
    }

    submissions.forEach((sub, idx) => {
      const tr = document.createElement('tr');
      const submittedDate = sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : '-';
      const leaveDate = sub.formData?.leaveDate || '-';
      const leaveType = sub.formData?.leaveType || 'Leave';
      const leaveReason = sub.formData?.reason || '-';
      const leaveNotes = sub.formData?.notes || '-';

      tr.innerHTML = `
        <td class="col-sn">${idx + 1}</td>
        <td>${leaveDate}</td>
        <td><span class="badge-role">${leaveType}</span></td>
        <td>${leaveReason}</td>
        <td>${leaveNotes}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    const tbody = document.querySelector('#emp-leave-table tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Failed to load leave requests.</td></tr>';
  }
}

// Clock In trigger — always gets FRESH location at click time
async function handleClockIn() {
  if (!selectedEmployee) return;

  const originalBtn = document.getElementById('btn-clock-in');
  const btnText = originalBtn.querySelector('.btn-text-large');

  // Hard block: no location = no clock-in, period
  if (!userLocation) {
    showToast('📍 Please turn on your location first to clock in', 'error');
    const locCard = document.getElementById('location-card');
    if (locCard) locCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Re-verify location is STILL active right now (not stale from earlier)
  btnText.innerText = 'VERIFYING LOCATION...';
  originalBtn.disabled = true;

  const freshLocation = await new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  if (!freshLocation) {
    // Location was turned off between page load and clicking clock-in
    userLocation = null;
    updateClockButtonsDisabledState(false);
    btnText.innerText = 'CLOCK IN';
    showToast('📍 Location is OFF. Please turn on your location to clock in', 'error');
    const locCard = document.getElementById('location-card');
    if (locCard) {
      locCard.className = 'location-status-card error';
      document.getElementById('loc-status-title').innerText = '📍 Location Required';
      document.getElementById('loc-status-text').innerText = 'Location was turned off. Please enable GPS and tap Retry.';
      document.getElementById('btn-retry-location').classList.remove('hidden');
      locCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  // ✅ Fresh location confirmed — proceed with clock-in
  userLocation = freshLocation;
  btnText.innerText = 'CLOCKING IN...';
  updateClockButtonsDisabledState(true);

  try {
    const res = await API.clockIn(selectedEmployee.id, userLocation);
    if (res.success) {
      showToast(`Clock In successful for ${selectedEmployee.name}`, 'success');
      selectedEmployee.status = 'IN';
      updateEmployeeStatusBadge('IN');
      await loadEmployeesList(selectedEmployee.id);
      updateClockButtonsDisabledState(false);
    } else {
      showToast(res.error || 'Clock in failed', 'error');
      updateClockButtonsDisabledState(false);
    }
  } catch (err) {
    showToast('Network error during clock in', 'error');
    updateClockButtonsDisabledState(false);
  } finally {
    btnText.innerText = 'CLOCK IN';
  }
}

async function openClockOutModal() {
  const modal = document.getElementById('clockout-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('performance-notes').value = '';
  document.getElementById('clockout-starting-balance').value = '';
  document.getElementById('clockout-received').value = '0';
  document.getElementById('clockout-expense').value = '0';
  document.getElementById('clockout-balance').value = '';
  resetClockOutPhoto();
  
  const notesElem = document.getElementById('performance-notes');
  if (notesElem) notesElem.focus();

  if (selectedEmployee) {
    const todayStr = getLocalDateString();
    const currentMonthStr = getCurrentMonthString();
    try {
      const records = await API.getWorkRecords(selectedEmployee.id, currentMonthStr);
      const todayRecord = records ? records.find(r => r.date === todayStr) : null;
      if (todayRecord) {
         if (todayRecord.receivedAmount) {
             document.getElementById('clockout-received').value = todayRecord.receivedAmount;
         }
         if (todayRecord.expenseAmount) {
             document.getElementById('clockout-expense').value = todayRecord.expenseAmount;
         }
      }
    } catch (err) {}
  }
  
  await updateAutoCalculatedBalance(getLocalDateString()).catch(() => {});
}

function closeClockOutModal() {
  const modal = document.getElementById('clockout-modal');
  if (modal) modal.classList.add('hidden');
  resetClockOutPhoto();
}

function handleClockOut() {
  if (!selectedEmployee) {
    showToast('Please select an employee profile first', 'error');
    return;
  }
  openClockOutModal();
}

async function submitClockOutDetails(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!selectedEmployee) return;

  let performanceNotes = (document.getElementById('performance-notes').value || '').trim();
  if (!performanceNotes) {
    performanceNotes = 'Shift Completed';
  }
  const receivedAmount = document.getElementById('clockout-received').value || 0;
  const expenseAmount = document.getElementById('clockout-expense').value || 0;

  const submitBtn = document.querySelector('#form-clockout-details button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.innerText : 'Submit Clock Out';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Submitting...';
  }

  updateClockButtonsDisabledState(true);

  try {
    const res = await API.clockOut(
      selectedEmployee.id,
      userLocation,
      performanceNotes,
      receivedAmount,
      expenseAmount,
      selectedClockOutPhotoBase64
    );
    if (res.success) {
      showToast(`Clock out successful for ${selectedEmployee.name}`, 'success');
      closeClockOutModal();
      selectedEmployee.status = 'OUT';
      selectedEmployee.isCompletedToday = true;
      updateEmployeeStatusBadge('OUT', true);
      await loadEmployeesList(selectedEmployee.id);
      updateClockButtonsDisabledState(false);
    } else {
      showToast(res.error || 'Clock out failed', 'error');
      updateClockButtonsDisabledState(false);
    }
  } catch (err) {
    showToast('Error during clock out: ' + (err.message || 'Network error'), 'error');
    updateClockButtonsDisabledState(false);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = originalBtnText;
    }
  }
}

// ==========================================================================
// ADMIN DASHBOARD & VERIFICATION SYSTEM
// ==========================================================================

// Authenticate passcode
async function handleAdminAuthSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('auth-passcode');
  const passcode = input.value;
  const errorMsg = document.getElementById('auth-error-msg');
  
  errorMsg.classList.add('hidden');
  
  try {
    const res = await API.verifyPasscode(passcode);
    if (res.success) {
        adminPasscode = passcode;
        // Persist admin passcode
        Store.savePasscode(adminPasscode);
        input.value = '';
        closeAdminAuthModal();
        
        // Unlock view
        switchView('admin');
        showToast('Admin access granted', 'success');
      } else {
        errorMsg.classList.remove('hidden');
        input.focus();
      }
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

// Navigation switcher
function switchView(viewName) {
  currentView = viewName;
  const employeeSec = document.getElementById('employee-portal-view');
  const adminSec = document.getElementById('admin-panel-view');
  const toggleBtn = document.getElementById('btn-toggle-portal');
  const btnText = toggleBtn.querySelector('.btn-text');
  
  if (viewName === 'admin') {
    employeeSec.classList.remove('active');
    adminSec.classList.add('active');
    btnText.innerText = 'Employee Portal';
    
    // Force set active sidebar tab
    switchAdminTab(currentAdminTab);
  } else {
    adminSec.classList.remove('active');
    employeeSec.classList.add('active');
    btnText.innerText = 'Admin Panel';
    
    // Clear admin passcode to log out session on view return
    adminPasscode = '';
    // Clear persisted passcode
    Store.savePasscode('');
    
    // Reload portal listings
    loadEmployeesList(selectedEmployee ? selectedEmployee.id : null);
  }
}

// Switch within Admin panels tabs
async function switchAdminTab(tabId) {
  currentAdminTab = tabId;
  
  // Highlight Sidebar Link
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    }
  });

  // Display Tab Content Pane
  document.querySelectorAll('.admin-body .tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');

  // Trigger API loads depending on selected tab
  if (tabId === 'tab-dashboard') {
    await loadAdminDashboard();
  } else if (tabId === 'tab-roster') {
    await loadAdminRoster();
  } else if (tabId === 'tab-workrecords') {
    await loadAdminWorkRecords();
  } else if (tabId === 'tab-progress') {
    await loadWorkProgress();
  } else if (tabId === 'tab-settings') {
    await loadAdminSettings();
  } else if (tabId === 'tab-forms') {
    await loadAdminForms();
  } else if (tabId === 'tab-evaluations') {
    await loadEvaluations();
  } else if (tabId === 'tab-monthly-summary') {
    await loadAndRenderMonthlySummary();
  } else if (tabId === 'tab-comments') {
    await loadAdminComments();
  } else if (tabId === 'tab-salary') {
    await loadSalarySheet();
  } else if (tabId === 'tab-emergency-salary') {
    const picker = document.getElementById('emerg-salary-month');
    const month = (picker && picker.value) || currentSalaryMonth || getCurrentMonthString();
    await loadEmergencySalaryGenerator(month);
  }
}

// TAB 1: Load Dashboard widgets & attendance list
let currentAttendanceLogs = []; // Cache logs for live filtering

async function loadAdminDashboard() {
  const statsEl = {
    total: document.getElementById('stat-total-staff'),
    currentIn: document.getElementById('stat-currently-in'),
    present: document.getElementById('stat-present-today'),
    absent: document.getElementById('stat-absent-today')
  };

  try {
    // 1. Fetch Stats
    const stats = await API.getStats();
    statsEl.total.innerText = stats.totalEmployees;
    statsEl.currentIn.innerText = stats.activePresent;
    statsEl.present.innerText = stats.presentToday;
    statsEl.absent.innerText = stats.absentToday;
    
    // Update main company title if it differs
    if (stats.officeName) {
      document.getElementById('office-title').innerText = stats.officeName;
    }

    // 2. Fetch logs matching current date filter
    let dateFilter = document.getElementById('admin-date-filter').value;
    if (!dateFilter) {
      dateFilter = getLocalDateString();
      document.getElementById('admin-date-filter').value = dateFilter;
    }

    currentAttendanceLogs = await API.getAttendanceLogs(dateFilter);
    renderAttendanceLogsTable(currentAttendanceLogs);

  } catch (err) {
    showToast('Failed to update dashboard data', 'error');
  }
}

// Build table items for dashboard logs
function renderAttendanceLogsTable(logs) {
  const tbody = document.querySelector('#admin-logs-table tbody');
  tbody.innerHTML = '';
  
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No attendance records found for this date.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    
    // Location maps links
    const renderLocationLink = (loc) => {
      if (!loc) return '<span class="text-muted" style="font-size: 0.8rem">No GPS</span>';
      return `
        <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}" target="_blank" class="map-link">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          Map
        </a>
      `;
    };

    // Photo link rendering
    const renderPhotoLink = (img) => {
      if (!img) return '<span class="text-muted" style="font-size: 0.8rem">No Photo</span>';
      return `
        <button type="button" class="btn-view-photo" data-img="${img}" style="background:none;border:none;color:var(--color-primary);cursor:pointer;padding:0;font-size:0.9rem;text-decoration:underline;display:flex;align-items:center;gap:0.25rem;margin:0 auto;">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          View
        </button>
      `;
    };

    // Duration formatting
    let durationText = '-';
    if (log.duration !== null) {
      const hrs = Math.floor(log.duration / 60);
      const mins = log.duration % 60;
      durationText = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    }

    const isLeave = isLeaveRecord(log);
    const statusCell = isLeave ? '<span class="badge-role" style="background: rgba(245, 158, 11, 0.16); color: var(--color-warning);">Leave</span>' : (log.clockOutTime ? 'Completed' : 'Active');
    const leaveLabel = isLeave ? 'Leave' : (log.clockOutTime ? formatDateTime(log.clockOutTime) : 'Active');

    tr.innerHTML = `
      <td><strong>${log.employeeName}</strong></td>
      <td><span class="badge-role">${log.role || 'Staff'}</span></td>
      <td>${log.date}</td>
      <td style="color: ${isLeave ? 'var(--color-warning)' : 'var(--color-success)'}">${isLeave ? '—' : formatDateTime(log.clockInTime)}</td>
      <td style="color: ${isLeave ? 'var(--color-warning)' : (log.clockOutTime ? 'var(--color-danger)' : 'var(--text-muted)')}">
        ${leaveLabel}
      </td>
      <td><strong>${isLeave ? '0m' : durationText}</strong></td>
      <td>${isLeave ? '<span class="text-muted" style="font-size: 0.8rem">—</span>' : renderLocationLink(log.clockInLocation)}</td>
      <td>${isLeave ? '<span class="text-muted" style="font-size: 0.8rem">—</span>' : renderLocationLink(log.clockOutLocation)}</td>
      <td>${isLeave ? '<span class="text-muted" style="font-size: 0.8rem">Leave record</span>' : renderPhotoLink(log.image)}</td>
    `;
    
    // Bind photo click listeners
    tr.querySelectorAll('.btn-view-photo').forEach(btn => {
      btn.addEventListener('click', () => {
        openPhotoModal(btn.getAttribute('data-img'));
      });
    });
    
    tbody.appendChild(tr);
  });
}

// Filter logs list on search key
function filterAdminLogs(searchText) {
  const query = searchText.toLowerCase().trim();
  if (query === '') {
    renderAttendanceLogsTable(currentAttendanceLogs);
    return;
  }
  
  const filtered = currentAttendanceLogs.filter(log => 
    log.employeeName.toLowerCase().includes(query) || 
    (log.role && log.role.toLowerCase().includes(query))
  );
  renderAttendanceLogsTable(filtered);
}

// TAB 2: Roster profile listings
async function loadAdminRoster() {
  try {
    const [employees, todayLogs] = await Promise.all([
      API.getEmployees(),
      API.getAttendanceLogs(getLocalDateString()).catch(() => [])
    ]);
    Store.saveEmployees(employees);
    const tbody = document.querySelector('#admin-roster-table tbody');
    tbody.innerHTML = '';

    if (employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Roster is empty. Register a staff member.</td></tr>';
      return;
    }

    const isLeave = (r) => Boolean(r && String(r.performanceNotes || '').trim().toUpperCase().startsWith('LEAVE'));
    const todayMap = new Map();
    (todayLogs || []).forEach(log => {
      if (!isLeave(log)) {
        todayMap.set(log.employeeId, log);
      }
    });

    employees.forEach(emp => {
      const tr = document.createElement('tr');
      const formattedDate = new Date(emp.dateCreated).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      
      const todayAtt = todayMap.get(emp.id);
      let statusBadge = '<span class="status-indicator status-out" style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">Not Checked In</span>';
      
      if (todayAtt) {
        if (todayAtt.clockInTime && !todayAtt.clockOutTime) {
          statusBadge = '<span class="status-indicator status-in" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🟢 Clocked In</span>';
        } else if (todayAtt.clockOutTime) {
          statusBadge = '<span class="status-indicator status-out" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);">🔵 Clocked Out</span>';
        }
      }

      tr.innerHTML = `
        <td><strong>${escapeHtml(emp.name)}</strong></td>
        <td><span class="badge-role">${escapeHtml(emp.role || 'Staff')}</span></td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.25rem;">
            <input type="text" class="roster-pin-input" data-id="${emp.id}" value="${emp.pin || '1234'}" maxlength="4" style="width: 50px; text-align: center; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); color: var(--color-warning); font-family: monospace; border-radius: 4px; padding: 0.15rem 0.25rem; font-size: 0.8rem; outline: none;">
            <button class="btn-update-pin" data-id="${emp.id}" style="background: none; border: none; color: var(--color-indigo); cursor: pointer; font-size: 0.75rem; font-weight: 600; text-decoration: underline;">Save</button>
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>${formattedDate}</td>
        <td>
          <button class="btn btn-share-link" data-id="${emp.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background-color: var(--color-indigo); border-color: rgba(99, 102, 241, 0.4); margin-right: 0.25rem;">
            Copy Link
          </button>
          <button class="btn btn-resend-link" data-id="${emp.id}" title="Generate a brand-new link for this employee (keeps all attendance history)" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #10b981; margin-right: 0.25rem; border-radius: 6px; cursor: pointer; font-weight: 600;">
            🔄 New Link
          </button>
          <button class="btn btn-danger btn-delete-emp" data-id="${emp.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
            Delete
          </button>
        </td>
      `;
      
      // Copy Link listener
 tr.querySelector('.btn-share-link').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        let token = emp.token;
        if (!token) {
          // Generate token via API if missing
          const res = await fetch(`/api/employees/${id}/generate-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode }
          }).then(r => r.json());
          if (res.success) {
            token = res.link.split('token=')[1];
            emp.token = token; // update local object
          } else {
            showToast('Failed to generate token', 'error');
            return;
          }
        }
        const shareUrl = `${window.location.origin}/?mode=employee\&token=${token}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast(`Direct login link copied for ${emp.name}!`, 'success');
        }).catch(err => {
          showToast('Failed to copy link automatically.', 'error');
        });
      });

      // 🔄 New Link listener — generates a NEW token WITHOUT deleting the employee
      tr.querySelector('.btn-resend-link').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (!confirm(`Generate a NEW login link for ${emp.name}?\n\n✅ Their old link will be replaced with a brand-new one.\n✅ ALL their attendance history will be KEPT.\n\nThe new link will be copied to your clipboard so you can send it to them.`)) return;
        try {
          const res = await API.resetEmployeeToken(id);
          if (res && res.success) {
            emp.token = res.token;
            const newUrl = `${window.location.origin}/?mode=employee&token=${res.token}`;
            navigator.clipboard.writeText(newUrl).then(() => {
              showToast(`✅ New link generated & copied for ${emp.name}! Send it to them.`, 'success');
            }).catch(() => {
              prompt(`New link for ${emp.name} (copy this):`, newUrl);
            });
          } else {
            showToast((res && res.error) || 'Failed to generate new link', 'error');
          }
        } catch (err) {
          showToast(err.message || 'Connection error generating new link', 'error');
        }
      });

      // Delete listener
      tr.querySelector('.btn-delete-emp').addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id') || emp.id;
        handleDeleteEmployee(id, emp.name);
      });

      // Update PIN listener
      tr.querySelector('.btn-update-pin').addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        const input = tr.querySelector(`.roster-pin-input[data-id="${id}"]`);
        const newPin = input.value.trim();
        if (!/^\d{4}$/.test(newPin)) {
          showToast('PIN must be exactly 4 digits.', 'error');
          return;
        }
        try {
          const res = await fetch(`/api/employees/${id}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
            body: JSON.stringify({ pin: newPin })
          }).then(r => r.json());
          
          if (res.success) {
            showToast(`PIN updated for ${emp.name}`, 'success');
            loadAdminRoster();
          } else {
            showToast(res.error || 'Failed to update PIN', 'error');
          }
        } catch (err) {
          showToast('Connection error updating PIN', 'error');
        }
      });

      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast('Failed to load roster', 'error');
  }
}

// Confirmation dialog modal for deleting employee
function confirmDeleteEmployeeModal(name) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-delete-employee');
    const cancelBtn = document.getElementById('btn-cancel-delete-employee');
    const confirmBtn = document.getElementById('btn-confirm-delete-employee');
    const textEl = document.getElementById('delete-employee-modal-text');

    if (!modal || !cancelBtn || !confirmBtn) {
      const ok = window.confirm("Are you sure you want to delete this employee?\nThis action cannot be undone.");
      return resolve(ok);
    }

    if (textEl) {
      textEl.textContent = "Are you sure you want to delete this employee?\nThis action cannot be undone.";
    }

    modal.classList.remove('hidden');

    const cleanup = (result) => {
      modal.classList.add('hidden');
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      resolve(result);
    };

    cancelBtn.onclick = () => cleanup(false);
    confirmBtn.onclick = () => cleanup(true);
  });
}

// Delete staff record (SOFT DELETE — all past data is preserved and visible in admin reports)
async function handleDeleteEmployee(id, name) {
  if (!id) {
    showToast('Employee ID is required', 'error');
    return;
  }

  const confirmed = await confirmDeleteEmployeeModal(name);
  if (!confirmed) return;

  try {
    const res = await API.deleteEmployee(id);
    if (res && res.success) {
      showToast(`✅ ${name || 'Employee'} deleted successfully. All past data is preserved.`, 'success');
      
      // 1. Refresh admin roster table
      await loadAdminRoster();
      
      // 2. Refresh portal employee list
      await loadEmployeesList();

      // 3. Clear selected employee if this was the one open
      if (selectedEmployee && selectedEmployee.id === id) {
        selectedEmployee = null;
        localStorage.removeItem('loggedInEmployeeId');
        const cardContent = document.getElementById('clock-card-content');
        const cardPlaceholder = document.getElementById('clock-card-placeholder');
        if (cardContent) cardContent.classList.add('hidden');
        if (cardPlaceholder) cardPlaceholder.classList.remove('hidden');
      }

      // 4. If individual attendance select exists, remove employee option
      const indivSelect = document.getElementById('indiv-employee-select');
      if (indivSelect) {
        const opt = indivSelect.querySelector(`option[value="${id}"]`);
        if (opt) opt.remove();
      }

      // 5. If salary sheet is loaded, refresh it
      if (currentSalaryMonth) {
        loadSalarySheet(currentSalaryMonth).catch(() => {});
      }
    } else {
      const msg = (res && res.error) ? res.error : 'Failed to delete employee';
      showToast(`Error: ${msg}`, 'error');
    }
  } catch (err) {
    const msg = err.message || 'Connection error — please check your internet and try again';
    showToast(`Delete failed: ${msg}`, 'error');
    console.error('Delete employee error:', err);
  }
}

// Register new staff member
async function handleAddEmployeeSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('new-emp-name');
  const roleInput = document.getElementById('new-emp-role');
  
  const name = nameInput.value;
  const role = roleInput.value;

  try {
    const res = await API.addEmployee(name, role);
    if (res && (res.employee || res.id || res.name)) {
      const emp = res.employee || res;
      showToast(`Registered employee: ${emp.name}`, 'success');
      nameInput.value = '';
      roleInput.value = '';
      
      // Reload roster tab
      loadAdminRoster();
    } else {
      showToast(res.error || 'Registration failed', 'error');
    }
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

// TAB 3: Load Office configurations
async function loadAdminSettings() {
  try {
    const res = await API.getSettings();
    document.getElementById('settings-office-name').value = res.officeName || 'My Office';
    document.getElementById('settings-passcode').value = ''; // Leave password empty for inputting a new one
  } catch (err) {
    showToast('Failed to retrieve settings', 'error');
  }
}

// Submit office settings
async function handleSettingsSubmit(e) {
  e.preventDefault();
  const officeName = document.getElementById('settings-office-name').value;
  const newPasscode = document.getElementById('settings-passcode').value;

  const updateBody = { officeName };
  if (newPasscode.trim() !== '') {
    updateBody.adminPasscode = newPasscode;
  }

  try {
    const res = await API.updateSettings(updateBody);
    if (res.success) {
      showToast('Settings saved successfully', 'success');
      
      // Update global titles
      document.getElementById('office-title').innerText = res.settings.officeName;
      
      if (newPasscode.trim() !== '') {
        // If passcode changed, save the new value into session cache
        adminPasscode = newPasscode;
        document.getElementById('settings-passcode').value = '';
      }
    } else {
      showToast(res.error || 'Failed to update settings', 'error');
    }
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

// Export dashboard logs to CSV
function exportLogsToCSV() {
  if (currentAttendanceLogs.length === 0) {
    showToast('No logs to export', 'warning');
    return;
  }

  const dateFilter = document.getElementById('admin-date-filter').value;
  const headers = ['Employee Name', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration (Minutes)', 'Clock In Lat', 'Clock In Lng', 'Clock Out Lat', 'Clock Out Lng', 'Performance Notes', 'Money Spent (PKR)', 'Photo Attached'];
  
  const csvRows = [headers.join(',')];

  currentAttendanceLogs.forEach(log => {
    const inLat = log.clockInLocation ? log.clockInLocation.latitude : '';
    const inLng = log.clockInLocation ? log.clockInLocation.longitude : '';
    const outLat = log.clockOutLocation ? log.clockOutLocation.latitude : '';
    const outLng = log.clockOutLocation ? log.clockOutLocation.longitude : '';
    const duration = log.duration !== null ? log.duration : '';

    const row = [
      `"${log.employeeName.replace(/"/g, '""')}"`,
      `"${(log.role || 'Staff').replace(/"/g, '""')}"`,
      log.date,
      log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString() : '',
      log.clockOutTime ? new Date(log.clockOutTime).toLocaleTimeString() : '',
      duration,
      inLat,
      inLng,
      outLat,
      outLng,
      `"${(log.performanceNotes || '').replace(/"/g, '""')}"`,
      log.moneySpent || 0,
      log.image ? 'Yes' : 'No'
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
  const link = document.createElement("a");
  link.setAttribute("href", csvContent);
  link.setAttribute("download", `Attendance_Report_${dateFilter}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('Attendance report exported!', 'success');
}

// Export Attendance Logs to PDF (includes attached photos)
async function exportAttendanceLogsToPDF() {
  try {
    const dateFilter = document.getElementById('admin-date-filter').value;
    if (!dateFilter) {
      showToast('Please select a date first', 'warning');
      return;
    }
    const logs = await API.getAttendanceLogs(dateFilter);
    if (!logs || logs.length === 0) {
      showToast('No attendance records found for the selected date', 'warning');
      return;
    }

    showToast('Generating PDF report...', 'info');
    const now = new Date();
    const exportTimestamp = now.toLocaleString();
    const dateObj = new Date(dateFilter + 'T00:00:00');
    const dateDisplay = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const printContainer = document.createElement('div');
    printContainer.className = 'pdf-report-wrapper';
    printContainer.style.cssText = 'font-family: Arial, sans-serif; color: #1a1a2e; padding: 24px;';

    let htmlContent = `
      <div style="text-align:center; border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 16px;">
        <h1 style="margin:0; font-size:22px; color:#6366f1;">DAILY ATTENDANCE REPORT</h1>
        <div style="font-size:14px; color:#555; margin-top:4px;">${dateDisplay}</div>
        <div style="font-size:11px; color:#888;">Generated: ${exportTimestamp}</div>
        <div style="font-size:11px; color:#888;">Total Records: ${logs.length}</div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="background:#6366f1; color:#fff;">
            <th style="padding:7px 8px; text-align:left; border:1px solid #d1d5db;">Employee</th>
            <th style="padding:7px 8px; text-align:left; border:1px solid #d1d5db;">Role</th>
            <th style="padding:7px 8px; text-align:center; border:1px solid #d1d5db;">Clock In</th>
            <th style="padding:7px 8px; text-align:center; border:1px solid #d1d5db;">Clock Out</th>
            <th style="padding:7px 8px; text-align:center; border:1px solid #d1d5db;">Duration</th>
            <th style="padding:7px 8px; text-align:left; border:1px solid #d1d5db;">Performance Notes</th>
            <th style="padding:7px 8px; text-align:right; border:1px solid #d1d5db;">Spent</th>
            <th style="padding:7px 8px; text-align:center; border:1px solid #d1d5db;">Photo</th>
          </tr>
        </thead>
        <tbody>
    `;

    logs.forEach((log, i) => {
      const durationText = log.duration !== null
        ? (Math.floor(log.duration / 60) > 0 ? `${Math.floor(log.duration / 60)}h ${log.duration % 60}m` : `${log.duration % 60}m`)
        : 'Active';
      const notes = log.performanceNotes || '\u2014';
      const spent = log.moneySpent ? `PKR ${log.moneySpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'PKR 0.00';
      const bg = i % 2 === 0 ? '#f9fafb' : '#fff';

      let photoCell = '<span style="color:#9ca3af; font-size:10px;">None</span>';
      if (log.image) {
        photoCell = `<img src="${log.image}" style="max-width:180px; max-height:140px; border-radius:4px; border:1px solid #d1d5db; object-fit:contain;" />`;
      }

      htmlContent += `
        <tr style="background:${bg};">
          <td style="padding:6px 8px; border:1px solid #d1d5db; font-weight:600;">${log.employeeName}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; color:#555;">${log.role || 'Staff'}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; text-align:center; color:#059669;">${log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '\u2014'}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; text-align:center; color:#dc2626;">${log.clockOutTime ? new Date(log.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '<em>Active</em>'}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; text-align:center;">${durationText}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; color:#374151; max-width:150px;">${notes}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; text-align:right; font-weight:500;">${spent}</td>
          <td style="padding:6px 8px; border:1px solid #d1d5db; text-align:center; vertical-align:middle;">${photoCell}</td>
        </tr>
      `;
    });

    htmlContent += '</tbody></table>';

    const totalSpent = logs.reduce((s, l) => s + (l.moneySpent || 0), 0);
    htmlContent += `
      <div style="margin-top:14px; padding:10px; background:#f3f4f6; border-radius:6px; font-size:12px; display:flex; justify-content:space-between;">
        <span><strong>Total Spent:</strong> PKR ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span><strong>Total Records:</strong> ${logs.length}</span>
      </div>
    `;

    printContainer.innerHTML = htmlContent;
    document.body.appendChild(printContainer);

    if (window.html2pdf) {
      const opt = {
        margin: [10, 10, 15, 10],
        filename: `Daily_Attendance_${dateFilter}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };
      await html2pdf().set(opt).from(printContainer).save();
      document.body.removeChild(printContainer);
      showToast('PDF downloaded successfully!', 'success');
    } else {
      showToast('html2pdf library offline. Opening browser print dialog...', 'info');
      window.print();
      document.body.removeChild(printContainer);
    }
  } catch (err) {
    console.error('Error generating attendance PDF:', err);
    showToast('Failed to generate PDF', 'error');
  }
}

// Export Monthly Attendance Logs to PDF (includes attached photos)
async function exportMonthlyAttendanceToPDF() {
  try {
    const dateFilter = document.getElementById('admin-date-filter').value;
    if (!dateFilter) {
      showToast('Please select a date first to determine the month', 'warning');
      return;
    }
    const selectedMonth = dateFilter.substring(0, 7); // "YYYY-MM"

    showToast('Generating monthly PDF report...', 'info');
    const logs = await API.getAttendanceLogs(null);
    const monthlyLogs = logs.filter(log => log.date && log.date.startsWith(selectedMonth));

    if (monthlyLogs.length === 0) {
      showToast(`No logs found for the month of ${selectedMonth}`, 'warning');
      return;
    }

    const dateObj = new Date(selectedMonth + '-02');
    const monthDisplay = dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const exportTimestamp = new Date().toLocaleString();

    const printContainer = document.createElement('div');
    printContainer.className = 'pdf-report-wrapper';
    printContainer.style.cssText = 'font-family: Arial, sans-serif; color: #1a1a2e; padding: 24px;';

    let htmlContent = `
      <div style="text-align:center; border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 16px;">
        <h1 style="margin:0; font-size:22px; color:#6366f1;">MONTHLY ATTENDANCE REPORT</h1>
        <div style="font-size:14px; color:#555; margin-top:4px;">${monthDisplay}</div>
        <div style="font-size:11px; color:#888;">Generated: ${exportTimestamp}</div>
        <div style="font-size:11px; color:#888;">Total Records: ${monthlyLogs.length}</div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:10px;">
        <thead>
          <tr style="background:#6366f1; color:#fff;">
            <th style="padding:6px 7px; text-align:left; border:1px solid #d1d5db;">Employee</th>
            <th style="padding:6px 7px; text-align:left; border:1px solid #d1d5db;">Role</th>
            <th style="padding:6px 7px; text-align:center; border:1px solid #d1d5db;">Date</th>
            <th style="padding:6px 7px; text-align:center; border:1px solid #d1d5db;">Clock In</th>
            <th style="padding:6px 7px; text-align:center; border:1px solid #d1d5db;">Clock Out</th>
            <th style="padding:6px 7px; text-align:center; border:1px solid #d1d5db;">Duration</th>
            <th style="padding:6px 7px; text-align:left; border:1px solid #d1d5db;">Notes</th>
            <th style="padding:6px 7px; text-align:right; border:1px solid #d1d5db;">Spent</th>
            <th style="padding:6px 7px; text-align:center; border:1px solid #d1d5db;">Photo</th>
          </tr>
        </thead>
        <tbody>
    `;

    monthlyLogs.forEach((log, i) => {
      const durationText = log.duration !== null
        ? (Math.floor(log.duration / 60) > 0 ? `${Math.floor(log.duration / 60)}h ${log.duration % 60}m` : `${log.duration % 60}m`)
        : 'Active';
      const notes = log.performanceNotes || '\u2014';
      const spent = log.moneySpent ? `PKR ${log.moneySpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'PKR 0.00';
      const bg = i % 2 === 0 ? '#f9fafb' : '#fff';

      let photoCell = '<span style="color:#9ca3af; font-size:9px;">None</span>';
      if (log.image) {
        photoCell = `<img src="${log.image}" style="max-width:180px; max-height:140px; border-radius:4px; border:1px solid #d1d5db; object-fit:contain;" />`;
      }

      htmlContent += `
        <tr style="background:${bg};">
          <td style="padding:5px 7px; border:1px solid #d1d5db; font-weight:600;">${log.employeeName}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; color:#555;">${log.role || 'Staff'}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; text-align:center;">${log.date}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; text-align:center; color:#059669;">${log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '\u2014'}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; text-align:center; color:#dc2626;">${log.clockOutTime ? new Date(log.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '<em>Active</em>'}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; text-align:center;">${durationText}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; color:#374151; max-width:130px; word-wrap:break-word;">${notes}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; text-align:right; font-weight:500;">${spent}</td>
          <td style="padding:5px 7px; border:1px solid #d1d5db; text-align:center; vertical-align:middle;">${photoCell}</td>
        </tr>
      `;
    });

    htmlContent += '</tbody></table>';

    const totalSpent = monthlyLogs.reduce((s, l) => s + (l.moneySpent || 0), 0);
    htmlContent += `
      <div style="margin-top:14px; padding:10px; background:#f3f4f6; border-radius:6px; font-size:12px; display:flex; justify-content:space-between;">
        <span><strong>Total Spent:</strong> PKR ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span><strong>Total Records:</strong> ${monthlyLogs.length}</span>
      </div>
    `;

    printContainer.innerHTML = htmlContent;
    document.body.appendChild(printContainer);

    if (window.html2pdf) {
      const opt = {
        margin: [10, 10, 15, 10],
        filename: `Monthly_Attendance_${selectedMonth}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };
      await html2pdf().set(opt).from(printContainer).save();
      document.body.removeChild(printContainer);
      showToast('Monthly PDF downloaded successfully!', 'success');
    } else {
      showToast('html2pdf library offline. Opening browser print dialog...', 'info');
      window.print();
      document.body.removeChild(printContainer);
    }
  } catch (err) {
    console.error('Error generating monthly PDF:', err);
    showToast('Failed to generate monthly PDF', 'error');
  }
}

// Export Monthly Attendance Report to CSV
async function exportMonthlyAttendanceToCSV() {
  const dateFilter = document.getElementById('admin-date-filter').value;
  if (!dateFilter) {
    showToast('Please select a date first to determine the month', 'warning');
    return;
  }
  const selectedMonth = dateFilter.substring(0, 7); // "YYYY-MM"
  
  try {
    showToast('Generating monthly attendance report...', 'info');
    // Fetch ALL logs (passing no date fetches all)
    const logs = await API.getAttendanceLogs(null);
    
    // Filter for selected month
    const monthlyLogs = logs.filter(log => log.date && log.date.startsWith(selectedMonth));
    
    if (monthlyLogs.length === 0) {
      showToast(`No logs found for the month of ${selectedMonth}`, 'warning');
      return;
    }

  const headers = ['Employee Name', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration (Minutes)', 'Clock In Lat', 'Clock In Lng', 'Clock Out Lat', 'Clock Out Lng', 'Performance Notes', 'Money Spent (PKR)', 'Photo Attached'];
  const csvRows = [headers.join(',')];

    monthlyLogs.forEach(log => {
      const inLat = log.clockInLocation ? log.clockInLocation.latitude : '';
      const inLng = log.clockInLocation ? log.clockInLocation.longitude : '';
      const outLat = log.clockOutLocation ? log.clockOutLocation.latitude : '';
      const outLng = log.clockOutLocation ? log.clockOutLocation.longitude : '';
      const duration = log.duration !== null ? log.duration : '';

      const row = [
        `"${log.employeeName.replace(/"/g, '""')}"`,
        `"${(log.role || 'Staff').replace(/"/g, '""')}"`,
        log.date,
        log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString() : '',
        log.clockOutTime ? new Date(log.clockOutTime).toLocaleTimeString() : '',
        duration,
        inLat,
        inLng,
        outLat,
        outLng,
        `"${(log.performanceNotes || '').replace(/"/g, '""')}"`,
        log.moneySpent || 0,
        log.image ? 'Yes' : 'No'
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `Monthly_Attendance_Report_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast(`Monthly report for ${selectedMonth} exported!`, 'success');
  } catch (err) {
    showToast('Failed to export monthly attendance', 'error');
    console.error(err);
  }
}

// ==========================================================================
// MONTHLY WORK & PAYMENT RECORDS
// ==========================================================================
let currentEmployeeWorkRecords = [];
let currentAdminWorkRecords = [];

function switchEmployeeTab(tabId) {
  document.querySelectorAll('.emp-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-emp-tab') === tabId);
  });
  document.querySelectorAll('.emp-tab-pane').forEach(pane => {
    const isActive = pane.id === tabId;
    pane.classList.toggle('active', isActive);
    if (isActive) pane.classList.remove('hidden');
    else pane.classList.add('hidden');
  });
  const grid = document.getElementById('portal-grid');
  if (tabId === 'emp-pane-workrecord') {
    grid.classList.add('work-record-active');
    loadEmployeeWorkRecords();
  } else if (tabId === 'emp-pane-forms') {
    grid.classList.add('work-record-active');
    loadEmployeeForms();
  } else if (tabId === 'emp-pane-attendance') {
    grid.classList.remove('work-record-active');
    if (selectedEmployee) {
      loadSelectedEmployeeLogs(selectedEmployee.id);
    }
  } else if (tabId === 'emp-pane-comments') {
    grid.classList.remove('work-record-active');
    if (selectedEmployee) {
      loadEmployeeComments();
      markMessagesAsRead();
    }
  } else {
    grid.classList.remove('work-record-active');
  }
}

function renderWorkRecordRows(records, tbodySelector, allowDelete) {
  const tbody = document.querySelector(`${tbodySelector} tbody`);
  tbody.innerHTML = '';

  if (!records.length) {
    const cols = allowDelete ? 11 : 10;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="table-empty">No entries for this month yet.</td></tr>`;
    return;
  }

  records.forEach((rec, idx) => {
    const tr = document.createElement('tr');
    
    const amountAdded = rec.receivedAmount !== undefined ? rec.receivedAmount : (rec.paymentIssuance || 0);
    const startingBalance = rec.carriedOverBalance || 0;
    const totalBalance = startingBalance + amountAdded;
    const expenses = rec.expenseAmount || 0;
    const remainingBalance = rec.remainingBalance !== undefined ? rec.remainingBalance : (totalBalance - expenses);

    const fmtStarting = startingBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const fmtAdded = amountAdded.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const fmtExpenses = expenses.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const fmtRemaining = remainingBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

    tr.innerHTML = `
      <td class="col-sn">${idx + 1}</td>
      <td>${formatWorkDateDisplay(rec.date)}</td>
      <td class="col-work">${rec.performedWork || '—'}</td>
      <td class="starting-balance-cell">${fmtStarting}</td>
      <td class="amount-added-cell">${fmtAdded}</td>
      <td class="expense-cell">${fmtExpenses}</td>
      <td class="balance-cell">${fmtRemaining}</td>
      <td>${rec.materialIssuance || '—'}</td>
      <td>${rec.materialBalance || '—'}</td>
      <td>${formatRemarksBadge(rec.otherRemarks)}</td>
      ${allowDelete ? '<td></td>' : ''}
    `;
    if (allowDelete) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-delete-work';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => handleDeleteWorkRecord(rec.id));
      tr.lastElementChild.appendChild(delBtn);
    }
    tbody.appendChild(tr);
  });
}

async function loadEmployeeWorkRecords() {
  if (!selectedEmployee) return;

  const monthInput = document.getElementById('emp-work-month');
  if (!monthInput.value) monthInput.value = getCurrentMonthString();

  const month = monthInput.value;
  document.getElementById('emp-work-name').value = selectedEmployee.name;

  try {
    const profile = await API.getWorkProfile(selectedEmployee.id, month);
    document.getElementById('emp-work-father').value = profile.fatherName || '';

    currentEmployeeWorkRecords = await API.getWorkRecords(selectedEmployee.id, month);
    if (!Array.isArray(currentEmployeeWorkRecords)) currentEmployeeWorkRecords = [];
    renderWorkRecordRows(currentEmployeeWorkRecords, '#emp-work-table', true);

    const dateInput = document.getElementById('work-entry-date');
    if (!dateInput.value) dateInput.value = getLocalDateString();
    
    // Auto calculate balance fields in both clock-out and work entry forms
    await updateAutoCalculatedBalance(getLocalDateString());
    await updateWorkEntryBalance();
  } catch (err) {
    showToast('Failed to load work records', 'error');
  }
}

async function handleSaveWorkProfile() {
  if (!selectedEmployee) return;
  const month = document.getElementById('emp-work-month').value;
  const fatherName = document.getElementById('emp-work-father').value;
  if (!month) {
    showToast('Please select a month', 'error');
    return;
  }
  try {
    const res = await API.saveWorkProfile(selectedEmployee.id, month, fatherName);
    if (res.success) showToast('Header saved', 'success');
    else showToast(res.error || 'Failed to save', 'error');
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleAddWorkEntry(e) {
  e.preventDefault();
  if (!selectedEmployee) return;

  const month = document.getElementById('emp-work-month').value;
  const date = document.getElementById('work-entry-date').value;
  const performedWork = document.getElementById('work-entry-work').value.trim();

  if (!month || !date || !performedWork) {
    showToast('Month, date, and work description are required', 'error');
    return;
  }

  const payload = {
    employeeId: selectedEmployee.id,
    month,
    date,
    performedWork,
    receivedAmount: document.getElementById('work-entry-payment').value,
    expenseAmount: document.getElementById('work-entry-expense').value,
    materialIssuance: document.getElementById('work-entry-material').value,
    materialBalance: document.getElementById('work-entry-mat-balance').value,
    otherRemarks: document.getElementById('work-entry-remarks').value
  };

  try {
    const res = await API.addWorkRecord(payload);
    if (res.success || res.record) {
      showToast('Entry added', 'success');
      document.getElementById('work-entry-work').value = '';
      document.getElementById('work-entry-payment').value = '';
      document.getElementById('work-entry-expense').value = '';
      document.getElementById('work-entry-starting-balance').value = '';
      document.getElementById('work-entry-remaining-balance').value = '';
      document.getElementById('work-entry-material').value = '';
      document.getElementById('work-entry-mat-balance').value = '';
      document.getElementById('work-entry-remarks').value = '';
      await loadEmployeeWorkRecords();
    } else {
      showToast(res.error || 'Failed to add entry', 'error');
    }
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleDeleteWorkRecord(id) {
  if (!selectedEmployee) return;
  if (!confirm('Delete this work entry?')) return;
  try {
    const res = await API.deleteWorkRecord(id, selectedEmployee.id);
    if (res.success) {
      showToast('Entry deleted', 'success');
      await loadEmployeeWorkRecords();
    } else {
      showToast(res.error || 'Failed to delete', 'error');
    }
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function loadAdminWorkRecords() {
  const monthInput = document.getElementById('admin-work-month');
  const empSelect = document.getElementById('admin-work-employee');

  if (!monthInput.value) monthInput.value = getCurrentMonthString();

  try {
    const employees = await API.getEmployees();
    const currentVal = empSelect.value;
    empSelect.innerHTML = '<option value="">Select employee...</option>';
    employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = emp.name;
      empSelect.appendChild(opt);
    });
    if (currentVal) empSelect.value = currentVal;

    const employeeId = empSelect.value;
    const month = monthInput.value;

    if (!employeeId) {
      document.getElementById('admin-work-summary').classList.add('hidden');
      document.querySelector('#admin-work-table tbody').innerHTML =
        '<tr><td colspan="9" class="table-empty">Select an employee and month to view records.</td></tr>';
      return;
    }

    const employee = employees.find(e => e.id === employeeId);
    const profile = await API.getWorkProfile(employeeId, month);
    currentAdminWorkRecords = await API.getWorkRecords(employeeId, month);
    if (!Array.isArray(currentAdminWorkRecords)) currentAdminWorkRecords = [];

    const totalReceived = currentAdminWorkRecords.reduce((sum, r) => sum + (r.receivedAmount !== undefined ? r.receivedAmount : (r.paymentIssuance || 0)), 0);

    document.getElementById('admin-work-summary').classList.remove('hidden');
    document.getElementById('admin-work-summary-name').textContent = employee ? employee.name : '—';
    document.getElementById('admin-work-summary-father').textContent = profile.fatherName || '—';
    document.getElementById('admin-work-summary-count').textContent = currentAdminWorkRecords.length;
    document.getElementById('admin-work-summary-payment').textContent = totalReceived.toLocaleString();

    renderWorkRecordRows(currentAdminWorkRecords, '#admin-work-table', false);
  } catch (err) {
    showToast('Failed to load work records', 'error');
  }
}

function exportWorkRecordsToCSV() {
  if (!currentAdminWorkRecords.length) {
    showToast('No records to export', 'warning');
    return;
  }
  const employeeName = document.getElementById('admin-work-summary-name').textContent;
  const month = document.getElementById('admin-work-month').value;
  const headers = ['S.No', 'Date', 'Performed Work', 'Received Amount', 'Expense Amount', 'Remaining Balance', 'Material Issuance', 'Material Balance', 'Other Remarks'];
  const rows = [headers.join(',')];
  currentAdminWorkRecords.forEach((rec, idx) => {
    const newReceived = rec.receivedAmount !== undefined ? rec.receivedAmount : (rec.paymentIssuance || 0);
    const carriedOver = rec.carriedOverBalance || 0;
    const totalReceived = rec.totalReceived !== undefined ? rec.totalReceived : (newReceived + carriedOver);
    const expense = rec.expenseAmount || 0;
    const balance = rec.remainingBalance !== undefined ? rec.remainingBalance : (totalReceived - expense);
    
    rows.push([
      idx + 1,
      formatWorkDateDisplay(rec.date),
      `"${(rec.performedWork || '').replace(/"/g, '""')}"`,
      newReceived,
      expense,
      balance,
      `"${(rec.materialIssuance || '').replace(/"/g, '""')}"`,
      `"${(rec.materialBalance || '').replace(/"/g, '""')}"`,
      `"${(rec.otherRemarks || '').replace(/"/g, '""')}"`
    ].join(','));
  });
  const link = document.createElement('a');
  link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
  link.download = `WorkRecord_${employeeName}_${month}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Work record exported', 'success');
}

// Export All Employees' Work Records to CSV
async function exportAllEmployeesWorkRecordsToCSV() {
  const month = document.getElementById('admin-work-month').value;
  if (!month) {
    showToast('Please select a month first', 'warning');
    return;
  }
  
  try {
    showToast('Generating overall work progress report...', 'info');
    // Fetch all work records for the month (passing null for employeeId fetches all)
    const records = await API.getWorkRecords(null, month);
    
    if (records.length === 0) {
      showToast(`No work records found for the month of ${month}`, 'warning');
      return;
    }

    const headers = ['S.No', 'Employee Name', 'Date', 'Performed Work', 'Received Amount', 'Expense Amount', 'Remaining Balance', 'Material Issuance', 'Material Balance', 'Other Remarks'];
    const rows = [headers.join(',')];

    records.forEach((rec, idx) => {
      const newReceived = rec.receivedAmount !== undefined ? rec.receivedAmount : (rec.paymentIssuance || 0);
      const carriedOver = rec.carriedOverBalance || 0;
      const totalReceived = rec.totalReceived !== undefined ? rec.totalReceived : (newReceived + carriedOver);
      const expense = rec.expenseAmount || 0;
      const balance = rec.remainingBalance !== undefined ? rec.remainingBalance : (totalReceived - expense);

      rows.push([
        idx + 1,
        `"${(rec.employeeName || '').replace(/"/g, '""')}"`,
        formatWorkDateDisplay(rec.date),
        `"${(rec.performedWork || '').replace(/"/g, '""')}"`,
        newReceived,
        expense,
        balance,
        `"${(rec.materialIssuance || '').replace(/"/g, '""')}"`,
        `"${(rec.materialBalance || '').replace(/"/g, '""')}"`,
        `"${(rec.otherRemarks || '').replace(/"/g, '""')}"`
      ].join(','));
    });

    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
    link.download = `WorkProgress_All_Employees_${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('All employee work progress exported', 'success');
  } catch (err) {
    showToast('Failed to export work records', 'error');
    console.error(err);
  }
}

// ==========================================================================
// WORK PROGRESS DASHBOARD
// ==========================================================================
let progressDataCache = [];

async function loadWorkProgress() {
  const dateFilter = document.getElementById('progress-date-filter');
  if (!dateFilter.value) {
    dateFilter.value = getLocalDateString();
  }

  try {
    const [employees, attendance, workRecords] = await Promise.all([
      API.getEmployees(),
      API.getAttendanceLogs(dateFilter.value),
      API.getWorkRecords(null, null)
    ]);

    // Filter work records for the selected date
    const todayWorkRecords = workRecords.filter(r => r.date === dateFilter.value);

    progressDataCache = { employees, attendance, workRecords: todayWorkRecords };

    // Calculate financial metrics
    const totalMoneySpent = attendance.reduce((sum, r) => sum + (r.moneySpent || 0), 0);
    const activeWorkers = employees.filter(e => e.status === 'IN').length;
    const tasksCompleted = todayWorkRecords.filter(r => r.otherRemarks === 'COMPLETE').length;
    const totalMinutes = attendance.reduce((sum, r) => sum + (r.duration || 0), 0);
    const totalHours = Math.floor(totalMinutes / 60);

    // Update stat cards
    document.getElementById('progress-total-spent').textContent = `PKR ${totalMoneySpent.toLocaleString()}`;
    document.getElementById('progress-active-workers').textContent = activeWorkers;
    document.getElementById('progress-completed-today').textContent = tasksCompleted;
    document.getElementById('progress-total-hours').textContent = `${totalHours}h`;

    // Render progress feed
    renderProgressFeed(employees, attendance, todayWorkRecords);

    // Render cost breakdown table
    renderCostBreakdown(employees, attendance, todayWorkRecords);

  } catch (err) {
    showToast('Failed to load work progress data', 'error');
    console.error(err);
  }
}

function renderProgressFeed(employees, attendance, workRecords) {
  const feedContainer = document.getElementById('progress-feed');
  feedContainer.innerHTML = '';

  // Combine attendance and work records into a timeline
  const timelineItems = [];

  // Add attendance records
  attendance.forEach(att => {
    const employee = employees.find(e => e.id === att.employeeId);
    if (!employee) return;

    const status = att.clockOutTime ? 'Completed' : 'Active';
    const statusClass = att.clockOutTime ? 'status-completed' : 'status-active';

    timelineItems.push({
      type: 'attendance',
      timestamp: att.clockOutTime || att.clockInTime,
      employee,
      status,
      statusClass,
      data: att,
      location: att.clockOutLocation || att.clockInLocation
    });
  });

  // Add work records
  workRecords.forEach(wr => {
    const employee = employees.find(e => e.id === wr.employeeId);
    if (!employee) return;

    const status = wr.otherRemarks === 'COMPLETE' ? 'Completed' : wr.otherRemarks === 'PENDING' ? 'On Break' : 'Active';
    const statusClass = wr.otherRemarks === 'COMPLETE' ? 'status-completed' : wr.otherRemarks === 'PENDING' ? 'status-break' : 'status-active';

    timelineItems.push({
      type: 'work',
      timestamp: wr.createdAt,
      employee,
      status,
      statusClass,
      data: wr,
      location: null
    });
  });

  // Sort by timestamp (newest first)
  timelineItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (timelineItems.length === 0) {
    feedContainer.innerHTML = '<div class="progress-empty">No work progress recorded for this date.</div>';
    return;
  }

  // Render timeline
  timelineItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'progress-card';

    const timeStr = formatDateTime(item.timestamp);
    const locationLink = item.location
      ? `<a href="https://www.google.com/maps?q=${item.location.latitude},${item.location.longitude}" target="_blank" class="location-link">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:14px;height:14px;">
             <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
             <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
           </svg>
           View Location
         </a>`
      : '<span class="text-muted" style="font-size:0.8rem">No GPS</span>';

    if (item.type === 'attendance') {
      const duration = item.data.duration ? `${item.data.duration}m` : 'Active';
      const notes = item.data.performanceNotes || 'No performance notes';
      const moneySpent = item.data.moneySpent ? `PKR ${item.data.moneySpent.toLocaleString()}` : 'PKR 0';
      const photoHtml = item.data.image ? `
        <div class="progress-detail" style="margin-top: 0.5rem; display: block;">
          <span class="detail-label">Work Photo:</span>
          <img src="${item.data.image}" alt="Work Photo" class="progress-photo-thumbnail" style="max-width: 120px; max-height: 90px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); cursor: pointer; display: block; margin-top: 0.25rem; object-fit: cover;" />
        </div>
      ` : '';

      card.innerHTML = `
        <div class="progress-card-header">
          <div class="progress-employee-info">
            <div class="progress-avatar">${item.employee.name.charAt(0).toUpperCase()}</div>
            <div>
              <strong>${item.employee.name}</strong>
              <span class="badge-role">${item.employee.role || 'Staff'}</span>
            </div>
          </div>
          <span class="progress-badge ${item.statusClass}">${item.status}</span>
        </div>
        <div class="progress-card-body">
          <div class="progress-detail">
            <span class="detail-label">Time:</span>
            <span class="detail-value">${timeStr}</span>
          </div>
          <div class="progress-detail">
            <span class="detail-label">Duration:</span>
            <span class="detail-value">${duration}</span>
          </div>
          <div class="progress-detail">
            <span class="detail-label">Money Spent:</span>
            <span class="detail-value">${moneySpent}</span>
          </div>
          <div class="progress-detail">
            <span class="detail-label">Location:</span>
            <span class="detail-value">${locationLink}</span>
          </div>
          ${photoHtml}
          <div class="progress-notes">
            <span class="detail-label">Notes:</span>
            <p class="detail-notes">${notes}</p>
          </div>
        </div>
      `;
    } else {
      const payment = item.data.paymentIssuance ? `PKR ${item.data.paymentIssuance.toLocaleString()}` : 'PKR 0';
      const workDesc = item.data.performedWork || 'No work description';

      card.innerHTML = `
        <div class="progress-card-header">
          <div class="progress-employee-info">
            <div class="progress-avatar">${item.employee.name.charAt(0).toUpperCase()}</div>
            <div>
              <strong>${item.employee.name}</strong>
              <span class="badge-role">${item.employee.role || 'Staff'}</span>
            </div>
          </div>
          <span class="progress-badge ${item.statusClass}">${item.status}</span>
        </div>
        <div class="progress-card-body">
          <div class="progress-detail">
            <span class="detail-label">Time:</span>
            <span class="detail-value">${timeStr}</span>
          </div>
          <div class="progress-detail">
            <span class="detail-label">Payment:</span>
            <span class="detail-value">${payment}</span>
          </div>
          <div class="progress-notes">
            <span class="detail-label">Work:</span>
            <p class="detail-notes">${workDesc}</p>
          </div>
        </div>
      `;
    }

    // Bind thumbnail click if image exists
    card.querySelectorAll('.progress-photo-thumbnail').forEach(img => {
      img.addEventListener('click', () => {
        openPhotoModal(img.src);
      });
    });

    feedContainer.appendChild(card);
  });
}

function renderCostBreakdown(employees, attendance, workRecords) {
  const tbody = document.querySelector('#progress-cost-table tbody');
  tbody.innerHTML = '';

  if (employees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No employees found.</td></tr>';
    return;
  }

  employees.forEach(emp => {
    const empAttendance = attendance.filter(a => a.employeeId === emp.id);
    const empWorkRecords = workRecords.filter(w => w.employeeId === emp.id);

    const totalMinutes = empAttendance.reduce((sum, a) => sum + (a.duration || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);
    const totalMoneySpent = empAttendance.reduce((sum, a) => sum + (a.moneySpent || 0), 0);
    const tasksCompleted = empWorkRecords.filter(w => w.otherRemarks === 'COMPLETE').length;

    const statusBadge = emp.status === 'IN'
      ? '<span class="status-indicator status-in">Active</span>'
      : '<span class="status-indicator status-out">Clocked Out</span>';

    const lastLocation = empAttendance.length > 0 && empAttendance[0].clockOutLocation
      ? `<a href="https://www.google.com/maps?q=${empAttendance[0].clockOutLocation.latitude},${empAttendance[0].clockOutLocation.longitude}" target="_blank" class="map-link">View</a>`
      : empAttendance.length > 0 && empAttendance[0].clockInLocation
      ? `<a href="https://www.google.com/maps?q=${empAttendance[0].clockInLocation.latitude},${empAttendance[0].clockInLocation.longitude}" target="_blank" class="map-link">View</a>`
      : '<span class="text-muted">—</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${emp.name}</strong></td>
      <td><span class="badge-role">${emp.role || 'Staff'}</span></td>
      <td>${statusBadge}</td>
      <td>${totalHours}h</td>
      <td>PKR ${totalMoneySpent.toLocaleString()}</td>
      <td>${tasksCompleted}</td>
      <td>${lastLocation}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================================================
// MODALS LOGIC
// ==========================================================================
function openAdminAuthModal() {
  document.getElementById('admin-auth-modal').classList.remove('hidden');
  document.getElementById('auth-error-msg').classList.add('hidden');
  document.getElementById('auth-passcode').value = '';
  document.getElementById('auth-passcode').focus();
}

// ==========================================================================
// FORM SUBMISSIONS (DOCUMENTS)
// ==========================================================================

// Employee: submit new document
async function handleAddDocumentSubmit(e) {
  e.preventDefault();
  if (!selectedEmployee) return;

  const formType = document.getElementById('doc-type').value;
  const docNumber = document.getElementById('doc-number').value.trim();
  const docNotes = document.getElementById('doc-notes').value.trim();

  if (!formType || !docNumber) {
    showToast('Document type and number/title are required', 'error');
    return;
  }

  try {
    const existingSubmissions = await API.getFormSubmissions(selectedEmployee.id);
    const hasSameDocument = Array.isArray(existingSubmissions)
      ? existingSubmissions.some(sub => sub.formType === formType)
      : false;

    if (hasSameDocument) {
      showToast(`You have already submitted a ${formType} document.`, 'warning');
      return;
    }

    const payload = {
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      formType,
      formData: {
        documentNumber: docNumber,
        notes: docNotes,
        documentImage: selectedDocumentImageBase64 || null
      }
    };

    const res = await API.saveFormSubmission(payload);
    if (res.success || res.submission) {
      showToast('Document submitted successfully', 'success');
      document.getElementById('form-add-document').reset();
      resetDocumentUpload();
      await loadEmployeeForms();
    } else {
      showToast(res.error || 'Failed to submit documents', 'error');
    }
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

// Employee: load their form submissions
async function loadEmployeeForms() {
  if (!selectedEmployee) return;

  try {
    const response = await API.getFormSubmissions(selectedEmployee.id);
    const submissions = Array.isArray(response) ? response : [];
    const documentSubmissions = submissions.filter(sub => sub.formType !== 'Leave');

    const formContainer = document.getElementById('emp-doc-form-container');
    const tableWrapper = document.getElementById('emp-doc-table-wrapper');
    const tbody = document.querySelector('#emp-forms-table tbody');

    // Always show form container and table wrapper so they can submit multiple types
    if (formContainer) formContainer.classList.remove('hidden');
    if (tableWrapper) tableWrapper.classList.remove('hidden');

    // Hide the submitted message panel (it's no longer a one-time block)
    const submittedMessage = document.getElementById('emp-doc-submitted-message');
    if (submittedMessage) submittedMessage.classList.add('hidden');

    // Disable already submitted document types in the dropdown
    const docTypeSelect = document.getElementById('doc-type');
    if (docTypeSelect) {
      const submittedTypes = documentSubmissions.map(sub => sub.formType);
      Array.from(docTypeSelect.options).forEach(opt => {
        if (opt.value && opt.value !== '') {
          const isSubmitted = submittedTypes.includes(opt.value);
          opt.disabled = isSubmitted;
          if (isSubmitted) {
            opt.text = opt.text.replace(' (Submitted)', '') + ' (Submitted)';
          } else {
            opt.text = opt.text.replace(' (Submitted)', '');
          }
        }
      });
      docTypeSelect.value = '';
    }

    if (documentSubmissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No documents submitted yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    documentSubmissions.forEach((sub, idx) => {
      const tr = document.createElement('tr');
      const submittedDate = sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : '-';
      
      const typeLabels = {
        CNIC: 'CNIC / ID Card',
        CV: 'CV / Resume',
        Certificate: 'Certificate',
        Contract: 'Contract / Agreement',
        BankDetails: 'Bank Details',
        Leave: 'Leave Application',
        Other: 'Other'
      };
      const typeLabel = typeLabels[sub.formType] || sub.formType;

      tr.innerHTML = `
        <td class="col-sn">${idx + 1}</td>
        <td>${submittedDate}</td>
        <td><span class="badge-role">${typeLabel}</span></td>
        <td>${sub.formData?.documentNumber || '-'}</td>
        <td>${sub.formData?.notes || '-'}</td>
        <td><span class="status-indicator status-in" style="font-size:0.75rem;">Submitted</span></td>
        <td>-</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load documents:', err);
    showToast('Failed to load documents', 'error');
    const tbody = document.querySelector('#emp-forms-table tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Failed to load documents.</td></tr>';
    }
  }
}

// Admin: load form submissions with filters
async function loadAdminForms() {
  const empSelect = document.getElementById('admin-form-employee');
  const typeSelect = document.getElementById('admin-form-type');

  try {
    const employees = await API.getEmployees();
    const currentVal = empSelect.value;
    empSelect.innerHTML = '<option value="">All Employees</option>';
    employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = emp.name;
      empSelect.appendChild(opt);
    });
    if (currentVal) empSelect.value = currentVal;

    const employeeId = empSelect.value || null;
    const formType = typeSelect.value || null;

    const response = await API.getFormSubmissions(employeeId, formType);
    const submissions = Array.isArray(response) ? response : [];
    const tbody = document.querySelector('#admin-forms-table tbody');
    tbody.innerHTML = '';

    if (submissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No form submissions found.</td></tr>';
      return;
    }

    const typeLabels = {
      CNIC: 'CNIC / ID Card',
      CV: 'CV / Resume',
      Certificate: 'Certificate',
      Contract: 'Contract / Agreement',
      BankDetails: 'Bank Details',
      Leave: 'Leave Application',
      Other: 'Other'
    };

    submissions.forEach((sub, idx) => {
      const tr = document.createElement('tr');
      const submittedDate = sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : '-';
      const typeLabel = typeLabels[sub.formType] || sub.formType;
      const filePreviewButton = sub.formData?.documentImage
        ? `<button class="btn btn-secondary btn-view-doc" data-img="${sub.formData.documentImage}">View</button>`
        : '<span class="text-muted" style="font-size:0.85rem;">No file</span>';

      tr.innerHTML = `
        <td class="col-sn">${idx + 1}</td>
        <td><strong>${sub.employeeName}</strong></td>
        <td>${submittedDate}</td>
        <td><span class="badge-role">${typeLabel}</span></td>
        <td>${sub.formData?.documentNumber || '-'}</td>
        <td>${sub.formData?.notes || '-'}</td>
        <td>${filePreviewButton}</td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.btn-view-doc').forEach(btn => {
      btn.addEventListener('click', () => openPhotoModal(btn.getAttribute('data-img')));
    });
  } catch (err) {
    showToast('Failed to load form submissions', 'error');
  }
}

// Export forms to CSV
function exportFormsToCSV() {
  const empSelect = document.getElementById('admin-form-employee');
  const typeSelect = document.getElementById('admin-form-type');
  const empValue = empSelect.value;
  const typeValue = typeSelect.value;

  // Fetch filtered data
  API.getFormSubmissions(empValue || null, typeValue || null).then(submissions => {
    if (!submissions || submissions.length === 0) {
      showToast('No records to export', 'warning');
      return;
    }

    const typeLabels = {
      CNIC: 'CNIC / ID Card',
      CV: 'CV / Resume',
      Certificate: 'Certificate',
      Contract: 'Contract / Agreement',
      BankDetails: 'Bank Details',
      Leave: 'Leave Application',
      Other: 'Other'
    };

    const headers = ['S.No', 'Employee Name', 'Submitted Date', 'Type', 'Number / Title', 'Notes'];
    const rows = [headers.join(',')];

    submissions.forEach((sub, idx) => {
      const submittedDate = sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : '';
      const typeLabel = typeLabels[sub.formType] || sub.formType;
      rows.push([
        idx + 1,
        `"${(sub.employeeName || '').replace(/"/g, '""')}"`,
        submittedDate,
        typeLabel,
        `"${(sub.formData?.documentNumber || '').replace(/"/g, '""')}"`,
        `"${(sub.formData?.notes || '').replace(/"/g, '""')}"`
      ]);
    });

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Form_Submissions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Form submissions exported', 'success');
  }).catch(err => {
    console.error('Export error:', err);
    showToast('Failed to export', 'error');
  });
}

// Export forms to PDF
function exportFormsToPDF() {
  const tableContainer = document.getElementById('admin-forms-table');
  if (!tableContainer) return;

  const opt = {
    margin: 0.5,
    filename: `Form_Submissions_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
  };

  showToast('Generating PDF...', 'info');
  html2pdf().set(opt).from(tableContainer).save().then(() => {
    showToast('PDF Exported Successfully', 'success');
  });
}

// ==========================================================================
// EVALUATIONS LOGIC (AUTOMATIC)
// ==========================================================================
function initEvaluationsTab() {
  const monthInput = document.getElementById('eval-month');
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  if (!monthInput.value) {
    monthInput.value = currentMonth;
  }

  monthInput.addEventListener('change', loadEvaluations);
  loadEvaluations();
}

async function loadEvaluations() {
  const month = document.getElementById('eval-month').value;
  if (!month) return;
  
  const tbody = document.querySelector('#evaluations-table tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Calculating...</td></tr>';
  
  try {
    // Fetch all required data for calculation
    const [employees, allAttendance, workRecords] = await Promise.all([
      API.getEmployees(),
      API.getAttendanceLogs(),
      API.getWorkRecords()
    ]);
    
    // Filter attendance and work records by the selected month
    const monthAttendance = allAttendance.filter(a => a.date && a.date.startsWith(month));
    const monthWorkRecords = workRecords.filter(w => w.date && w.date.startsWith(month));

    const stats = {};

    // Initialize stats
    employees.forEach(emp => {
      stats[emp.id] = {
        name: emp.name,
        totalDays: 0,
        totalHours: 0,
        workCount: 0,
        score: 0
      };
    });

    // Process Attendance
    monthAttendance.forEach(a => {
      if (stats[a.employeeId]) {
        stats[a.employeeId].totalDays += 1;
        if (a.duration) {
          stats[a.employeeId].totalHours += (a.duration / 60); // minutes to hours
        }
      }
    });

    // Process Work Records
    monthWorkRecords.forEach(w => {
      if (stats[w.employeeId]) {
        stats[w.employeeId].workCount += 1;
      }
    });

    const evaluations = [];
    
    // Calculate Score (Max ~100)
    for (const id in stats) {
      const s = stats[id];
      // Include all employees, even if they haven't worked this month
      let rawScore = (s.totalDays * 2) + (s.totalHours * 0.2) + (s.workCount * 1);
      s.score = Math.min(100, Math.round(rawScore));
      evaluations.push(s);
    }

    if (evaluations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No employees found.</td></tr>';
      document.getElementById('best-employee-card').innerHTML = 'No employees available';
      return;
    }
    
    // Sort by score descending
    evaluations.sort((a, b) => b.score - a.score);
    
    const bestEval = evaluations[0];
    
    if (bestEval.score > 0) {
      document.getElementById('best-employee-card').innerHTML = `
        <div style="font-size: 2rem;">🌟 ${bestEval.name} 🌟</div>
        <div style="font-size: 1.2rem; margin-top: 0.5rem; font-weight: normal; color: var(--text-muted);">
          Auto-Score: <strong>${bestEval.score}</strong> / 100
        </div>
      `;
    } else {
      document.getElementById('best-employee-card').innerHTML = `
        <div style="font-size: 1.2rem; color: var(--text-muted); margin-top: 0.5rem;">
          No work recorded yet for this month.
        </div>
      `;
    }

    tbody.innerHTML = '';
    evaluations.forEach((ev, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><strong>${ev.name}</strong></td>
        <td>${ev.totalHours.toFixed(1)} hrs</td>
        <td>${ev.totalDays} days</td>
        <td>${ev.workCount}</td>
        <td><span class="badge ${ev.score >= 50 ? 'badge-in' : (ev.score > 0 ? 'badge-out' : '')}">${ev.score}</span></td>
      `;
      tbody.appendChild(tr);
    });
    
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Error calculating evaluations.</td></tr>';
  }
}

// ==========================================================================
// PWA INSTALLATION LOGIC
// ==========================================================================
let deferredPrompt;

function showInstallButton() {
  const installBtn = document.getElementById('btn-install-app');
  if (installBtn) {
    installBtn.style.display = 'flex';
  }
}

function hideInstallButton() {
  const installBtn = document.getElementById('btn-install-app');
  if (installBtn) {
    installBtn.style.display = 'none';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton();
});

function handleInstallClick() {
  const installBtn = document.getElementById('btn-install-app');
  if (!deferredPrompt) {
    showToast('Install prompt is not available yet. Please try again later.', 'warning');
    return;
  }

  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(({ outcome }) => {
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
    hideInstallButton();
  }).catch((err) => {
    console.error('Install prompt error:', err);
    showToast('Unable to show install prompt.', 'error');
  });
}

window.addEventListener('appinstalled', () => {
  hideInstallButton();
  deferredPrompt = null;
  console.log('PWA was installed');
});

function closeAdminAuthModal() {
  document.getElementById('admin-auth-modal').classList.add('hidden');
}

// ==========================================================================
// EMPLOYEE SESSION & PIN AUTH LOGIC
// ==========================================================================
let authTargetEmployee = null;

function clickEmployeeFromList(employee) {
  const sessionId = localStorage.getItem('loggedInEmployeeId');
  if (sessionId === employee.id) {
    selectEmployee(employee);
    setupEmployeeSessionUI(employee);
  } else {
    openEmployeeAuthModal(employee);
  }
}

function openEmployeeAuthModal(employee) {
  authTargetEmployee = employee;
  document.getElementById('emp-auth-title').innerText = `Verify PIN for ${employee.name}`;
  document.getElementById('employee-auth-modal').classList.remove('hidden');
  document.getElementById('emp-auth-error-msg').classList.add('hidden');
  const pinField = document.getElementById('emp-auth-pin');
  pinField.value = '';
  pinField.focus();
}

function closeEmployeeAuthModal() {
  document.getElementById('employee-auth-modal').classList.add('hidden');
  authTargetEmployee = null;
}

async function handleEmployeeAuthSubmit(e) {
  e.preventDefault();
  if (!authTargetEmployee) return;
  
  const pinInput = document.getElementById('emp-auth-pin');
  const pin = pinInput.value;
  const errorMsg = document.getElementById('emp-auth-error-msg');
  
  errorMsg.classList.add('hidden');
  
  try {
    const res = await API.verifyEmployeePin(authTargetEmployee.id, pin);
    if (res.success) {
      localStorage.setItem('loggedInEmployeeId', authTargetEmployee.id);
      const emp = authTargetEmployee;
      closeEmployeeAuthModal();
      
      await selectEmployee(emp);
      setupEmployeeSessionUI(emp);
      showToast(`Welcome, ${emp.name}!`, 'success');
    } else {
      errorMsg.classList.remove('hidden');
      pinInput.value = '';
      pinInput.focus();
    }
  } catch (err) {
    errorMsg.classList.remove('hidden');
    pinInput.value = '';
    pinInput.focus();
  }
}

function setupEmployeeSessionUI(employee) {
  // Hide select list
  document.getElementById('select-employee-panel').classList.add('hidden');
  // Hide admin toggle
  document.getElementById('btn-toggle-portal').classList.add('hidden');
  // Show logout button
  document.getElementById('btn-employee-logout').classList.remove('hidden');
  // Show employee sub-tabs
  document.getElementById('employee-subnav').classList.remove('hidden');
  // Set session active to grid
  document.getElementById('portal-grid').classList.add('session-active');
  switchEmployeeTab('emp-pane-attendance');

  document.getElementById('emp-work-month').value = getCurrentMonthString();
  document.getElementById('emp-work-name').value = employee.name;

  // Make sure to request fresh location
  fetchLocation();
}

async function handleEmployeeLogout() {
  if (!selectedEmployee) return;

  localStorage.removeItem('loggedInEmployeeId');
  
  // Show select list
  document.getElementById('select-employee-panel').classList.remove('hidden');
  // Show admin toggle if not in strict employee mode
  if (!strictEmployeeMode) {
    document.getElementById('btn-toggle-portal').classList.remove('hidden');
  }
  // Hide logout button
  document.getElementById('btn-employee-logout').classList.add('hidden');
  // Clear session active grid
  document.getElementById('portal-grid').classList.remove('session-active', 'work-record-active');
  document.getElementById('employee-subnav').classList.add('hidden');
  switchEmployeeTab('emp-pane-attendance');

  // Reset selected employee details
  document.getElementById('clock-card-content').classList.add('hidden');
  document.getElementById('clock-card-placeholder').classList.remove('hidden');
  
  selectedEmployee = null;
  userLocation = null;
  stopShiftTimer();
  
  // Reload portal employees list
  loadEmployeesList();
  showToast('Logged out successfully', 'info');
}

// Change PIN Modal
function openChangePinModal() {
  if (!selectedEmployee) return;
  document.getElementById('change-pin-modal').classList.remove('hidden');
  document.getElementById('change-pin-error-msg').classList.add('hidden');
  document.getElementById('change-pin-old').value = '';
  document.getElementById('change-pin-new').value = '';
  document.getElementById('change-pin-old').focus();
}

function closeChangePinModal() {
  document.getElementById('change-pin-modal').classList.add('hidden');
}

async function handleChangePinSubmit(e) {
  e.preventDefault();
  if (!selectedEmployee) return;
  
  const oldPin = document.getElementById('change-pin-old').value;
  const newPin = document.getElementById('change-pin-new').value;
  const errorMsg = document.getElementById('change-pin-error-msg');
  
  errorMsg.classList.add('hidden');
  
  if (!/^\d{4}$/.test(newPin)) {
    showToast('New PIN must be exactly 4 digits.', 'error');
    return;
  }
  
  try {
    const res = await API.updateEmployeePin(selectedEmployee.id, oldPin, newPin);
    if (res.success) {
      closeChangePinModal();
      showToast('PIN changed successfully!', 'success');
    } else {
      errorMsg.innerText = res.error || 'Failed to change PIN.';
      errorMsg.classList.remove('hidden');
    }
  } catch (err) {
    errorMsg.innerText = 'Incorrect current PIN or invalid new PIN.';
    errorMsg.classList.remove('hidden');
  }
}

let strictEmployeeMode = false;

async function handleQueryParams() {
  const urlParams = new URLSearchParams(window.location.search);
  
  // 1. Strict Employee Mode check
  if (urlParams.get('mode') === 'employee') {
    strictEmployeeMode = true;
    const btnToggle = document.getElementById('btn-toggle-portal');
    if (btnToggle) btnToggle.classList.add('hidden');
    
    // Hide the employee list so they only see their own login/dashboard
    document.getElementById('select-employee-panel').classList.add('hidden');
    document.getElementById('portal-grid').classList.add('session-active');
  }
  
  // 2. Direct Employee Login link check (by token or empId)
  const tokenParam = urlParams.get('token');
  if (tokenParam) {
    try {
      const res = await API.getEmployeeByToken(tokenParam);
      if (res.success && res.employee) {
        const emp = res.employee;
        localStorage.setItem('loggedInEmployeeId', emp.id);
        selectEmployee(emp);
        setupEmployeeSessionUI(emp);
        checkAndShowLinkExpiryNotice(emp);
        return;
      }
    } catch (e) {
      console.error('Token login failed', e);
    }
  }
  const empIdParam = urlParams.get('empId');
  if (empIdParam) {
    const loggedInId = localStorage.getItem('loggedInEmployeeId');
    if (loggedInId !== empIdParam) {
      // Find the employee in loaded employees
      const emp = allEmployees.find(e => e.id === empIdParam);
      if (emp) {
        clickEmployeeFromList(emp);
      }
    }
  }
}

// ==========================================================================
// PHOTO UPLOAD & VIEW HELPER FUNCTIONS
// ==========================================================================
let selectedClockOutPhotoBase64 = null;

function compressImage(file, maxWidth, maxHeight, quality, callback) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = function (event) {
    const img = new Image();
    img.src = event.target.result;
    img.onload = function () {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      callback(dataUrl);
    };
  };
}

function resetClockOutPhoto() {
  selectedClockOutPhotoBase64 = null;
  const fileInput = document.getElementById('clockout-photo');
  if (fileInput) fileInput.value = '';
  const previewContainer = document.getElementById('photo-preview-container');
  if (previewContainer) previewContainer.classList.add('hidden');
  const previewImg = document.getElementById('photo-preview');
  if (previewImg) previewImg.src = '';
}

function resetDocumentUpload() {
  selectedDocumentImageBase64 = null;
  const fileInput = document.getElementById('doc-file');
  if (fileInput) fileInput.value = '';
  const previewContainer = document.getElementById('doc-file-preview-container');
  if (previewContainer) previewContainer.classList.add('hidden');
  const previewImg = document.getElementById('doc-file-preview');
  if (previewImg) previewImg.src = '';
}

function openPhotoModal(imgSrc) {
  const modal = document.getElementById('photo-view-modal');
  const modalImg = document.getElementById('photo-modal-img');
  if (modal && modalImg) {
    modalImg.src = imgSrc;
    modal.classList.remove('hidden');
  }
}

function closePhotoModal() {
  const modal = document.getElementById('photo-view-modal');
  const modalImg = document.getElementById('photo-modal-img');
  if (modal) {
    modal.classList.add('hidden');
  }
  setTimeout(() => {
    if (modalImg) modalImg.src = '';
  }, 300);
}

// ==========================================================================
// DAILY CASH REGISTRY CARRY-OVER & PDF GENERATION
// ==========================================================================

async function getCarryOverBalanceForDate(employeeId, targetDateStr) {
  try {
    // Only look at records within the same month so balances don't leak across months
    const monthStr = targetDateStr.substring(0, 7); // "YYYY-MM"
    const allRecords = await API.getWorkRecords(employeeId, monthStr);
    if (!Array.isArray(allRecords) || allRecords.length === 0) {
      return 0;
    }
    
    // Sort them chronologically
    allRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    let runningBalance = 0;
    for (const rec of allRecords) {
      if (rec.date < targetDateStr) {
        const received = Number(rec.receivedAmount !== undefined ? rec.receivedAmount : (rec.paymentIssuance || 0));
        const expense = Number(rec.expenseAmount || 0);
        runningBalance = runningBalance + received - expense;
      }
    }
    return runningBalance;
  } catch (err) {
    console.error('Error calculating carry-over balance:', err);
    return 0;
  }
}

async function updateAutoCalculatedBalance(targetDate) {
  if (!selectedEmployee) return;
  
  // Use provided date or default to today
  const dateStr = targetDate || getLocalDateString();
  const receivedInput = document.getElementById('clockout-received');
  const expenseInput = document.getElementById('clockout-expense');
  const balanceInput = document.getElementById('clockout-balance');
  const prevBalanceInput = document.getElementById('clockout-starting-balance');
  
  if (!receivedInput || !expenseInput || !balanceInput || !prevBalanceInput) return;
  
  const receivedVal = Number(receivedInput.value) || 0;
  const expenseVal = Number(expenseInput.value) || 0;
  
  const carryOver = await getCarryOverBalanceForDate(selectedEmployee.id, dateStr);
  
  prevBalanceInput.value = carryOver.toFixed(2);
  
  const totalReceived = carryOver + receivedVal;
  const remaining = totalReceived - expenseVal;
  
  balanceInput.value = remaining.toFixed(2);
}

// Update starting balance and remaining balance in the "Add Daily Entry" form
async function updateWorkEntryBalance() {
  if (!selectedEmployee) return;
  
  const dateInput = document.getElementById('work-entry-date');
  const startingInput = document.getElementById('work-entry-starting-balance');
  const paymentInput = document.getElementById('work-entry-payment');
  const expenseInput = document.getElementById('work-entry-expense');
  const remainingInput = document.getElementById('work-entry-remaining-balance');
  
  if (!dateInput || !startingInput || !paymentInput || !expenseInput || !remainingInput) return;
  
  const targetDate = dateInput.value;
  if (!targetDate) return;
  
  const carryOver = await getCarryOverBalanceForDate(selectedEmployee.id, targetDate);
  const payment = Number(paymentInput.value) || 0;
  const expense = Number(expenseInput.value) || 0;
  const remaining = carryOver + payment - expense;
  
  startingInput.value = carryOver.toFixed(2);
  remainingInput.value = remaining.toFixed(2);
}

async function exportWorkRecordsToPDF(employeeId, month, employeeName) {
  try {
    showToast('Generating PDF report...', 'info');
    
    // 1. Fetch records & profile
    const records = await API.getWorkRecords(employeeId, month);
    if (!records || records.length === 0) {
      showToast('No records found for this month', 'warning');
      return;
    }
    
    const profile = await API.getWorkProfile(employeeId, month);
    const fatherName = profile.fatherName || '—';
    
    // Format Month display (e.g. "June 2026")
    const dateObj = new Date(month + '-02'); // add day to avoid timezone shifting
    const monthDisplay = dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    
    // 2. Build PDF Document Container
    const printContainer = document.createElement('div');
    printContainer.className = 'pdf-report-wrapper';
    
    let htmlContent = `
      <div class="pdf-header">
        <h1 class="pdf-title">MONTHLY EXPENSE REPORT</h1>
        <div class="pdf-subtitle">${monthDisplay}</div>
        <div class="pdf-meta-grid">
          <div class="pdf-meta-item"><strong>Employee Name:</strong> ${employeeName}</div>
          <div class="pdf-meta-item"><strong>Father's Name:</strong> ${fatherName}</div>
        </div>
      </div>
      
      <div class="pdf-flow-container">
    `;
    
    records.forEach((rec, idx) => {
      const amountAdded = rec.receivedAmount !== undefined ? rec.receivedAmount : (rec.paymentIssuance || 0);
      const startingBalance = rec.carriedOverBalance || 0;
      const totalBalance = startingBalance + amountAdded;
      const expenses = rec.expenseAmount || 0;
      const remainingBalance = rec.remainingBalance !== undefined ? rec.remainingBalance : (totalBalance - expenses);
      
      const fmtStarting = startingBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const fmtAdded = amountAdded.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const fmtTotal = totalBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const fmtExpenses = expenses.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const fmtRemaining = remainingBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      
      const isLast = idx === records.length - 1;
      
      htmlContent += `
        <div class="pdf-flow-row">
          <div class="pdf-flow-date">${formatWorkDateDisplay(rec.date)}</div>
          
          <div class="pdf-flow-boxes">
            <!-- Starting Balance Box -->
            <div class="pdf-box pdf-box-starting">
              <div class="pdf-box-title">STARTING</div>
              <div class="pdf-box-value">PKR ${fmtStarting}</div>
            </div>
            
            <div class="pdf-flow-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            
            <!-- Amount Added Box -->
            <div class="pdf-box pdf-box-received">
              <div class="pdf-box-title">ADDED</div>
              <div class="pdf-box-value">+PKR ${fmtAdded}</div>
              <div class="pdf-box-total">Total: PKR ${fmtTotal}</div>
            </div>
            
            <div class="pdf-flow-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            
            <!-- Expense Box -->
            <div class="pdf-box pdf-box-expense">
              <div class="pdf-box-title">EXPENSES</div>
              <div class="pdf-box-value">-PKR ${fmtExpenses}</div>
              <div class="pdf-box-desc" title="${rec.performedWork || ''}">Work: ${rec.performedWork || 'Daily task'}</div>
            </div>
            
            <div class="pdf-flow-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            
            <!-- Remaining Balance Box -->
            <div class="pdf-box pdf-box-balance">
              <div class="pdf-box-title">REMAINING</div>
              <div class="pdf-box-value">PKR ${fmtRemaining}</div>
            </div>
          </div>
      `;
      
      if (!isLast) {
        htmlContent += `
          <div class="pdf-row-connector">
            <svg width="100%" height="45" viewBox="0 0 100 45" preserveAspectRatio="none">
              <path d="M 85 0 L 85 20 L 15 20 L 15 40" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>
              <polygon points="15,45 10,37 20,37" fill="#6366f1"/>
            </svg>
          </div>
        `;
      }
      
      htmlContent += `</div>`;
    });
    
    const totalReceivedSum = records.reduce((sum, r) => sum + (r.receivedAmount || 0), 0);
    const totalExpenseSum = records.reduce((sum, r) => sum + (r.expenseAmount || 0), 0);
    const endingBalance = records[records.length - 1].remainingBalance || 0;
    
    htmlContent += `
      </div>
      
      <div class="pdf-footer-summary">
        <h3 class="pdf-summary-title">MONTHLY SUMMARY</h3>
        <div class="pdf-summary-grid">
          <div class="pdf-summary-card">
            <span class="pdf-card-label">Total Cash Received</span>
            <span class="pdf-card-val text-success">PKR ${totalReceivedSum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div class="pdf-summary-card">
            <span class="pdf-card-label">Total Expenses</span>
            <span class="pdf-card-val text-danger">PKR ${totalExpenseSum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div class="pdf-summary-card">
            <span class="pdf-card-label">Ending Balance (Carried Over)</span>
            <span class="pdf-card-val text-primary">PKR ${endingBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
        </div>
        <div class="pdf-signature-section">
          <div class="pdf-signature-line">
            <div class="sig-line"></div>
            <span>Employee Signature</span>
          </div>
          <div class="pdf-signature-line">
            <div class="sig-line"></div>
            <span>Manager Signature</span>
          </div>
        </div>
      </div>
    `;
    
    printContainer.innerHTML = htmlContent;
    document.body.appendChild(printContainer);
    
    if (window.html2pdf) {
      const opt = {
        margin:       [10, 10, 15, 10],
        filename:     `${employeeName}_Expense_Report_${month}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
      };
      
      await html2pdf().set(opt).from(printContainer).save();
      document.body.removeChild(printContainer);
      showToast('PDF downloaded successfully!', 'success');
    } else {
      showToast('html2pdf library offline. Opening browser print dialog...', 'info');
      window.print();
      document.body.removeChild(printContainer);
    }
  } catch (err) {
    console.error('Error generating PDF:', err);
    showToast('Failed to generate PDF', 'error');
  }
}

// ==========================================================================
// BOOTSTRAP EVENT BINDINGS
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Init clock
  initClock();
  initEmergencySalaryGenerator();
  
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('Service Worker Registered'))
      .catch(err => console.error('Service Worker Registry Failed', err));
  }
  
  // Install button handler
  const installBtn = document.getElementById('btn-install-app');
  if (installBtn) {
    installBtn.addEventListener('click', handleInstallClick);
  }
  
  // 2. Fetch configurations
  API.getSettings().then(res => {
    if (res.officeName) {
      document.getElementById('office-title').innerText = res.officeName;
    }
  });

  // 3. Load Employees in Portal, restore session, and handle direct links
  loadEmployeesList().then(() => {
    const loggedInId = localStorage.getItem('loggedInEmployeeId');
    if (loggedInId) {
      const emp = allEmployees.find(e => e.id === loggedInId);
      if (emp) {
        selectEmployee(emp);
        setupEmployeeSessionUI(emp);
      }
    }
    
    // Check URL parameters for direct login links & strict employee mode
    handleQueryParams();
  });

  // 4. Set default date value on admin date input to today
  document.getElementById('admin-date-filter').value = getLocalDateString();

  // --- BUTTONS/INTERACTION BINDS ---

  // Search staff listing
  document.getElementById('employee-search').addEventListener('input', (e) => {
    filterPortalEmployees(e.target.value);
  });

  // Location retry
  document.getElementById('btn-retry-location').addEventListener('click', fetchLocation);

  // Clock in & out operations
  document.getElementById('btn-clock-in').addEventListener('click', handleClockIn);
  document.getElementById('btn-clock-out').addEventListener('click', handleClockOut);
  document.getElementById('form-clockout-details').addEventListener('submit', submitClockOutDetails);
  document.getElementById('btn-close-clockout-modal').addEventListener('click', closeClockOutModal);

  // Admin lock modal close
  document.getElementById('btn-close-auth-modal').addEventListener('click', closeAdminAuthModal);

  // Auth passcode submit
  document.getElementById('form-admin-auth').addEventListener('submit', handleAdminAuthSubmit);

  // Employee PIN verify submit & close
  document.getElementById('btn-close-emp-auth-modal').addEventListener('click', closeEmployeeAuthModal);
  document.getElementById('form-employee-auth').addEventListener('submit', handleEmployeeAuthSubmit);
  document.getElementById('btn-employee-logout').addEventListener('click', handleEmployeeLogout);

  // Change PIN bindings
  document.getElementById('btn-change-pin').addEventListener('click', openChangePinModal);
  document.getElementById('btn-close-change-pin-modal').addEventListener('click', closeChangePinModal);
  document.getElementById('form-change-pin').addEventListener('submit', handleChangePinSubmit);

  // Toggle View admin vs employee
  document.getElementById('btn-toggle-portal').addEventListener('click', () => {
    if (currentView === 'employee') {
      if (adminPasscode === '') {
        openAdminAuthModal();
      } else {
        switchView('admin');
      }
    } else {
      switchView('employee');
    }
  });

  // Exit Admin Sidebar Button
  document.getElementById('btn-lock-admin').addEventListener('click', () => {
    switchView('employee');
  });

  // Delete Employee button on Admin Individual Attendance view
  const btnDeleteIndiv = document.getElementById('btn-delete-individual-emp');
  if (btnDeleteIndiv) {
    btnDeleteIndiv.addEventListener('click', () => {
      const select = document.getElementById('indiv-employee-select');
      const empId = select ? select.value : '';
      if (!empId) {
        showToast('Please select an employee first.', 'warning');
        return;
      }
      const empName = select.options[select.selectedIndex]?.text || 'Employee';
      handleDeleteEmployee(empId, empName);
    });
  }

  // Tab bindings for Admin panel
  document.querySelectorAll('.sidebar-nav button[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = e.currentTarget.getAttribute('data-tab');
      switchAdminTab(tabId);
    });
  });

  // Admin filter event binds
  document.getElementById('admin-date-filter').addEventListener('change', loadAdminDashboard);
  document.getElementById('admin-log-search').addEventListener('input', (e) => {
    filterAdminLogs(e.target.value);
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', exportLogsToCSV);
  document.getElementById('btn-export-monthly-csv').addEventListener('click', exportMonthlyAttendanceToCSV);
  document.getElementById('btn-export-monthly-pdf').addEventListener('click', exportMonthlyAttendanceToPDF);
  document.getElementById('btn-export-pdf').addEventListener('click', exportAttendanceLogsToPDF);

  // Add Employee Form
  document.getElementById('form-add-employee').addEventListener('submit', handleAddEmployeeSubmit);

  // Settings update form
  document.getElementById('form-settings').addEventListener('submit', handleSettingsSubmit);

  // Employee work record tabs & forms
  document.querySelectorAll('.emp-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchEmployeeTab(btn.getAttribute('data-emp-tab')));
  });
  document.getElementById('emp-work-month').addEventListener('change', loadEmployeeWorkRecords);
  document.getElementById('btn-save-work-profile').addEventListener('click', handleSaveWorkProfile);
  document.getElementById('form-add-work-entry').addEventListener('submit', handleAddWorkEntry);
  
  // Real-time balance calculations for clock-out modal
  document.getElementById('clockout-received').addEventListener('input', () => {
    const dateStr = getLocalDateString();
    updateAutoCalculatedBalance(dateStr);
  });
  document.getElementById('clockout-expense').addEventListener('input', () => {
    const dateStr = getLocalDateString();
    updateAutoCalculatedBalance(dateStr);
  });
  
  // Real-time balance calculations for "Add Daily Entry" form
  document.getElementById('work-entry-date').addEventListener('change', updateWorkEntryBalance);
  document.getElementById('work-entry-payment').addEventListener('input', updateWorkEntryBalance);
  document.getElementById('work-entry-expense').addEventListener('input', updateWorkEntryBalance);
  
  // PDF Exports
  document.getElementById('btn-export-work-pdf').addEventListener('click', () => {
    if (selectedEmployee) {
      const month = document.getElementById('emp-work-month').value;
      exportWorkRecordsToPDF(selectedEmployee.id, month, selectedEmployee.name);
    }
  });
  document.getElementById('btn-export-work-pdf-admin').addEventListener('click', () => {
    const empId = document.getElementById('admin-work-employee').value;
    const month = document.getElementById('admin-work-month').value;
    const empSelect = document.getElementById('admin-work-employee');
    const empName = empSelect.options[empSelect.selectedIndex]?.text || 'Employee';
    if (empId && month) {
      exportWorkRecordsToPDF(empId, month, empName);
    } else {
      showToast('Please select an employee and a month first', 'warning');
    }
  });

  // Admin work records
  document.getElementById('admin-work-employee').addEventListener('change', loadAdminWorkRecords);
  document.getElementById('admin-work-month').addEventListener('change', loadAdminWorkRecords);
  document.getElementById('btn-export-work-csv').addEventListener('click', exportWorkRecordsToCSV);
  document.getElementById('btn-export-all-work-csv').addEventListener('click', exportAllEmployeesWorkRecordsToCSV);
  document.getElementById('admin-work-month').value = getCurrentMonthString();

  // Work Progress dashboard
  document.getElementById('progress-date-filter').addEventListener('change', loadWorkProgress);
  document.getElementById('btn-refresh-progress').addEventListener('click', loadWorkProgress);

  // Leave applications & forms submission
  document.getElementById('form-leave-application').addEventListener('submit', handleLeaveApplicationSubmit);
  document.getElementById('form-add-document').addEventListener('submit', handleAddDocumentSubmit);
  document.getElementById('doc-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file, 800, 800, 0.7, (compressedBase64) => {
      selectedDocumentImageBase64 = compressedBase64;
      document.getElementById('doc-file-preview').src = compressedBase64;
      document.getElementById('doc-file-preview-container').classList.remove('hidden');
    });
  });
  document.getElementById('btn-remove-doc-photo').addEventListener('click', () => {
    resetDocumentUpload();
  });
  document.getElementById('admin-form-employee').addEventListener('change', loadAdminForms);
  document.getElementById('admin-form-type').addEventListener('change', loadAdminForms);
  document.getElementById('btn-export-forms-csv').addEventListener('click', exportFormsToCSV);
  document.getElementById('btn-export-forms-pdf').addEventListener('click', exportFormsToPDF);

  // Initialize Evaluations Tab
  initEvaluationsTab();

  // Initialize Monthly Summary & PDF Batch Upload Tab
  initMonthlySummaryTab();

  // Initialize Individual Person Attendance Tab
  initIndividualAttendanceTab();

  // Initialize Salary Tab
  initSalaryTab();

  // --- COMMENTS / MESSAGES BINDINGS ---
  const btnRefreshEmpComments = document.getElementById('btn-refresh-emp-comments');
  if (btnRefreshEmpComments) {
    btnRefreshEmpComments.addEventListener('click', loadEmployeeComments);
  }

  const formEmpComment = document.getElementById('form-emp-comment');
  if (formEmpComment) {
    formEmpComment.addEventListener('submit', handleEmpCommentSubmit);
  }

  const btnRefreshAdminComments = document.getElementById('btn-refresh-admin-comments');
  if (btnRefreshAdminComments) {
    btnRefreshAdminComments.addEventListener('click', loadAdminComments);
  }

  const formAdminComment = document.getElementById('form-admin-comment');
  if (formAdminComment) {
    formAdminComment.addEventListener('submit', handleAdminCommentSubmit);
  }

  // Camera upload bindings
  document.getElementById('btn-trigger-camera').addEventListener('click', () => {
    document.getElementById('clockout-photo').click();
  });

  document.getElementById('clockout-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    compressImage(file, 500, 500, 0.6, (compressedBase64) => {
      selectedClockOutPhotoBase64 = compressedBase64;
      document.getElementById('photo-preview').src = compressedBase64;
      document.getElementById('photo-preview-container').classList.remove('hidden');
    });
  });

  document.getElementById('btn-remove-photo').addEventListener('click', () => {
    resetClockOutPhoto();
  });

  // Photo view modal bindings
  document.getElementById('btn-close-photo-modal').addEventListener('click', closePhotoModal);

  // Window clicks to close modals on backdrop
  window.addEventListener('click', (e) => {
    const adminModal = document.getElementById('admin-auth-modal');
    const empModal = document.getElementById('employee-auth-modal');
    const pinModal = document.getElementById('change-pin-modal');
    const clockoutModal = document.getElementById('clockout-modal');
    const photoViewModal = document.getElementById('photo-view-modal');
    if (e.target === adminModal) {
      closeAdminAuthModal();
    } else if (e.target === empModal) {
      closeEmployeeAuthModal();
    } else if (e.target === pinModal) {
      closeChangePinModal();
    } else if (e.target === clockoutModal) {
      closeClockOutModal();
    } else if (e.target === photoViewModal) {
      closePhotoModal();
    }
  });
});

// ==========================================================================
// MONTHLY ATTENDANCE SUMMARY & BATCH PDF ANALYSIS ENGINE
// ==========================================================================
let selectedPDFBatchFiles = [];
let parsedPDFTextData = [];
let currentMonthlySummaryResults = null;

function initMonthlySummaryTab() {
  const monthInput = document.getElementById('summary-month-input');
  if (monthInput && !monthInput.value) {
    monthInput.value = getCurrentMonthString();
  }

  const btnTriggerUpload = document.getElementById('btn-trigger-summary-pdf');
  const fileInput = document.getElementById('summary-pdf-upload');
  const dropzone = document.getElementById('pdf-upload-dropzone');
  const btnGenerate = document.getElementById('btn-generate-monthly-summary');
  const btnExportPDF = document.getElementById('btn-export-summary-pdf');
  const btnExportCSV = document.getElementById('btn-export-summary-csv');

  if (btnTriggerUpload && fileInput) {
    btnTriggerUpload.addEventListener('click', () => fileInput.click());
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target !== btnTriggerUpload && !e.target.closest('.btn')) {
        fileInput.click();
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--color-primary)';
      dropzone.style.background = 'rgba(99, 102, 241, 0.08)';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'var(--border-color)';
      dropzone.style.background = 'rgba(255,255,255,0.02)';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border-color)';
      dropzone.style.background = 'rgba(255,255,255,0.02)';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handlePDFFilesSelection(Array.from(e.dataTransfer.files));
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handlePDFFilesSelection(Array.from(e.target.files));
      }
    });
  }

  if (monthInput) {
    monthInput.addEventListener('change', () => {
      loadAndRenderMonthlySummary();
    });
  }

  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => loadAndRenderMonthlySummary());
  }

  if (btnExportPDF) {
    btnExportPDF.addEventListener('click', () => exportMonthlySummaryToPDF());
  }

  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', () => exportMonthlyGridCSV());
  }

  const btnViewGrid = document.getElementById('btn-view-grid-sheet');
  const btnViewOverview = document.getElementById('btn-view-overview-summary');
  const gridContainer = document.getElementById('monthly-grid-sheet-container');
  const overviewContainer = document.getElementById('monthly-overview-container');

  if (btnViewGrid && btnViewOverview && gridContainer && overviewContainer) {
    btnViewGrid.addEventListener('click', () => {
      gridContainer.classList.remove('hidden');
      overviewContainer.classList.add('hidden');
      btnViewGrid.className = 'btn btn-sm btn-primary';
      btnViewOverview.className = 'btn btn-sm btn-secondary';
    });
    btnViewOverview.addEventListener('click', () => {
      overviewContainer.classList.remove('hidden');
      gridContainer.classList.add('hidden');
      btnViewOverview.className = 'btn btn-sm btn-primary';
      btnViewGrid.className = 'btn btn-sm btn-secondary';
    });
  }
}

async function handlePDFFilesSelection(files) {
  const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    showToast('Please select valid PDF files (.pdf)', 'warning');
    return;
  }

  selectedPDFBatchFiles = pdfFiles;
  renderPDFFileListTags();
  showToast(`Loaded ${pdfFiles.length} PDF file(s). Extracting text...`, 'info');
  await extractTextFromPDFs(pdfFiles);
  await loadAndRenderMonthlySummary();
}

function renderPDFFileListTags() {
  const listContainer = document.getElementById('pdf-file-list');
  if (!listContainer) return;

  if (selectedPDFBatchFiles.length === 0) {
    listContainer.innerHTML = '';
    return;
  }

  listContainer.innerHTML = selectedPDFBatchFiles.map((file, idx) => `
    <span class="badge-role" style="background: rgba(99, 102, 241, 0.16); color: var(--color-primary); padding: 0.35rem 0.65rem; border-radius: 6px; font-size: 0.825rem; display: inline-flex; align-items: center; gap: 0.35rem;">
      📄 ${file.name}
      <button type="button" onclick="removeSelectedPDFFile(${idx})" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.9rem; padding: 0; margin-left: 0.25rem;">✕</button>
    </span>
  `).join('');
}

function removeSelectedPDFFile(index) {
  if (index >= 0 && index < selectedPDFBatchFiles.length) {
    selectedPDFBatchFiles.splice(index, 1);
    renderPDFFileListTags();
    loadAndRenderMonthlySummary();
  }
}

async function extractTextFromPDFs(files) {
  parsedPDFTextData = [];
  if (!window.pdfjsLib) {
    console.warn('pdf.js library not loaded yet');
    return;
  }

  for (const file of files) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }

      parsedPDFTextData.push({
        filename: file.name,
        text: fullText
      });
    } catch (err) {
      console.error(`Error reading PDF file ${file.name}:`, err);
    }
  }
}

async function loadAndRenderMonthlySummary() {
  const monthInput = document.getElementById('summary-month-input');
  const startDateInput = document.getElementById('summary-start-date');
  const endDateInput = document.getElementById('summary-end-date');

  const selectedMonth = (monthInput && monthInput.value) ? monthInput.value : getCurrentMonthString();
  const startDate = startDateInput ? startDateInput.value : '';
  const endDate = endDateInput ? endDateInput.value : '';

  const tbody = document.querySelector('#monthly-summary-table tbody');
  
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading and analyzing monthly attendance data...</td></tr>';
  }

  try {
    const res = await API.getMonthlySummary(selectedMonth, startDate, endDate);
    let summaryData = (res && res.summaries) ? res.summaries : [];
    const daysInMonth = res.daysInMonth || 31;
    const daysEvaluated = res.daysEvaluated || 31;

    // Merge text extracted from uploaded PDFs into summary metrics
    if (parsedPDFTextData.length > 0) {
      summaryData = mergePDFTextIntoSummaryData(summaryData, parsedPDFTextData, selectedMonth, daysEvaluated);
    }

    currentMonthlySummaryResults = {
      month: selectedMonth,
      startDate: res.startDate || startDate,
      endDate: res.endDate || endDate,
      daysInMonth,
      daysEvaluated,
      summaries: summaryData
    };

    // Render the Full Day-by-Day Monthly Attendance Sheet Grid Table
    await renderMonthlyGridSheetUI(selectedMonth, startDate, endDate);

    // Update Summary Header Title
    const titleEl = document.getElementById('summary-month-title');
    if (titleEl) {
      const workDays = res.workingDaysToEvaluate || daysEvaluated;
      if (startDate && endDate) {
        titleEl.innerText = `Employee Attendance Summary — Tenure: ${startDate} to ${endDate} (${workDays} Working Days Evaluated)`;
      } else {
        const dateObj = new Date(`${selectedMonth}-01T00:00:00`);
        const monthName = isNaN(dateObj.getTime()) ? selectedMonth : dateObj.toLocaleDateString([], { month: 'long', year: 'numeric' });
        titleEl.innerText = `Monthly Employee Attendance Summary — ${monthName} (${workDays} Working Days Evaluated, Sundays Off)`;
      }
    }

    // Calculate Totals for Stats Grid
    const totalStaffCount = summaryData.length;
    let totalPresentDays = 0;
    let totalMissingDays = 0;
    let totalExpensesSum = 0;

    summaryData.forEach(item => {
      totalPresentDays += item.totalAttendance || 0;
      totalMissingDays += item.missingAttendance || 0;
      totalExpensesSum += item.totalExpensesAdded || 0;
    });

    // Update Stat Cards
    const elStaff = document.getElementById('sum-stat-staff');
    const elPresent = document.getElementById('sum-stat-present');
    const elMissing = document.getElementById('sum-stat-missing');
    const elExpenses = document.getElementById('sum-stat-expenses');

    if (elStaff) elStaff.innerText = totalStaffCount;
    if (elPresent) elPresent.innerText = `${totalPresentDays} Days`;
    if (elMissing) elMissing.innerText = `${totalMissingDays} Days`;
    if (elExpenses) elExpenses.innerText = `PKR ${totalExpensesSum.toLocaleString()}`;

    // Render Summary Table
    if (!tbody) return;
    if (summaryData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No attendance records or staff entries found for the selected month.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    summaryData.forEach((row, idx) => {
      const tr = document.createElement('tr');
      const presentCount = row.totalAttendance || 0;
      const missingCount = row.missingAttendance || 0;
      const evalWorkingDays = row.workingDaysToEvaluate || (row.daysEvaluated || 30);
      const ratePct = evalWorkingDays > 0 ? Math.min(100, Math.round((presentCount / evalWorkingDays) * 100)) : 0;

      let rateClass = 'remarks-complete';
      if (ratePct < 50) rateClass = 'remarks-complications';
      else if (ratePct < 80) rateClass = 'remarks-visit';

      const archivedBadge = row.isArchived ? '<span class="badge-role" style="background: rgba(239, 68, 68, 0.16); color: #f87171; margin-left: 0.4rem; font-size: 0.75rem;">Archived</span>' : '';
      const sundayBadge = row.sundayPresentCount > 0 ? `<span class="badge-role" style="background: rgba(16, 185, 129, 0.16); color: #34d399; margin-left: 0.35rem; font-size: 0.75rem;" title="${row.sundayPresentCount} Sunday(s) worked">+${row.sundayPresentCount} Sun</span>` : '';
      const workDoneText = row.totalWorkDone || (row.totalWorkDoneCount ? `${row.totalWorkDoneCount} Work Items` : '0 Work Items');
      const expenseFmt = (row.totalExpensesAdded || 0).toLocaleString();

      const minusVal = row.minusScore || 0;
      const minusBadge = minusVal < 0 
        ? `<span class="badge-role" style="background: rgba(239, 68, 68, 0.16); color: #f87171; font-weight: 700;">${minusVal}</span>` 
        : `<span style="color: var(--text-muted);">0</span>`;

      tr.innerHTML = `
        <td class="col-sn">${idx + 1}</td>
        <td style="font-weight: 600;">${row.employeeName}${archivedBadge}</td>
        <td><span class="badge-role">${row.role || 'Staff'}</span></td>
        <td style="color: var(--color-success); font-weight: 600;">${presentCount} Days${sundayBadge}</td>
        <td style="color: ${missingCount > 0 ? 'var(--color-danger)' : 'var(--text-muted)'}; font-weight: 600;">${missingCount} Days</td>
        <td title="${row.workDoneSummary || ''}">${workDoneText}</td>
        <td style="font-weight: 600; color: var(--color-primary);">PKR ${expenseFmt}</td>
        <td style="text-align: center;">${minusBadge}</td>
        <td><span class="remarks-badge ${rateClass}">${ratePct}% Present</span></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading monthly summary:', err);
    if (tbody) {
      const msg = err.isOffline
        ? 'You appear to be offline. Please check your connection and try again.'
        : 'Failed to load monthly summary report.';
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty">${msg}</td></tr>`;
    }
    if (err.isOffline) showToast('You are offline. Please reconnect.', 'warning');
  }
}

function mergePDFTextIntoSummaryData(existingSummaries, pdfTextList, selectedMonth, daysEvaluated) {
  const summaryMap = new Map();

  // Initialize from existing DB summary entries
  existingSummaries.forEach(s => {
    const key = s.employeeName.toLowerCase().trim();
    summaryMap.set(key, {
      ...s,
      presentDates: new Set(s.presentDatesList || []),
      leaveDates: new Set(s.leaveDatesList || []),
      workDoneDetails: s.workDoneSummary && s.workDoneSummary !== 'None' ? [s.workDoneSummary] : [],
      totalExpensesAdded: s.totalExpensesAdded || 0
    });
  });

  pdfTextList.forEach(pdf => {
    const text = pdf.text || '';
    const lines = text.split(/\r?\n/);

    lines.forEach(line => {
      const dateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
      if (!dateMatch) return;

      const dateStr = dateMatch[1];
      if (!dateStr.startsWith(selectedMonth)) return;

      summaryMap.forEach((empEntry, nameKey) => {
        const nameParts = nameKey.split(/\s+/).filter(p => p.length >= 3);
        const matchesFull = line.toLowerCase().includes(nameKey);
        const matchesParts = nameParts.length > 1 && nameParts.every(part => line.toLowerCase().includes(part));

        if (matchesFull || matchesParts) {
          const pkrMatch = line.match(/PKR\s*([0-9,]+(?:\.[0-9]{2})?)/i);
          if (pkrMatch) {
            const amt = parseFloat(pkrMatch[1].replace(/,/g, ''));
            if (!isNaN(amt) && amt > 0) {
              if (!empEntry.expensesByDate) empEntry.expensesByDate = new Map();
              if (!empEntry.expensesByDate.has(dateStr)) {
                empEntry.expensesByDate.set(dateStr, amt);
              }
            }
          }
        }
      });
    });
  });

  const [yearStr, mStr] = selectedMonth.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(mStr, 10);

  let sundaysInEvaluatedPeriod = 0;
  for (let d = 1; d <= daysEvaluated; d++) {
    const dt = new Date(year, monthNum - 1, d);
    if (dt.getDay() === 0) sundaysInEvaluatedPeriod++;
  }
  const workingDaysToEvaluate = Math.max(0, daysEvaluated - sundaysInEvaluatedPeriod);

  const results = [];
  summaryMap.forEach(emp => {
    let regularPresentCount = 0;
    let sundayPresentCount = 0;
    emp.presentDates.forEach(dateStr => {
      const parts = dateStr.split('-');
      const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      if (dt.getDay() === 0) sundayPresentCount++;
      else regularPresentCount++;
    });

    let regularLeaveCount = 0;
    emp.leaveDates.forEach(dateStr => {
      const parts = dateStr.split('-');
      const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      if (dt.getDay() !== 0) regularLeaveCount++;
    });

    const totalAttendance = regularPresentCount + sundayPresentCount;
    const leaveDays = regularLeaveCount;
    const missingAttendance = Math.max(0, workingDaysToEvaluate - regularPresentCount - regularLeaveCount);

    let totalExpensesSum = emp.totalExpensesAdded || 0;
    if (emp.expensesByDate && emp.expensesByDate.size > 0) {
      let pdfExpensesSum = 0;
      emp.expensesByDate.forEach(amt => pdfExpensesSum += amt);
      totalExpensesSum = Math.max(totalExpensesSum, pdfExpensesSum);
    }

    results.push({
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      role: emp.role || 'Staff',
      isArchived: Boolean(emp.isArchived),
      daysEvaluated,
      sundaysInEvaluatedPeriod,
      workingDaysToEvaluate,
      totalAttendance,
      sundayPresentCount,
      missingAttendance,
      leaveDays,
      totalWorkDone: emp.presentDates.size > 0 ? `${emp.presentDates.size} Work Days` : '0 Work Items',
      totalWorkDoneCount: emp.presentDates.size,
      workDoneSummary: emp.workDoneDetails && emp.workDoneDetails.length > 0 ? emp.workDoneDetails.slice(0, 3).join('; ') : 'Parsed from PDF/DB',
      totalExpensesAdded: Math.round(totalExpensesSum)
    });
  });

  return results;
}

async function exportMonthlySummaryToPDF() {
  if (!currentMonthlySummaryResults || !currentMonthlySummaryResults.summaries) {
    showToast('Please generate a monthly summary first', 'warning');
    return;
  }

  showToast('Generating Monthly Summary PDF Report...', 'info');
  const monthStr = currentMonthlySummaryResults.month;
  const startDate = currentMonthlySummaryResults.startDate;
  const endDate = currentMonthlySummaryResults.endDate;
  const dateObj = new Date(`${monthStr}-01T00:00:00`);
  const monthDisplay = isNaN(dateObj.getTime()) ? monthStr : dateObj.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const periodSubtitle = (startDate && endDate)
    ? `Tenure Period: <strong>${startDate} to ${endDate}</strong> (${currentMonthlySummaryResults.daysEvaluated} Days Evaluated)`
    : `Month: <strong>${monthDisplay}</strong> (${currentMonthlySummaryResults.daysEvaluated} Days Evaluated)`;

  const printContainer = document.createElement('div');
  printContainer.className = 'pdf-report-wrapper';

  const rowsHtml = currentMonthlySummaryResults.summaries.map((s, idx) => {
    const ratePct = s.daysEvaluated > 0 ? Math.round((s.totalAttendance / s.daysEvaluated) * 100) : 0;
    return `
      <tr>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center;">${idx + 1}</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: bold;">${s.employeeName} ${s.isArchived ? '(Archived)' : ''}</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center;">${s.role || 'Staff'}</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center; color: #059669; font-weight: bold;">${s.totalAttendance} Days</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center; color: #dc2626; font-weight: bold;">${s.missingAttendance} Days</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db;">${s.totalWorkDone || '0 Work Items'}</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: right; font-weight: bold; color: #4f46e5;">PKR ${(s.totalExpensesAdded || 0).toLocaleString()}</td>
        <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center; font-weight: bold;">${ratePct}%</td>
      </tr>
    `;
  }).join('');

  printContainer.innerHTML = `
    <div style="padding: 20px; font-family: 'Inter', sans-serif; color: #111827; background: #ffffff;">
      <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 16px;">
        <h1 style="font-size: 20px; margin: 0; color: #4f46e5; text-transform: uppercase; font-weight: 800;">EMPLOYEE ATTENDANCE & EXPENSE SUMMARY</h1>
        <div style="font-size: 14px; color: #4b5563; margin-top: 4px;">${periodSubtitle}</div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px;">
        <thead>
          <tr style="background-color: #f3f4f6; color: #1f2937;">
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">S.No</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: left;">Employee Name</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Role</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Total Attendance</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Missing Days</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: left;">Total Work Done</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: right;">Expenses Added (PKR)</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Attendance Rate</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div style="margin-top: 24px; font-size: 10px; color: #6b7280; text-align: right;">
        Report Generated: ${new Date().toLocaleString()} | Office Attendance Portal
      </div>
    </div>
  `;

  document.body.appendChild(printContainer);

  if (window.html2pdf) {
    const opt = {
      margin: 8,
      filename: `Monthly_Attendance_Summary_${monthStr}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    try {
      await html2pdf().set(opt).from(printContainer).save();
      showToast('Monthly Summary PDF downloaded successfully!', 'success');
    } catch (err) {
      console.error('PDF export error:', err);
      showToast('Failed to export summary PDF', 'error');
    } finally {
      printContainer.remove();
    }
  } else {
    window.print();
    printContainer.remove();
  }
}

function exportMonthlySummaryToCSV() {
  if (!currentMonthlySummaryResults || !currentMonthlySummaryResults.summaries) {
    showToast('Please generate a monthly summary first', 'warning');
    return;
  }

  const monthStr = currentMonthlySummaryResults.month;
  const headers = ['S.No', 'Employee Name', 'Role', 'Status', 'Total Attendance (Days Present)', 'Missing Attendance (Days Absent)', 'Total Work Done', 'Total Expenses Added (PKR)', 'Attendance Rate (%)'];
  const rows = currentMonthlySummaryResults.summaries.map((s, idx) => {
    const ratePct = s.daysEvaluated > 0 ? Math.round((s.totalAttendance / s.daysEvaluated) * 100) : 0;
    return [
      idx + 1,
      `"${s.employeeName.replace(/"/g, '""')}"`,
      `"${(s.role || 'Staff').replace(/"/g, '""')}"`,
      s.isArchived ? 'Archived' : 'Active',
      s.totalAttendance,
      s.missingAttendance,
      `"${(s.totalWorkDone || '0 Work Items').replace(/"/g, '""')}"`,
      s.totalExpensesAdded || 0,
      `${ratePct}%`
    ];
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Monthly_Attendance_Summary_${monthStr}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('Monthly Summary CSV exported successfully!', 'success');
}

async function exportMonthlyGridCSV(monthStr) {
  const monthInput = document.getElementById('summary-month-input');
  if (!monthStr && monthInput && monthInput.value) {
    monthStr = monthInput.value;
  }
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    monthStr = getCurrentMonthString();
  }

  const [yearStr, mStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(mStr, 10);
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  const monthDate = new Date(year, monthNum - 1, 1);
  const monthAbbr = monthDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const titleMonth = `${monthAbbr}-${year}`;

  let officeName = 'FAST ENGINEERING SOLUTIONS';
  try {
    const s = await API.getSettings();
    if (s && s.officeName) officeName = s.officeName.toUpperCase();
  } catch (e) {}

  showToast('Generating monthly attendance sheet grid CSV...', 'info');

  try {
    const [employees, allLogs] = await Promise.all([
      API.getEmployees(true),
      API.getAttendanceLogs(null)
    ]);

    const monthLogs = (allLogs || []).filter(l => l.date && l.date.startsWith(monthStr));

    const empAttendanceMap = new Map();

    monthLogs.forEach(log => {
      let empId = log.employeeId;
      if (!empId && log.employeeName) {
        const found = (employees || []).find(e => e.name.toLowerCase().trim() === log.employeeName.toLowerCase().trim());
        if (found) empId = found.id;
      }
      if (!empId) return;

      if (!empAttendanceMap.has(empId)) {
        empAttendanceMap.set(empId, {});
      }
      const day = parseInt(log.date.split('-')[2], 10);
      const isLeave = Boolean(log.performanceNotes && String(log.performanceNotes).trim().toUpperCase().startsWith('LEAVE'));
      let status = 'P';
      if (isLeave) status = 'H';
      else if (log.status === 'ABSENT' || log.status === 'A') status = 'A';

      empAttendanceMap.get(empId)[day] = status;
    });

    const activeEmps = (employees || []).filter(e => e.status !== 'DELETED' && !e.isArchived);

    const totalCols = 3 + daysInMonth + 1;
    const csvRows = [];

    // Line 1: FAST ENGINEERING SOLUTIONS,,,,,,ATTENDENCE SHEET-JUN-2026,,,,,,,,,,,,,,,,,,,,,,,,,,,
    const line1 = Array(totalCols).fill('');
    line1[0] = `"${officeName.replace(/"/g, '""')}"`;
    line1[6] = `ATTENDENCE SHEET-${titleMonth}`;
    csvRows.push(line1.join(','));

    // Line 2: SR,NAME,DESIGNATION,1,2,3,4,...,30,TOTAL
    const headers = ['SR', 'NAME', 'DESIGNATION'];
    for (let d = 1; d <= daysInMonth; d++) {
      headers.push(String(d));
    }
    headers.push('TOTAL');
    csvRows.push(headers.join(','));

    const emptyLine = Array(totalCols).fill('').join(',');

    activeEmps.forEach((emp, idx) => {
      const empDays = empAttendanceMap.get(emp.id) || {};
      let presentCount = 0;
      const empRow = [
        idx + 1,
        `"${(emp.name || '').toUpperCase().replace(/"/g, '""')}"`,
        `"${(emp.role || 'STAFF').toUpperCase().replace(/"/g, '""')}"`
      ];

      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, monthNum - 1, d);
        const isSunday = dt.getDay() === 0;
        const st = empDays[d];

        if (st === 'P') {
          empRow.push('P');
          presentCount++;
        } else if (st === 'H') {
          empRow.push('H');
        } else if (st === 'A') {
          empRow.push('A');
        } else if (isSunday) {
          empRow.push('');
        } else {
          empRow.push('');
        }
      }

      empRow.push(presentCount);
      csvRows.push(empRow.join(','));
      csvRows.push(emptyLine);
    });

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `Employees_Attendance_Sheet_${titleMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Monthly Attendance Grid CSV exported for ${titleMonth}!`, 'success');
  } catch (err) {
    console.error('Error exporting grid CSV:', err);
    showToast('Failed to export grid CSV', 'error');
  }
}

function checkAndShowLinkExpiryNotice(employee) {
  if (!employee) return;
  const count = employee.expireCount || employee.linkExpireCount || 0;
  if (employee.justExpired || (count > 0 && !sessionStorage.getItem('seenExpiryNotice_' + employee.id))) {
    const modal = document.getElementById('link-expiry-notice-modal');
    const promptMsg = document.getElementById('link-expiry-prompt-message');
    if (modal && promptMsg) {
      let msg = "⚠️ Notice: 1 point has been deducted because you did not clock out within 24 hours.";
      if (count > 1) {
        msg = `⚠️ Notice: ${count} points have been deducted for late clock-out (${count} times).`;
      }
      promptMsg.innerText = msg;
      modal.classList.remove('hidden');

      const dismissModal = () => {
        modal.classList.add('hidden');
        sessionStorage.setItem('seenExpiryNotice_' + employee.id, 'true');
      };

      const btnClose = document.getElementById('btn-close-link-expiry-modal');
      if (btnClose) {
        btnClose.onclick = dismissModal;
      }
      modal.onclick = (e) => {
        if (e.target === modal) dismissModal();
      };
      // Auto-dismiss after 6s so it never blocks clock actions
      setTimeout(dismissModal, 6000);
    }
    const toastMsg = count === 1 
      ? "⚠️ Notice: -1 point deducted — please remember to clock out on time" 
      : `⚠️ Notice: -${count} points deducted for late clock-out`;
    showToast(toastMsg, 'warning');
  }
}

async function renderMonthlyGridSheetUI(monthStr, startDate, endDate) {
  const thead = document.getElementById('monthly-grid-sheet-thead');
  const tbody = document.getElementById('monthly-grid-sheet-tbody');
  if (!thead || !tbody) return;

  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    monthStr = getCurrentMonthString();
  }

  const [yearStr, mStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(mStr, 10);
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  let headerHtml = '<tr><th style="width: 45px; background: var(--bg-card, #1e293b); color: var(--text-muted); position: sticky; left: 0; z-index: 2;">SR</th><th style="text-align: left; min-width: 160px; background: var(--bg-card, #1e293b); position: sticky; left: 45px; z-index: 2;">NAME</th><th style="text-align: left; min-width: 130px; background: var(--bg-card, #1e293b);">DESIGNATION</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    headerHtml += `<th style="min-width: 32px; padding: 6px 4px; text-align: center;">${d}</th>`;
  }
  headerHtml += '<th style="min-width: 65px; text-align: center;">TOTAL</th></tr>';
  thead.innerHTML = headerHtml;

  tbody.innerHTML = '<tr><td colspan="' + (daysInMonth + 4) + '" class="table-empty">Loading monthly sheet grid...</td></tr>';

  try {
    const [employees, allLogs] = await Promise.all([
      API.getEmployees(true),
      API.getAttendanceLogs(null)
    ]);

    const normalizeName = (name) => String(name || '').trim().toLowerCase();

    const monthLogs = (allLogs || []).filter(l => {
      if (!l.date) return false;
      if (startDate && endDate) return l.date >= startDate && l.date <= endDate;
      return l.date.startsWith(monthStr);
    });

    const empAttendanceMap = new Map();

    monthLogs.forEach(log => {
      const normKey = normalizeName(log.employeeName);
      let matchedEmp = null;
      if (log.employeeId) {
        matchedEmp = (employees || []).find(e => e.id === log.employeeId);
      }
      if (!matchedEmp && normKey) {
        matchedEmp = (employees || []).find(e => normalizeName(e.name) === normKey);
      }
      const key = matchedEmp ? normalizeName(matchedEmp.name) : normKey;
      if (!key) return;

      if (!empAttendanceMap.has(key)) {
        empAttendanceMap.set(key, {});
      }
      const day = parseInt(log.date.split('-')[2], 10);
      const isLeave = Boolean(log.performanceNotes && String(log.performanceNotes).trim().toUpperCase().startsWith('LEAVE'));
      let status = 'P';
      if (isLeave) status = 'H';
      else if (log.status === 'ABSENT' || log.status === 'A') status = 'A';

      empAttendanceMap.get(key)[day] = status;
    });

    // Group active employees by full name identity
    const activeEmpMap = new Map();
    (employees || []).forEach(e => {
      if (e.status !== 'DELETED' && !e.isArchived && e.name && e.name.trim()) {
        const norm = normalizeName(e.name);
        if (!activeEmpMap.has(norm)) {
          activeEmpMap.set(norm, e);
        }
      }
    });

    if (activeEmpMap.size === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (daysInMonth + 4) + '" class="table-empty">No active staff members found for this month.</td></tr>';
      return;
    }

    tbody.innerHTML = '';

    let idx = 0;
    activeEmpMap.forEach((emp, normKey) => {
      idx++;
      const empDays = empAttendanceMap.get(normKey) || {};
      let presentCount = 0;
      let rowHtml = `<tr>
        <td style="font-weight: bold; color: var(--text-muted); background: var(--bg-card, #1e293b); position: sticky; left: 0; z-index: 1;">${idx}</td>
        <td style="text-align: left; font-weight: 600; color: var(--text-color); background: var(--bg-card, #1e293b); position: sticky; left: 45px; z-index: 1;">${(emp.name || '').toUpperCase()}</td>
        <td style="text-align: left; color: var(--text-muted); font-size: 0.8rem;">${(emp.role || 'STAFF').toUpperCase()}</td>`;

      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, monthNum - 1, d);
        const isSunday = dt.getDay() === 0;
        const st = empDays[d];

        if (st === 'P') {
          rowHtml += '<td style="color: #10b981; font-weight: 700; background: rgba(16, 185, 129, 0.08); text-align: center;">P</td>';
          presentCount++;
        } else if (st === 'H') {
          rowHtml += '<td style="color: #f59e0b; font-weight: 700; background: rgba(245, 158, 11, 0.08); text-align: center;">H</td>';
        } else if (st === 'A') {
          rowHtml += '<td style="color: #ef4444; font-weight: 700; background: rgba(239, 68, 68, 0.08); text-align: center;">A</td>';
        } else if (isSunday) {
          rowHtml += '<td style="background: rgba(255, 255, 255, 0.02); text-align: center;"></td>';
        } else {
          rowHtml += '<td style="text-align: center;"></td>';
        }
      }

      rowHtml += `<td style="font-weight: 800; color: var(--color-primary); background: rgba(99, 102, 241, 0.12); text-align: center;">${presentCount}</td></tr>`;

      const spacerHtml = `<tr style="height: 4px;"><td colspan="${daysInMonth + 4}" style="padding:0; border:none; background: transparent;"></td></tr>`;
      tbody.insertAdjacentHTML('beforeend', rowHtml + spacerHtml);
    });

  } catch (err) {
    console.error('Error rendering grid sheet UI:', err);
    tbody.innerHTML = '<tr><td colspan="' + (daysInMonth + 4) + '" class="table-empty">Failed to load attendance grid sheet.</td></tr>';
  }
}


// ==========================================================================
// MESSAGES & COMMENTS SYSTEM
// ==========================================================================

let adminCommentSelectedEmployeeId = null;
let adminCommentSelectedEmployeeName = null;

// ---- EMPLOYEE SIDE --------------------------------------------------------

async function loadEmployeeComments() {
  if (!selectedEmployee) return;
  const feed = document.getElementById('emp-comments-feed');
  if (!feed) return;
  feed.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading...</p>';
  try {
    const data = await API.getComments(selectedEmployee.id);
    const comments = data.comments || data || [];
    if (!comments.length) {
      feed.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;">No messages yet. Send one below!</p>';
      return;
    }
    feed.innerHTML = '';
    comments.forEach(c => {
      feed.insertAdjacentHTML('beforeend', buildCommentBubble(c, false));
    });
    feed.scrollTop = feed.scrollHeight;
    markMessagesAsRead();
  } catch (err) {
    feed.innerHTML = '<p style="color:var(--color-danger);font-size:0.85rem;">Failed to load messages.</p>';
    console.error('loadEmployeeComments error:', err);
  }
}

async function handleEmpCommentSubmit(e) {
  e.preventDefault();
  if (!selectedEmployee) return;
  const input = document.getElementById('emp-comment-input');
  const msg = input.value.trim();
  if (!msg) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await API.addComment({
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      sender: 'employee',
      senderName: selectedEmployee.name,
      message: msg
    });
    input.value = '';
    await loadEmployeeComments();
    showToast('Message sent!', 'success');
  } catch (err) {
    showToast('Failed to send message.', 'error');
    console.error('handleEmpCommentSubmit error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Comment 🚀';
  }
}

// ---- ADMIN SIDE -----------------------------------------------------------

async function loadAdminComments() {
  // Build staff list on the left
  await renderAdminCommentStaffList();
  // If someone was previously selected, reload their thread
  if (adminCommentSelectedEmployeeId) {
    await loadAdminCommentThread(adminCommentSelectedEmployeeId, adminCommentSelectedEmployeeName);
  } else {
    const feed = document.getElementById('admin-comments-feed');
    if (feed) feed.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;">Select a staff member on the left to view their messages.</p>';
  }
}

async function renderAdminCommentStaffList() {
  const list = document.getElementById('admin-comment-staff-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">Loading...</p>';
  try {
    const data = await API.getComments();
    const comments = data.comments || data || [];
    // Group by employeeId
    const empMap = {};
    comments.forEach(c => {
      if (!empMap[c.employeeId]) {
        empMap[c.employeeId] = { name: c.employeeName, count: 0, latest: c.createdAt };
      }
      empMap[c.employeeId].count++;
      if (c.createdAt > empMap[c.employeeId].latest) empMap[c.employeeId].latest = c.createdAt;
    });
    const employees = await API.getEmployees();
    const roster = (employees.employees || employees || []);
    if (!roster.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">No staff found.</p>';
      return;
    }
    list.innerHTML = '';
    roster.forEach(emp => {
      const info = empMap[emp.id];
      const msgCount = info ? info.count : 0;
      const badge = msgCount > 0 ? `<span style="background:var(--color-indigo);color:#fff;font-size:0.72rem;padding:0.1rem 0.45rem;border-radius:12px;font-weight:700;">${msgCount}</span>` : '';
      const isActive = emp.id === adminCommentSelectedEmployeeId;
      const item = document.createElement('div');
      item.className = 'clickable-list-item' + (isActive ? ' active' : '');
      item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.55rem 0.75rem;cursor:pointer;border-radius:8px;transition:background 0.15s;' + (isActive ? 'background:rgba(99,102,241,0.18);' : '');
      item.innerHTML = `<span style="font-weight:600;font-size:0.9rem;">${escapeHtml(emp.name)}</span>${badge}`;
      item.addEventListener('click', () => loadAdminCommentThread(emp.id, emp.name));
      item.addEventListener('mouseenter', () => { if (emp.id !== adminCommentSelectedEmployeeId) item.style.background = 'rgba(255,255,255,0.06)'; });
      item.addEventListener('mouseleave', () => { if (emp.id !== adminCommentSelectedEmployeeId) item.style.background = ''; });
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = '<p style="color:var(--color-danger);font-size:0.85rem;padding:0.5rem;">Failed to load staff.</p>';
    console.error('renderAdminCommentStaffList error:', err);
  }
}

async function loadAdminCommentThread(empId, empName) {
  adminCommentSelectedEmployeeId = empId;
  adminCommentSelectedEmployeeName = empName;

  // Update thread header
  const title = document.getElementById('admin-comment-thread-title');
  const subtitle = document.getElementById('admin-comment-thread-subtitle');
  if (title) title.textContent = `💬 Conversation with ${empName}`;
  if (subtitle) subtitle.textContent = 'All messages between admin and this staff member.';

  // Show the reply form
  const form = document.getElementById('form-admin-comment');
  if (form) form.style.display = 'flex';

  const feed = document.getElementById('admin-comments-feed');
  if (!feed) return;
  feed.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Loading...</p>';

  try {
    const data = await API.getComments(empId);
    const comments = data.comments || data || [];
    if (!comments.length) {
      feed.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;">No messages yet for this employee.</p>';
    } else {
      feed.innerHTML = '';
      comments.forEach(c => {
        feed.insertAdjacentHTML('beforeend', buildCommentBubble(c, true));
      });
      feed.scrollTop = feed.scrollHeight;
    }
  } catch (err) {
    feed.innerHTML = '<p style="color:var(--color-danger);font-size:0.85rem;">Failed to load messages.</p>';
    console.error('loadAdminCommentThread error:', err);
  }

  // Highlight selected in list
  document.querySelectorAll('#admin-comment-staff-list .clickable-list-item').forEach(el => {
    el.style.background = '';
  });
  await renderAdminCommentStaffList();
}

async function handleAdminCommentSubmit(e) {
  e.preventDefault();
  if (!adminCommentSelectedEmployeeId) {
    showToast('Please select a staff member first.', 'warning');
    return;
  }
  const input = document.getElementById('admin-comment-input');
  const msg = input.value.trim();
  if (!msg) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await API.addComment({
      employeeId: adminCommentSelectedEmployeeId,
      employeeName: adminCommentSelectedEmployeeName,
      sender: 'admin',
      senderName: 'Admin',
      message: msg
    });
    input.value = '';
    await loadAdminCommentThread(adminCommentSelectedEmployeeId, adminCommentSelectedEmployeeName);
    showToast('Reply sent!', 'success');
  } catch (err) {
    showToast('Failed to send reply.', 'error');
    console.error('handleAdminCommentSubmit error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Reply 📨';
  }
}

async function handleDeleteComment(commentId) {
  if (!confirm('Delete this message?')) return;
  try {
    await API.deleteComment(commentId);
    showToast('Message deleted.', 'success');
    // Reload whichever side is active
    if (adminCommentSelectedEmployeeId) {
      await loadAdminCommentThread(adminCommentSelectedEmployeeId, adminCommentSelectedEmployeeName);
    } else if (selectedEmployee) {
      await loadEmployeeComments();
    }
  } catch (err) {
    showToast('Failed to delete message.', 'error');
    console.error('handleDeleteComment error:', err);
  }
}

// ---- SHARED HELPERS -------------------------------------------------------

function buildCommentBubble(c, isAdminView) {
  const isAdminSender = c.sender === 'admin';
  const bubbleClass = isAdminSender ? 'comment-bubble-admin' : 'comment-bubble-employee';
  const badgeClass = isAdminSender ? 'badge-sender-admin' : 'badge-sender-employee';
  const label = isAdminSender ? '🛡 Admin' : '👤 ' + escapeHtml(c.senderName || c.employeeName);
  const timeStr = c.createdAt ? new Date(c.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const canDelete = isAdminView; // Only admin can delete from admin view
  const deleteBtn = canDelete
    ? `<div class="comment-actions"><button class="btn-delete-comment" onclick="handleDeleteComment('${escapeHtml(String(c.id))}')">🗑 Delete</button></div>`
    : '';
  const wrapStyle = isAdminSender ? 'align-items:flex-start;' : 'align-items:flex-end;';
  return `
    <div style="display:flex;flex-direction:column;${wrapStyle}">
      <div class="comment-bubble ${bubbleClass}">
        <div class="comment-header">
          <span class="comment-sender-badge ${badgeClass}">${label}</span>
          <span class="comment-time">${timeStr}</span>
        </div>
        <div class="comment-body">${escapeHtml(c.message)}</div>
        ${deleteBtn}
      </div>
    </div>`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ==========================================================================
// INDIVIDUAL PERSON ATTENDANCE & TENURE SEARCH ENGINE
// ==========================================================================
let currentIndividualSummaryData = null;

function initIndividualAttendanceTab() {
  const btnSearch = document.getElementById('btn-search-individual-att');
  const btnExportPDF = document.getElementById('btn-export-individual-pdf');
  const btnExportCSV = document.getElementById('btn-export-individual-csv');

  if (btnSearch) {
    btnSearch.addEventListener('click', () => loadAndRenderIndividualAttendance());
  }

  if (btnExportPDF) {
    btnExportPDF.addEventListener('click', () => exportIndividualAttendanceToPDF());
  }

  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', () => exportIndividualAttendanceToCSV());
  }

  const navLink = document.querySelector('[data-tab="tab-individual-attendance"]');
  if (navLink) {
    navLink.addEventListener('click', () => {
      populateIndividualEmployeeDropdown();
    });
  }
}

async function populateIndividualEmployeeDropdown() {
  const select = document.getElementById('indiv-employee-select');
  if (!select) return;

  try {
    const employees = await API.getEmployees(true);
    const nameMap = new Map();
    (employees || []).forEach(e => {
      if (e.name && e.name.trim()) {
        const norm = e.name.trim().toLowerCase();
        if (!nameMap.has(norm)) {
          nameMap.set(norm, e.name.trim());
        }
      }
    });

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select Employee Identity --</option>';
    nameMap.forEach((displayName) => {
      const opt = document.createElement('option');
      opt.value = displayName;
      opt.textContent = displayName;
      select.appendChild(opt);
    });

    if (currentVal) select.value = currentVal;
  } catch (err) {
    console.error('Failed to populate individual employee dropdown:', err);
  }
}

async function loadAndRenderIndividualAttendance() {
  const select = document.getElementById('indiv-employee-select');
  const startDateInput = document.getElementById('indiv-start-date');
  const endDateInput = document.getElementById('indiv-end-date');
  const tbody = document.getElementById('individual-attendance-tbody');
  const titleEl = document.getElementById('indiv-person-title');

  const empName = select ? select.value : '';
  if (!empName) {
    showToast('Please select an employee identity first', 'warning');
    return;
  }

  const startDate = startDateInput ? startDateInput.value : '';
  const endDate = endDateInput ? endDateInput.value : '';

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading attendance records...</td></tr>';
  }

  try {
    const res = await API.getIndividualAttendance({ employeeName: empName, startDate, endDate });
    if (!res || !res.success) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No records found.</td></tr>';
      return;
    }

    currentIndividualSummaryData = res;

    const elDays = document.getElementById('indiv-stat-days');
    const elPresent = document.getElementById('indiv-stat-present');
    const elAbsent = document.getElementById('indiv-stat-absent');
    const elHours = document.getElementById('indiv-stat-hours');

    if (elDays) elDays.innerText = `${res.daysEvaluated} Days (${res.workingDays} Working)`;
    if (elPresent) elPresent.innerText = `${res.presentDays} Days`;
    if (elAbsent) elAbsent.innerText = `${res.absentDays} Days`;
    if (elHours) elHours.innerText = `${res.totalHours} hrs`;

    if (titleEl) {
      titleEl.innerText = `Attendance Records for ${res.employeeName} (${res.startDate} to ${res.endDate})`;
    }

    if (!tbody) return;
    if (!res.records || res.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No attendance records found for this tenure.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    let rowsHtml = '';
    res.records.forEach(function(r) {
      const inTimeFmt = r.clockInTime ? new Date(r.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
      const rawOutTime = r.clockOutTime ? new Date(r.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
      const outTimeFmt = r.autoClockOut ? (rawOutTime + ' ⚠') : rawOutTime;
      const dur = (typeof r.duration === 'number' && r.duration > 0) ? r.duration : 0;
      const durationFmt = dur > 0 ? (Math.floor(dur / 60) + 'h ' + (dur % 60) + 'm') : (r.clockOutTime ? '0m' : 'Incomplete');

      const notesStr = String(r.performanceNotes || '');
      const isLeave = notesStr.trim().toUpperCase().startsWith('LEAVE');

      let statusBadge;
      if (isLeave) {
        statusBadge = '<span class="badge-role" style="background:rgba(99,102,241,.16);color:#818cf8">Leave</span>';
      } else if (r.autoClockOut) {
        statusBadge = '<span class="badge-role" style="background:rgba(245,158,11,.16);color:#f59e0b" title="Auto clock-out by system — employee did not manually clock out">⚠ Auto Clock-Out</span>';
      } else if (!r.clockOutTime) {
        statusBadge = '<span class="badge-role" style="background:rgba(245,158,11,.16);color:#fbbf24">Clocked In (Unclosed)</span>';
      } else {
        statusBadge = '<span class="badge-role" style="background:rgba(16,185,129,.16);color:#34d399">Present</span>';
      }

      const resolveBtn = (!r.clockOutTime && !isLeave && !r.autoClockOut)
        ? '<button type="button" onclick="promptResolveAttendance(\'' + String(r.id).replace(/'/g, "\\'") + '\')" class="btn btn-sm btn-secondary" style="padding:.2rem .5rem;font-size:.75rem">Complete Clock-Out</button>'
        : '<span style="color:var(--text-muted);font-size:.8rem">-</span>';

      const expense = typeof r.expenseAmount === 'number' ? r.expenseAmount : (parseFloat(r.expenseAmount) || 0);
      const notesSafe = String(r.performanceNotes || '-').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      rowsHtml += '<tr>' +
        '<td style="font-weight:600">' + (r.date || '-') + '</td>' +
        '<td>' + inTimeFmt + '</td>' +
        '<td>' + outTimeFmt + '</td>' +
        '<td>' + durationFmt + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + notesSafe + '</td>' +
        '<td style="font-weight:600;color:var(--color-primary)">PKR ' + expense.toLocaleString() + '</td>' +
        '<td>' + resolveBtn + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = rowsHtml || '<tr><td colspan="8" class="table-empty">No attendance records found for this tenure.</td></tr>';
  } catch (err) {
    console.error('Error loading individual attendance:', err);
    const msg = err && err.message ? err.message : String(err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="table-empty" style="color:#f87171">Error: ' + msg + '</td></tr>';
  }
}

async function promptResolveAttendance(attendanceId) {
  const notes = prompt('Enter performance/work notes for this clock-out (or leave blank):');
  if (notes === null) return;

  const expenseStr = prompt('Enter expense amount in PKR (default 0):', '0');
  const expenseAmount = parseFloat(expenseStr) || 0;

  try {
    showToast('Resolving clock-out record...', 'info');
    await API.resolveAttendance({ attendanceId, clockOutTime: new Date().toISOString(), performanceNotes: notes || 'Resolved by admin', expenseAmount });
    showToast('Attendance record updated and completed!', 'success');
    loadAndRenderIndividualAttendance();
    loadAndRenderMonthlySummary();
  } catch (err) {
    showToast('Failed to resolve attendance: ' + err.message, 'error');
  }
}

async function exportIndividualAttendanceToPDF() {
  if (!currentIndividualSummaryData || !currentIndividualSummaryData.records) {
    showToast('Please search individual employee attendance first', 'warning');
    return;
  }

  const d = currentIndividualSummaryData;
  showToast(`Generating Attendance PDF for ${d.employeeName}...`, 'info');

  const printContainer = document.createElement('div');
  printContainer.className = 'pdf-report-wrapper';

  const rowsHtml = d.records.map((r, idx) => {
    const inTimeFmt = r.clockInTime ? new Date(r.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
    const rawOutFmt = r.clockOutTime ? new Date(r.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
    const outTimeFmt = r.autoClockOut ? (rawOutFmt + ' (Auto)') : rawOutFmt;
    const durationFmt = r.duration ? `${Math.floor(r.duration / 60)}h ${r.duration % 60}m` : (r.clockOutTime ? '0m' : 'Incomplete');

    return `
      <tr>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center;">${idx + 1}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; font-weight: bold;">${r.date}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center;">${inTimeFmt}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center;">${outTimeFmt}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center;">${durationFmt}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db;">${escapeHtml(r.performanceNotes || '-')}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: right; color: #4f46e5;">PKR ${(r.expenseAmount || 0).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  printContainer.innerHTML = `
    <div style="padding: 20px; font-family: 'Inter', sans-serif; color: #111827; background: #ffffff;">
      <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 16px;">
        <h1 style="font-size: 20px; margin: 0; color: #4f46e5; text-transform: uppercase; font-weight: 800;">INDIVIDUAL ATTENDANCE REPORT</h1>
        <div style="font-size: 14px; color: #4b5563; margin-top: 4px;">Employee: <strong>${escapeHtml(d.employeeName)}</strong> | Tenure: <strong>${d.startDate} to ${d.endDate}</strong></div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Present Days: <strong>${d.presentDays}</strong> | Working Days: <strong>${d.workingDays}</strong> | Total Hours: <strong>${d.totalHours} hrs</strong> | Expenses: <strong>PKR ${d.totalExpenses.toLocaleString()}</strong></div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px;">
        <thead>
          <tr style="background-color: #f3f4f6; color: #1f2937;">
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">#</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: left;">Date</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Clock In</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Clock Out</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: center;">Duration</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: left;">Work Notes</th>
            <th style="padding: 7px; border: 1px solid #d1d5db; text-align: right;">Expenses</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div style="margin-top: 24px; font-size: 10px; color: #6b7280; text-align: right;">
        Report Generated: ${new Date().toLocaleString()} | Office Attendance Portal
      </div>
    </div>
  `;

  document.body.appendChild(printContainer);

  if (window.html2pdf) {
    const opt = {
      margin: 8,
      filename: `Attendance_${d.employeeName.replace(/\s+/g, '_')}_${d.startDate}_to_${d.endDate}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    try {
      await html2pdf().set(opt).from(printContainer).save();
      showToast('Individual Attendance PDF downloaded!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export PDF', 'error');
    } finally {
      printContainer.remove();
    }
  } else {
    window.print();
    printContainer.remove();
  }
}

function exportIndividualAttendanceToCSV() {
  if (!currentIndividualSummaryData || !currentIndividualSummaryData.records) {
    showToast('Please search individual employee attendance first', 'warning');
    return;
  }
  const d = currentIndividualSummaryData;
  const headers = ['S.No', 'Date', 'Clock In', 'Clock Out', 'Duration', 'Work Notes', 'Expenses (PKR)'];
  const rows = d.records.map((r, idx) => {
    const inTimeFmt = r.clockInTime ? new Date(r.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
    const outTimeFmt = r.clockOutTime ? new Date(r.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
    const durationFmt = r.duration ? `${Math.floor(r.duration / 60)}h ${r.duration % 60}m` : '-';
    return [
      idx + 1,
      r.date,
      `"${inTimeFmt}"`,
      `"${outTimeFmt}"`,
      `"${durationFmt}"`,
      `"${(r.performanceNotes || '').replace(/"/g, '""')}"`,
      r.expenseAmount || 0
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Attendance_${d.employeeName.replace(/\s+/g, '_')}_${d.startDate}_to_${d.endDate}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// ==========================================================================
// ADMIN MESSAGE NOTIFICATION POLLING (EMPLOYEE PORTAL)
// ==========================================================================
let _msgPollInterval = null;
let _lastUnreadCount = 0;

function startMessageNotificationPolling(employeeId) {
  stopMessageNotificationPolling();
  _lastUnreadCount = 0;
  // Immediate first check
  checkAndShowMessageNotification(employeeId);
  // Then every 30 seconds
  _msgPollInterval = setInterval(function() {
    checkAndShowMessageNotification(employeeId);
  }, 30000);
}

function stopMessageNotificationPolling() {
  if (_msgPollInterval) {
    clearInterval(_msgPollInterval);
    _msgPollInterval = null;
  }
  _lastUnreadCount = 0;
  clearMessageBadge();
}

async function checkAndShowMessageNotification(employeeId) {
  try {
    const res = await API.getUnreadMessages(employeeId);
    const count = (res && typeof res.count === 'number') ? res.count : 0;
    if (count > 0) {
      showMessageBadge(count);
      if (count > _lastUnreadCount) {
        // New messages since last check — show toast
        showToast('\uD83D\uDCE9 You have ' + count + ' new message' + (count > 1 ? 's' : '') + ' from Admin!', 'info');
        // Also fire a browser push notification if permitted
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification('📩 New Message from Admin', {
              body: 'You have ' + count + ' new message' + (count > 1 ? 's' : '') + '. Open the app to read.',
              icon: '/icon.svg',
              tag: 'admin-msg-' + employeeId
            });
          } catch (ne) { /* ignore notification errors */ }
        }
      }
    } else {
      clearMessageBadge();
    }
    _lastUnreadCount = count;
  } catch (e) {
    // Silently ignore polling errors
  }
}

function showMessageBadge(count) {
  const btn = document.querySelector('[data-emp-tab="emp-pane-comments"]');
  if (!btn) return;
  let badge = btn.querySelector('.msg-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'msg-badge';
    btn.style.position = 'relative';
    btn.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
}

function clearMessageBadge() {
  const btn = document.querySelector('[data-emp-tab="emp-pane-comments"]');
  if (!btn) return;
  const badge = btn.querySelector('.msg-badge');
  if (badge) badge.remove();
}

async function markMessagesAsRead() {
  if (!selectedEmployee) return;
  try {
    await API.markMessagesRead(selectedEmployee.id);
    _lastUnreadCount = 0;
    clearMessageBadge();
  } catch (e) {
    // ignore
  }
}

// ==========================================================================
// BROWSER NOTIFICATION PERMISSION
// ==========================================================================
function requestBrowserNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    // Delay slightly so user sees the app first
    setTimeout(() => {
      Notification.requestPermission().catch(() => {});
    }, 2000);
  }
}

// ==========================================================================
// ==========================================================================
// SALARY SHEET SYSTEM & ACCOUNTS PDF VERIFICATION
// ==========================================================================
let currentSalaryMonth = '';
let currentAccountsPdf = null;
let currentSalaryEmployees = [];
let isReplacingAccountsPdf = false;

function initSalaryTab() {
  // Set default month to current month
  const picker = document.getElementById('salary-month-picker');
  if (picker) {
    const now = new Date();
    picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    picker.addEventListener('change', () => {
      unsavedSalaryEdits.clear();
      loadSalarySheet(picker.value, true);
    });
  }

  const btnLoad = document.getElementById('btn-load-salary-sheet');
  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      unsavedSalaryEdits.clear();
      loadSalarySheet(null, true);
    });
  }

  const btnGenerateAll = document.getElementById('btn-generate-all-salaries');
  if (btnGenerateAll) btnGenerateAll.addEventListener('click', handleGenerateAllSalaries);

  const btnPrint = document.getElementById('btn-print-salary-sheet');
  if (btnPrint) btnPrint.addEventListener('click', printSalarySheet);

  const btnExportCsv = document.getElementById('btn-export-salary-csv');
  if (btnExportCsv) btnExportCsv.addEventListener('click', () => exportSalarySheetCSV());

  // Accounts PDF Handlers
  const btnTriggerUpload = document.getElementById('btn-upload-accounts-pdf');
  const fileInput = document.getElementById('accounts-pdf-file-input');
  const uploadZone = document.getElementById('accounts-pdf-upload-zone');

  if (btnTriggerUpload && fileInput) {
    btnTriggerUpload.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!adminPasscode) {
        showToast('You do not have permission to upload Accounts PDFs. Please unlock Admin mode first.', 'warning');
        openAdminAuthModal();
        return;
      }
      isReplacingAccountsPdf = false;
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', (e) => {
      if (e.target !== btnTriggerUpload && !e.target.closest('#btn-upload-accounts-pdf')) {
        if (!adminPasscode) {
          showToast('You do not have permission to upload Accounts PDFs. Please unlock Admin mode first.', 'warning');
          openAdminAuthModal();
          return;
        }
        isReplacingAccountsPdf = false;
        fileInput.value = '';
        fileInput.click();
      }
    });

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--color-indigo)';
      uploadZone.style.background = 'rgba(99,102,241,0.12)';
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.borderColor = 'rgba(99,102,241,0.4)';
      uploadZone.style.background = 'rgba(99,102,241,0.04)';
    });
    uploadZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'rgba(99,102,241,0.4)';
      uploadZone.style.background = 'rgba(99,102,241,0.04)';
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) {
        const chkAppend = document.getElementById('chk-append-pdf');
        const shouldAppend = chkAppend ? chkAppend.checked : false;
        for (let i = 0; i < files.length; i++) {
          const isFirst = (i === 0);
          const replace = isFirst ? !shouldAppend : false;
          await handleAccountsPdfUpload(files[i], replace);
        }
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) {
        const chkAppend = document.getElementById('chk-append-pdf');
        const shouldAppend = chkAppend ? chkAppend.checked : false;
        for (let i = 0; i < files.length; i++) {
          const isFirst = (i === 0);
          const replace = isFirst ? (isReplacingAccountsPdf ? true : !shouldAppend) : false;
          await handleAccountsPdfUpload(files[i], replace);
        }
      }
    });
  }

  // View PDF
  const btnViewPdf = document.getElementById('btn-view-accounts-pdf');
  if (btnViewPdf) {
    btnViewPdf.addEventListener('click', () => openAccountsPdfViewer(currentSalaryMonth));
  }

  // Replace PDF
  const btnReplacePdf = document.getElementById('btn-replace-accounts-pdf');
  const modalReplaceConfirm = document.getElementById('modal-replace-pdf-confirm');
  const btnCancelReplace = document.getElementById('btn-cancel-replace-pdf');
  const btnProceedReplace = document.getElementById('btn-proceed-replace-pdf');

  if (btnReplacePdf && modalReplaceConfirm) {
    btnReplacePdf.addEventListener('click', () => {
      const replaceText = document.getElementById('replace-pdf-confirm-text');
      if (replaceText) {
        replaceText.textContent = `Replace the existing Accounts PDF for ${currentSalaryMonth}? Uploading a new PDF will re-verify all expenses for this month.`;
      }
      modalReplaceConfirm.classList.remove('hidden');
    });
  }
  if (btnCancelReplace && modalReplaceConfirm) {
    btnCancelReplace.addEventListener('click', () => modalReplaceConfirm.classList.add('hidden'));
  }
  if (btnProceedReplace && modalReplaceConfirm && fileInput) {
    btnProceedReplace.addEventListener('click', () => {
      modalReplaceConfirm.classList.add('hidden');
      isReplacingAccountsPdf = true;
      fileInput.click();
    });
  }

  // Re-verify
  const btnReverify = document.getElementById('btn-reverify-accounts-pdf');
  if (btnReverify) {
    btnReverify.addEventListener('click', handleReverifyAccountsPdf);
  }

  // Remove PDF
  const btnRemove = document.getElementById('btn-remove-accounts-pdf');
  if (btnRemove) {
    btnRemove.addEventListener('click', handleDeleteAccountsPdf);
  }

  // Discrepancy Detail Modal close
  const btnCloseDisc = document.getElementById('btn-close-disc-modal');
  const modalDisc = document.getElementById('modal-discrepancy-detail');
  if (btnCloseDisc && modalDisc) {
    btnCloseDisc.addEventListener('click', () => modalDisc.classList.add('hidden'));
    modalDisc.addEventListener('click', (e) => {
      if (e.target === modalDisc) modalDisc.classList.add('hidden');
    });
  }

  // PDF Viewer Modal close
  const btnCloseViewer = document.getElementById('btn-close-pdf-viewer-modal');
  const modalViewer = document.getElementById('modal-accounts-pdf-viewer');
  if (btnCloseViewer && modalViewer) {
    btnCloseViewer.addEventListener('click', () => {
      modalViewer.classList.add('hidden');
      const iframe = document.getElementById('accounts-pdf-iframe');
      if (iframe) iframe.src = '';
    });
    modalViewer.addEventListener('click', (e) => {
      if (e.target === modalViewer) {
        modalViewer.classList.add('hidden');
        const iframe = document.getElementById('accounts-pdf-iframe');
        if (iframe) iframe.src = '';
      }
    });
  }

  // Manual Mapping button in Discrepancy modal
  const btnSaveMap = document.getElementById('btn-save-manual-map');
  if (btnSaveMap) {
    btnSaveMap.addEventListener('click', handleSaveManualMapping);
  }

  // Salary Approval Modal close & actions
  const btnCloseAppr = document.getElementById('btn-close-sal-appr-modal');
  const btnCancelAppr = document.getElementById('btn-cancel-sal-appr');
  const btnRevokeAppr = document.getElementById('btn-sal-appr-revoke');
  const modalAppr = document.getElementById('modal-salary-approval');

  if (btnCloseAppr && modalAppr) {
    btnCloseAppr.addEventListener('click', () => modalAppr.classList.add('hidden'));
  }
  if (btnCancelAppr && modalAppr) {
    btnCancelAppr.addEventListener('click', () => modalAppr.classList.add('hidden'));
  }
  if (btnRevokeAppr) {
    btnRevokeAppr.addEventListener('click', handleRevokeSalaryApproval);
  }
  if (modalAppr) {
    modalAppr.addEventListener('click', (e) => {
      if (e.target === modalAppr) modalAppr.classList.add('hidden');
    });
  }
}

// Local state tracking for unsaved salary sheet edits
// Key: `${empId}_${field}` -> { empId, field, value, updatedAt }
const unsavedSalaryEdits = new Map();

function markSalaryFieldDirty(empId, field, value) {
  unsavedSalaryEdits.set(`${empId}_${field}`, { empId, field, value, updatedAt: Date.now() });
}

function clearSalaryFieldDirty(empId, field) {
  unsavedSalaryEdits.delete(`${empId}_${field}`);
}

function clearEmployeeSalaryDirty(empId) {
  for (const key of unsavedSalaryEdits.keys()) {
    if (key.startsWith(`${empId}_`)) {
      unsavedSalaryEdits.delete(key);
    }
  }
}

function hasUnsavedSalaryEdits() {
  return unsavedSalaryEdits.size > 0;
}

window.hasUnsavedSalaryEdits = hasUnsavedSalaryEdits;

// Prevent accidental page unload while editing salary sheet
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedSalaryEdits()) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes in the Salary Sheet. Are you sure you want to leave?';
    return e.returnValue;
  }
});

// Real-time summary cards accumulator across current rows in DOM
function updateSalarySummaryCards() {
  const tbody = document.getElementById('salary-table-body');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr[id^="sal-row-"]');
  let totalEmployees = rows.length;
  let totalNet = 0;
  let totalExp = 0;

  rows.forEach(tr => {
    const netCell = tr.querySelector('.cell-net');
    if (netCell) {
      const numStr = netCell.textContent.replace(/[^0-9.-]/g, '');
      const val = parseFloat(numStr);
      if (!isNaN(val)) totalNet += val;
    }
    const expCell = tr.querySelector('.cell-expenses');
    if (expCell) {
      const claimedStrong = expCell.querySelector('strong');
      const text = claimedStrong ? claimedStrong.textContent : expCell.textContent;
      const m = text.match(/PKR\s*([\d,]+(?:\.\d+)?)/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val)) totalExp += val;
      }
    }
  });

  const salTotalEl = document.getElementById('sal-stat-total');
  const salPayEl = document.getElementById('sal-stat-payable');
  const salExpEl = document.getElementById('sal-stat-expenses');
  if (salTotalEl) salTotalEl.textContent = totalEmployees;
  if (salPayEl) salPayEl.textContent = 'PKR ' + Math.round(totalNet).toLocaleString();
  if (salExpEl) salExpEl.textContent = 'PKR ' + Math.round(totalExp).toLocaleString();
}

window.updateSalarySummaryCards = updateSalarySummaryCards;

async function loadSalarySheet(monthOverride, force = false) {
  const picker = document.getElementById('salary-month-picker');
  const month = monthOverride || (picker ? picker.value : '') || getCurrentMonthString();
  if (!month) { showToast('Please select a month first.', 'warning'); return; }

  // Prevent automatic reload while admin is actively editing values
  if (!force && hasUnsavedSalaryEdits()) {
    console.warn('loadSalarySheet reload blocked: admin has unsaved edits in salary sheet.');
    return;
  }
  unsavedSalaryEdits.clear();
  currentSalaryMonth = month;

  const tbody = document.getElementById('salary-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="17" class="table-empty">Loading salary and verification data...</td></tr>';

  // Update header info
  const orgNameEl = document.getElementById('salary-sheet-org-name');
  if (orgNameEl) orgNameEl.textContent = (settings && settings.officeName) || 'Company Name';
  const periodEl = document.getElementById('salary-sheet-period');
  if (periodEl) {
    const [yr, mo] = month.split('-');
    const monthName = new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    periodEl.textContent = `SALARY SHEET — ${monthName.toUpperCase()}`;
  }
  const dateEl = document.getElementById('salary-sheet-date');
  if (dateEl) dateEl.textContent = `Generated: ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`;
  const statMonth = document.getElementById('sal-stat-month');
  if (statMonth) statMonth.textContent = month;

  try {
    // Fetch finalized report, employees, Accounts PDF, salary approvals, and expense verifications in parallel
    const [finalizedRes, empRes, salRes, accPdfRes, apprRes, expVerRes] = await Promise.all([
      API.getFinalizedSalaryReport(month).catch(() => null),
      API.getEmployees(),
      API.getSalaries(month),
      API.getAccountsPdf(month).catch(() => ({ success: false, accountsPdf: null })),
      API.getSalaryApprovals(month).catch(() => ({ success: false, approvals: [] })),
      API.getExpenseVerifications(month).catch(() => ({ success: false, verifications: [] }))
    ]);

    const report = finalizedRes && finalizedRes.report;
    window.currentFinalizedSalaryReport = report;

    const employees = (report && report.employees) ? report.employees : (empRes.employees || empRes || []);
    currentSalaryEmployees = employees;
    const salaries = (salRes && salRes.salaries) ? salRes.salaries : [];
    currentAccountsPdf = (accPdfRes && accPdfRes.accountsPdf) ? accPdfRes.accountsPdf : null;
    const approvalsList = (apprRes && apprRes.approvals) ? apprRes.approvals : [];
    const approvalsMap = {};
    approvalsList.forEach(a => { approvalsMap[a.employeeId] = a; });

    const expVerList = (expVerRes && expVerRes.verifications) ? expVerRes.verifications : [];
    const expVerMap = {};
    expVerList.forEach(v => { expVerMap[v.employeeId] = v; });
    currentExpenseVerifications = expVerMap;

    // Render the Accounts PDF Verification Panel
    renderAccountsPdfPanel(currentAccountsPdf);

    // Build salary map & verification map
    const salMap = {};
    salaries.forEach(s => { salMap[s.employeeId] = s; });

    const verifMap = {};
    if (currentAccountsPdf && currentAccountsPdf.verificationResults) {
      currentAccountsPdf.verificationResults.forEach(v => {
        verifMap[v.employeeId] = v;
      });
    }

    if (!employees.length) {
      tbody.innerHTML = '<tr><td colspan="17" class="table-empty">No employees found in roster.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    let totalPayable = 0;
    let totalExpenses = 0;

    employees.forEach((emp, idx) => {
      const sal = salMap[emp.id] || {};
      const basicSalary = emp.basicSalary !== undefined ? emp.basicSalary : (sal.basicSalary || 0);
      const regularDays = emp.regularPresentDays !== undefined ? emp.regularPresentDays : (sal.regularPresentDays !== undefined ? sal.regularPresentDays : (sal.presentDays || 0));
      const sundayDays = emp.sundayPresentDays !== undefined ? emp.sundayPresentDays : (sal.sundayPresentDays !== undefined ? sal.sundayPresentDays : 0);
      const isManual = Boolean(emp.isManualPresentDays);
      const autoDays = emp.autoPresentDays !== undefined ? emp.autoPresentDays : (regularDays + sundayDays);
      const currentPresentDays = emp.presentDays !== undefined ? emp.presentDays : autoDays;
      const editedBy = emp.editedBy || 'Admin';
      const editedAt = emp.editedAt || '';
      const totalPresentDays = currentPresentDays;

      // Per day = Math.round(basic / 30)
      const perDay = emp.perDaySalary !== undefined ? emp.perDaySalary : (basicSalary > 0 ? Math.round(basicSalary / 30) : 0);
      const regularEarned = emp.regularEarned !== undefined ? emp.regularEarned : (perDay * regularDays);
      const isManualSunday = Boolean(emp.isManualSundayBonus);
      const autoSundayBonus = emp.autoSundayBonus !== undefined ? emp.autoSundayBonus : (perDay * sundayDays);
      const currentSundayBonus = emp.sundayBonus !== undefined ? emp.sundayBonus : autoSundayBonus;
      const sundayEditedBy = emp.sundayBonusEditedBy || (emp.sundayBonusAudit && emp.sundayBonusAudit.editedBy) || 'Admin';
      const sundayEditedAt = emp.sundayBonusEditedAt || (emp.sundayBonusAudit && emp.sundayBonusAudit.editedAt) || '';
      const sundayBonus = currentSundayBonus;
      const earnedSalary = emp.earnedSalary !== undefined ? emp.earnedSalary : (regularEarned + sundayBonus);
      const expenses = emp.totalExpenses !== undefined ? emp.totalExpenses : (sal.totalExpenses !== undefined ? sal.totalExpenses : 0);
      const itemizedExpenses = emp.itemizedExpenses || [];

      // Expense Verification & Senior Admin Approval integration
      const expVer = expVerMap[emp.id];
      const isExpVerified = emp.isExpVerified !== undefined ? emp.isExpVerified : Boolean(expVer && (expVer.verificationStatus === 'VERIFIED' || (expVer.verifiedAmount !== null && expVer.verifiedAmount !== undefined)));
      const isExpApproved = emp.isExpApproved !== undefined ? emp.isExpApproved : Boolean(expVer && (expVer.approvalStatus === 'APPROVED' || (expVer.approvedAmount !== null && expVer.approvedAmount !== undefined)));

      let effectiveExpense = expenses;
      if (emp.effectiveExpense !== undefined) {
        effectiveExpense = emp.effectiveExpense;
      } else if (isExpApproved && expVer && typeof expVer.approvedAmount === 'number') {
        effectiveExpense = expVer.approvedAmount;
      } else if (isExpVerified && expVer && typeof expVer.verifiedAmount === 'number') {
        effectiveExpense = expVer.verifiedAmount;
      }

      const netSalary = emp.netSalary !== undefined ? emp.netSalary : (earnedSalary - effectiveExpense);

      if (typeof netSalary === 'number') totalPayable += netSalary;
      if (typeof effectiveExpense === 'number') totalExpenses += effectiveExpense;

      const netClass = typeof netSalary === 'number' ? (netSalary >= 0 ? 'net-salary-positive' : 'net-salary-negative') : '';
      const fmtNum = (v) => typeof v === 'number' ? v.toLocaleString() : (v !== null && v !== undefined ? v : '—');

      // Accounts PDF Verification & Admin Approval columns
      const verif = verifMap[emp.id];
      const approval = (verif && verif.approval) || approvalsMap[emp.id];
      const isApproved = emp.salaryApprovalStatus === 'APPROVED' || Boolean(approval && approval.approvalStatus === 'APPROVED');

      let pdfExpHtml = '<span class="verif-none">—</span>';
      let diffHtml = '<span class="verif-none">—</span>';
      let statusHtml = '<span class="verif-none">—</span>';
      let approvalHtml = '<span class="verif-none">—</span>';

      let bankCreditsNum = '';
      if (emp.bankCredits !== undefined && emp.bankStatus) {
        bankCreditsNum = emp.bankCredits;
        pdfExpHtml = `<span style="font-family:monospace; color:#6ee7b7; font-weight:600;">PKR ${fmtNum(emp.bankCredits)}</span>`;
        const diffVal = emp.bankDifference !== undefined ? emp.bankDifference : Math.abs(emp.bankCredits - netSalary);
        const diffColor = Math.abs(diffVal) < 1.0 ? '#4ade80' : '#fbbf24';
        diffHtml = `<span style="font-family:monospace; color:${diffColor}; font-weight:700;">PKR ${fmtNum(diffVal)}</span>`;

        if (emp.bankStatus === 'MATCHED' || emp.bankStatus === 'MATCHED_ZERO') {
          statusHtml = `<span class="verif-badge verif-matched clickable" onclick="openDiscrepancyModal('${emp.id}')" title="Click to view full breakdown">✓ MATCHED</span>`;
        } else if (emp.bankStatus === 'MISMATCH') {
          statusHtml = `<span class="verif-badge verif-discrepancy clickable" onclick="openDiscrepancyModal('${emp.id}')" title="Click to view discrepancy details">⚠ MISMATCH</span>`;
        } else if (emp.bankStatus === 'NOT_IN_PDF') {
          statusHtml = `<span class="verif-badge verif-notfound clickable" onclick="openDiscrepancyModal('${emp.id}')" title="No qualifying transactions in PDF">? NOT IN PDF</span>`;
        } else {
          statusHtml = '<span class="verif-none">—</span>';
        }
      } else if (currentAccountsPdf) {
        if (verif && (verif.isFoundInPdf || verif.includedTransactionsCount > 0)) {
          const bankCredits = verif.bankCreditTotal !== undefined ? verif.bankCreditTotal : (verif.pdfExpense || 0);
          bankCreditsNum = bankCredits;
          pdfExpHtml = `<span style="font-family:monospace; color:#6ee7b7; font-weight:600;">PKR ${fmtNum(bankCredits)}</span>`;
          const diffVal = verif.difference !== undefined ? verif.difference : Math.abs(bankCredits - netSalary);
          const diffColor = Math.abs(diffVal) < 1.0 ? '#4ade80' : '#fbbf24';
          const diffDir = verif.differenceDirection || (bankCredits > netSalary ? 'Bank > Application' : (netSalary > bankCredits ? 'Application > Bank' : 'Equal'));
          const diffPrefix = diffDir === 'Bank > Application' ? '+B ' : (diffDir === 'Application > Bank' ? '+A ' : '');
          diffHtml = `<span style="font-family:monospace; color:${diffColor}; font-weight:700;" title="${diffDir}">${diffPrefix}PKR ${fmtNum(diffVal)}</span>`;

          if (verif.verificationStatus === 'VERIFIED / MATCHED' || verif.status === 'MATCHED' || verif.status === 'MATCHED_ZERO') {
            statusHtml = `<span class="verif-badge verif-matched clickable" onclick="openDiscrepancyModal('${emp.id}')" title="Click to view full breakdown">✓ MATCHED</span>`;
          } else if (verif.verificationStatus === 'MISMATCH' || verif.status === 'DISCREPANCY') {
            statusHtml = `<span class="verif-badge verif-discrepancy clickable" onclick="openDiscrepancyModal('${emp.id}')" title="Click to view discrepancy details">⚠ MISMATCH</span>`;
          } else {
            statusHtml = `<span class="verif-badge verif-notfound clickable" onclick="openDiscrepancyModal('${emp.id}')" title="View details">? ${escapeHtml(verif.verificationStatus || 'REVIEW')}</span>`;
          }
        } else {
          pdfExpHtml = '<span style="font-family:monospace; color:var(--text-muted);">PKR 0</span>';
          if (netSalary > 0) {
            diffHtml = `<span style="font-family:monospace; color:#f87171; font-weight:700;">+A PKR ${fmtNum(netSalary)}</span>`;
            statusHtml = `<span class="verif-badge verif-notfound clickable" onclick="openDiscrepancyModal('${emp.id}')" title="No qualifying transactions in PDF">? NOT IN PDF</span>`;
          } else {
            diffHtml = '<span style="font-family:monospace; color:#4ade80;">PKR 0</span>';
            statusHtml = `<span class="verif-badge verif-matched clickable" onclick="openDiscrepancyModal('${emp.id}')" title="Zero net salary">✓ MATCHED (0)</span>`;
          }
        }
      }

      const displayApprAmt = (emp.approvedAmount !== null && emp.approvedAmount !== undefined) ? emp.approvedAmount : ((approval && approval.approvedAmount !== undefined) ? approval.approvedAmount : netSalary);
      if (isApproved) {
        approvalHtml = `
          <button type="button" class="btn btn-sm" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-size:0.75rem; font-weight:700; padding:0.25rem 0.55rem; border-radius:4px; cursor:pointer;"
            onclick="openSalaryApprovalModal('${emp.id}')" title="Approved PKR ${fmtNum(displayApprAmt)}">
            ✅ PKR ${fmtNum(displayApprAmt)}
          </button>
        `;
      } else {
        approvalHtml = `
          <button type="button" class="btn btn-sm" style="background:#10b981; color:#fff; font-size:0.75rem; font-weight:600; padding:0.25rem 0.55rem; border-radius:4px; border:none; cursor:pointer;"
            onclick="openSalaryApprovalModal('${emp.id}')" title="Review & Approve Salary for ${escapeHtml(emp.name)}">
            🛡️ Approve
          </button>
        `;
      }

      // Expense Section Action Buttons
      let verifyBtnHtml = '';
      const verifiedDisplayAmt = emp.verifiedAmount !== null && emp.verifiedAmount !== undefined ? emp.verifiedAmount : (expVer && expVer.verifiedAmount);
      if (isExpVerified) {
        verifyBtnHtml = `
          <button type="button" class="btn btn-sm" style="background:rgba(59,130,246,0.18); color:#60a5fa; border:1px solid rgba(59,130,246,0.5); font-size:0.72rem; font-weight:700; padding:0.22rem 0.45rem; border-radius:4px; cursor:pointer; white-space:nowrap;"
            onclick="openExpenseVerifyModal('${emp.id}')" title="Verified by ${escapeHtml((expVer && expVer.verifiedBy) || emp.verifiedBy || 'Admin 1')}: PKR ${fmtNum(verifiedDisplayAmt)}">
            ✓ Ver: ${fmtNum(verifiedDisplayAmt)}
          </button>
        `;
      } else {
        verifyBtnHtml = `
          <button type="button" class="btn btn-sm" style="background:#3b82f6; color:#fff; font-size:0.72rem; font-weight:600; padding:0.22rem 0.45rem; border-radius:4px; border:none; cursor:pointer; white-space:nowrap;"
            onclick="openExpenseVerifyModal('${emp.id}')" title="Admin 1: Verify Claimed Expense">
            🔍 Verify
          </button>
        `;
      }

      let approveBtnHtml = '';
      const approvedDisplayAmt = emp.approvedAmount !== null && emp.approvedAmount !== undefined ? emp.approvedAmount : (expVer && expVer.approvedAmount);
      if (isExpApproved) {
        approveBtnHtml = `
          <button type="button" class="btn btn-sm" style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.5); font-size:0.72rem; font-weight:700; padding:0.22rem 0.45rem; border-radius:4px; cursor:pointer; white-space:nowrap;"
            onclick="openExpenseApproveModal('${emp.id}')" title="Approved by ${escapeHtml((expVer && expVer.approvedBy) || emp.approvedBy || 'Senior Admin')}: PKR ${fmtNum(approvedDisplayAmt)}">
            ✅ Appr: ${fmtNum(approvedDisplayAmt)}
          </button>
        `;
      } else {
        approveBtnHtml = `
          <button type="button" class="btn btn-sm" style="background:#10b981; color:#fff; font-size:0.72rem; font-weight:600; padding:0.22rem 0.45rem; border-radius:4px; border:none; cursor:pointer; white-space:nowrap;"
            onclick="openExpenseApproveModal('${emp.id}')" title="Senior Admin: Approve Expense">
            🛡️ Approve
          </button>
        `;
      }

      const expenseCellHtml = `
        <td class="cell-expenses" style="min-width:180px; padding:6px 8px; vertical-align:middle;">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem;">
              <span style="color:var(--text-muted); font-size:0.74rem;">Claimed:</span>
              ${expenses > 0 ? `
                <strong class="clickable" onclick="openExpenseVerifyModal('${emp.id}')" title="Click to view itemized entries (${itemizedExpenses.length} items)" style="font-family:monospace; color:#f87171; cursor:pointer; text-decoration:underline dotted;">
                  PKR ${fmtNum(expenses)} <span style="font-size:0.72rem; color:var(--text-muted);">(${itemizedExpenses.length})</span>
                </strong>
              ` : `
                <span style="font-family:monospace; color:#94a3b8; font-weight:600;">PKR 0 (Nil)</span>
              `}
            </div>
            <div style="display:flex; gap:4px; align-items:center;">
              ${verifyBtnHtml}
              ${approveBtnHtml}
            </div>
          </div>
        </td>
      `;

      const bankCreditsCellHtml = `
        <td style="text-align:right; background:rgba(99,102,241,0.04); min-width:130px; padding:6px 8px;">
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
            ${pdfExpHtml}
            <button type="button" onclick="openCreditHistoryModal('${emp.id}')"
              style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; text-decoration:underline; cursor:pointer; padding:0;"
              title="View all-time credits across all months (June, July, August, etc.)">
              📜 All Credits
            </button>
          </div>
        </td>
      `;

      const tr = document.createElement('tr');
      tr.id = `sal-row-${emp.id}`;
      tr.dataset.empid = emp.id;
      tr.innerHTML = `
        <td style="text-align:center; color:var(--text-muted);">${idx + 1}</td>
        <td style="font-weight:600; white-space:nowrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>${escapeHtml(emp.name)}</span>
            <button type="button" class="btn-delete-emp-sal"
              onclick="handleDeleteEmployee('${emp.id}', '${escapeHtml(emp.name)}')"
              title="Delete ${escapeHtml(emp.name)}"
              style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.4); border-radius:4px; padding:2px 7px; font-size:0.75rem; font-weight:600; cursor:pointer; flex-shrink:0;">
              🗑️ Delete
            </button>
          </div>
        </td>
        <td style="color:var(--text-secondary); font-size:0.85rem;">${escapeHtml(emp.role || 'Staff')}</td>
        <td>
          <div style="display:flex; gap:0.35rem; align-items:center;">
            <input type="number" class="salary-basic-input" data-empid="${emp.id}" data-month="${month}"
              data-regular="${regularDays}" data-sunday="${sundayDays}" data-expenses="${effectiveExpense}" data-present="${currentPresentDays}"
              value="${basicSalary > 0 ? basicSalary : ''}" placeholder="Enter Basic" min="0" />
            <button type="button" class="salary-save-btn btn-save-basic" data-empid="${emp.id}" data-month="${month}"
              onclick="handleSetBasicSalary(this)">Save</button>
          </div>
        </td>
        <td style="text-align:center;">30</td>
        <td class="cell-present-days" style="text-align:center; min-width:140px; padding:6px 4px; vertical-align:middle;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:3px;">
            <div style="display:flex; align-items:center; gap:4px;">
              <input type="number" class="salary-present-input" 
                data-empid="${emp.id}" data-month="${month}" data-auto="${autoDays}" data-sunday="${sundayDays}"
                value="${currentPresentDays}" min="0" max="31" step="1"
                style="width:52px; text-align:center; font-weight:700; font-size:0.9rem; padding:2px 4px; border-radius:5px; background:rgba(0,0,0,0.5); color:#22c55e; border:1px solid rgba(34,197,94,0.4);" />
              <button type="button" class="salary-save-btn btn-save-present" 
                data-empid="${emp.id}" data-month="${month}"
                onclick="handleSavePresentDays('${emp.id}', '${month}', this)"
                style="padding:3px 7px; font-size:0.75rem; font-weight:600; border-radius:4px; background:#10b981; color:#fff; border:none; cursor:pointer;"
                title="Save manual Present Days">💾 Save</button>
            </div>
            <div class="present-badge-container" style="display:flex; align-items:center; gap:4px; font-size:0.72rem;">
              ${isManual ? `
                <span class="badge-manual" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 5px; font-weight:600;" title="Edited by ${escapeHtml(editedBy)} ${editedAt ? 'on ' + new Date(editedAt).toLocaleDateString() : ''}">✏️ Manual</span>
                <button type="button" class="btn-reset-present" 
                  onclick="handleResetPresentDays('${emp.id}', '${month}', this)"
                  style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; cursor:pointer; text-decoration:underline; padding:0;"
                  title="Reset to auto-calculated attendance (${autoDays} days)">↺ Reset</button>
              ` : `
                <span class="badge-auto" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:4px; padding:1px 5px; font-weight:500;">🤖 Auto</span>
              `}
            </div>
          </div>
        </td>
        <td class="cell-perday" style="text-align:right; font-family:monospace;">${fmtNum(perDay)}</td>
        <td class="cell-regular-earned" style="text-align:right; font-family:monospace; color:#a5b4fc;">${fmtNum(regularEarned)}</td>
        <td class="cell-sunday-bonus" style="text-align:center; min-width:145px; padding:6px 4px; vertical-align:middle;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:3px;">
            <div style="display:flex; align-items:center; gap:4px;">
              <input type="number" class="salary-sunday-input" 
                data-empid="${emp.id}" data-month="${month}" data-auto="${autoSundayBonus}"
                value="${currentSundayBonus !== undefined && currentSundayBonus !== null ? currentSundayBonus : 0}" min="0" step="100"
                style="width:64px; text-align:center; font-weight:700; font-size:0.85rem; padding:2px 4px; border-radius:5px; background:rgba(0,0,0,0.5); color:#fbbf24; border:1px solid rgba(251,191,36,0.4);" />
              <button type="button" class="salary-save-btn btn-save-sunday" 
                data-empid="${emp.id}" data-month="${month}"
                onclick="handleSaveSundayBonus('${emp.id}', '${month}', this)"
                style="padding:3px 7px; font-size:0.75rem; font-weight:600; border-radius:4px; background:#f59e0b; color:#fff; border:none; cursor:pointer;"
                title="Save manual Sunday Bonus">💾 Save</button>
            </div>
            <div class="sunday-badge-container" style="display:flex; align-items:center; gap:4px; font-size:0.72rem;">
              ${isManualSunday ? `
                <span class="badge-manual" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 5px; font-weight:600;" title="Edited by ${escapeHtml(sundayEditedBy)} ${sundayEditedAt ? 'on ' + new Date(sundayEditedAt).toLocaleDateString() : ''}">✏️ Manual</span>
                <button type="button" class="btn-reset-sunday" 
                  onclick="handleResetSundayBonus('${emp.id}', '${month}', this)"
                  style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; cursor:pointer; text-decoration:underline; padding:0;"
                  title="Reset to auto-calculated Sunday bonus (${autoSundayBonus})">↺ Reset</button>
              ` : `
                <span class="badge-auto" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:4px; padding:1px 5px; font-weight:500;">🤖 Auto</span>
              `}
            </div>
          </div>
        </td>
        <td class="cell-earned" style="text-align:right; font-family:monospace; color:#c4b5fd; font-weight:600;">${fmtNum(earnedSalary)}</td>
        ${expenseCellHtml}
        <td class="cell-net ${netClass}" style="text-align:right; font-family:monospace;">${fmtNum(netSalary)}</td>
        <!-- Verification & Approval Columns -->
        ${bankCreditsCellHtml}
        <td class="cell-bank-diff" data-bankcredits="${typeof bankCreditsNum === 'number' ? bankCreditsNum : ''}" style="text-align:right; background:rgba(99,102,241,0.04);">${diffHtml}</td>
        <td class="cell-bank-status" style="text-align:center; background:rgba(99,102,241,0.04);">${statusHtml}</td>
        <td class="cell-sal-approval" style="text-align:center; background:rgba(16,185,129,0.04);">${approvalHtml}</td>
        <td class="no-print" style="white-space:nowrap; text-align:center;">
          <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
            <button type="button" class="salary-generate-btn" onclick="handleGenerateSingleSalary('${emp.id}', '${month}')"
              title="Recalculate from attendance">⚡ Recalc</button>
            <button type="button" class="btn btn-sm btn-delete-emp-action"
              style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.4); font-size:0.75rem; font-weight:600; padding:0.25rem 0.55rem; border-radius:4px; cursor:pointer;"
              onclick="handleDeleteEmployee('${emp.id}', '${escapeHtml(emp.name)}')"
              title="Delete ${escapeHtml(emp.name)}">🗑️ Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      // Real-time live input listener for basic salary typing (NO auto-save or table reload on change/blur)
      const basicInput = tr.querySelector('.salary-basic-input');
      const basicSaveBtn = tr.querySelector('.btn-save-basic');
      if (basicInput) {
        basicInput.addEventListener('input', (e) => {
          markSalaryFieldDirty(emp.id, 'basic', e.target.value);
          updateRowSalaryLive(tr, e.target.value);
        });
        basicInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (basicSaveBtn) basicSaveBtn.click();
          }
        });
      }

      // Real-time live input listener for present days typing
      const presentInput = tr.querySelector('.salary-present-input');
      const presentSaveBtn = tr.querySelector('.btn-save-present');
      if (presentInput) {
        presentInput.addEventListener('input', (e) => {
          markSalaryFieldDirty(emp.id, 'present', e.target.value);
          updateRowSalaryLive(tr);
        });
        presentInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (presentSaveBtn) presentSaveBtn.click();
          }
        });
      }

      // Real-time live input listener for sunday bonus typing
      const sundayInput = tr.querySelector('.salary-sunday-input');
      const sundaySaveBtn = tr.querySelector('.btn-save-sunday');
      if (sundayInput) {
        sundayInput.addEventListener('input', (e) => {
          markSalaryFieldDirty(emp.id, 'sunday', e.target.value);
          updateRowSalaryLive(tr);
        });
        sundayInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (sundaySaveBtn) sundaySaveBtn.click();
          }
        });
      }
    });

    // Update stat cards
    const salTotalEl = document.getElementById('sal-stat-total');
    const salPayEl = document.getElementById('sal-stat-payable');
    const salExpEl = document.getElementById('sal-stat-expenses');
    if (report && report.summary) {
      if (salTotalEl) salTotalEl.textContent = report.summary.totalEmployees;
      if (salPayEl) salPayEl.textContent = 'PKR ' + (report.summary.totalNetSalary || 0).toLocaleString();
      if (salExpEl) salExpEl.textContent = 'PKR ' + (report.summary.totalEffectiveExpenses || 0).toLocaleString();
    } else {
      if (salTotalEl) salTotalEl.textContent = employees.length;
      if (salPayEl) salPayEl.textContent = 'PKR ' + totalPayable.toLocaleString();
      if (salExpEl) salExpEl.textContent = 'PKR ' + totalExpenses.toLocaleString();
    }

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="16" class="table-empty" style="color:var(--color-danger);">Failed to load salary data.</td></tr>';
    console.error('loadSalarySheet error:', err);
  }
}

// Render Accounts PDF Panel & Summary Cards
function renderAccountsPdfPanel(pdf) {
  const uploadZone = document.getElementById('accounts-pdf-upload-zone');
  const idleContent = document.getElementById('accounts-pdf-idle-content');
  const progressBox = document.getElementById('accounts-pdf-upload-progress');
  const activeView = document.getElementById('accounts-pdf-active-view');
  const badgeContainer = document.getElementById('accounts-pdf-status-badge');
  const pdfListContainer = document.getElementById('accounts-pdf-files-list');

  if (!pdf || (!pdf.pdfData && (!pdf.pdfs || pdf.pdfs.length === 0))) {
    if (uploadZone) uploadZone.style.display = 'block';
    if (idleContent) idleContent.style.display = 'block';
    if (progressBox) progressBox.style.display = 'none';
    if (activeView) activeView.style.display = 'none';
    if (badgeContainer) {
      badgeContainer.innerHTML = '<span class="status-indicator" style="background:rgba(148,163,184,0.15); color:#94a3b8; border:1px solid rgba(148,163,184,0.3); font-size:0.78rem;">No PDF Uploaded</span>';
    }
    return;
  }

  // Keep upload area visible so admin can attach more PDFs for the same month!
  if (uploadZone) uploadZone.style.display = 'block';
  if (idleContent) idleContent.style.display = 'block';
  if (progressBox) progressBox.style.display = 'none';
  if (activeView) activeView.style.display = 'block';

  // Render Attached PDFs list
  const pdfFiles = Array.isArray(pdf.pdfs) && pdf.pdfs.length > 0 ? pdf.pdfs : [{
    id: pdf.id || 'pdf_legacy',
    fileName: pdf.fileName || 'Bank_Statement.pdf',
    fileSize: pdf.fileSize || 0,
    uploadedAt: pdf.uploadedAt,
    uploadedBy: pdf.uploadedBy || 'Admin',
    bankName: pdf.bankName || 'Bank Statement',
    transactionCount: (pdf.extractedData || []).length
  }];

  if (pdfListContainer) {
    let listHtml = '<div style="display:flex; flex-direction:column; gap:0.6rem; margin-bottom:1rem;">';
    pdfFiles.forEach(fileItem => {
      const sizeMb = fileItem.fileSize ? (fileItem.fileSize / (1024 * 1024)).toFixed(2) + ' MB' : '';
      const txCnt = fileItem.transactionCount || (fileItem.extractedEntries ? fileItem.extractedEntries.length : 0);
      const fileDate = fileItem.uploadedAt ? new Date(fileItem.uploadedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
      listHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; padding:0.65rem 0.85rem; background:rgba(0,0,0,0.3); border:1px solid var(--border-color); border-radius:8px;">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span style="font-size:1.2rem;">📑</span>
            <div>
              <div style="font-weight:600; font-size:0.88rem; color:#fff;">${escapeHtml(fileItem.fileName)} <span style="font-size:0.72rem; padding:0.1rem 0.4rem; background:rgba(99,102,241,0.2); color:#a5b4fc; border-radius:4px; margin-left:0.4rem;">${escapeHtml(fileItem.bankName || 'Bank Statement')}</span></div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${sizeMb ? sizeMb + ' • ' : ''}${txCnt} transactions parsed • Uploaded: ${fileDate}</div>
            </div>
          </div>
          <div style="display:flex; gap:0.4rem;">
            <button type="button" onclick="viewAccountsPdfViewerModal()" class="btn btn-secondary" style="padding:0.25rem 0.65rem; font-size:0.78rem;">👁️ View PDF</button>
            <button type="button" onclick="removeAccountsPdfFile('${fileItem.id}')" class="btn btn-danger" style="padding:0.25rem 0.65rem; font-size:0.78rem;">🗑️ Delete File</button>
          </div>
        </div>
      `;
    });
    listHtml += '</div>';
    pdfListContainer.innerHTML = listHtml;
  }

  // Summary Metrics
  const summary = pdf.summary || {};
  const matchedEl = document.getElementById('acc-stat-matched');
  if (matchedEl) matchedEl.textContent = summary.totalMatched || 0;

  const discEl = document.getElementById('acc-stat-discrepancies');
  if (discEl) discEl.textContent = summary.totalDiscrepancies || 0;

  const notFoundEl = document.getElementById('acc-stat-notfound');
  if (notFoundEl) notFoundEl.textContent = summary.totalNotFound || 0;

  const appTotalEl = document.getElementById('acc-stat-app-total');
  if (appTotalEl) appTotalEl.textContent = 'PKR ' + (summary.totalAppSalaries || summary.totalAppExpenses || 0).toLocaleString();

  const pdfTotalEl = document.getElementById('acc-stat-pdf-total');
  if (pdfTotalEl) pdfTotalEl.textContent = 'PKR ' + (summary.totalBankCredits || summary.totalPdfExpenses || 0).toLocaleString();

  const diffTotalEl = document.getElementById('acc-stat-diff-total');
  if (diffTotalEl) diffTotalEl.textContent = 'PKR ' + (summary.totalDifference || 0).toLocaleString();

  // Badge Status
  if (badgeContainer) {
    if (summary.totalDiscrepancies > 0) {
      badgeContainer.innerHTML = `<span class="status-indicator" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.4); font-size:0.78rem; font-weight:600;">⚠ ${summary.totalDiscrepancies} Discrepanc${summary.totalDiscrepancies > 1 ? 'ies' : 'y'} (${pdfFiles.length} PDF${pdfFiles.length > 1 ? 's' : ''})</span>`;
    } else {
      badgeContainer.innerHTML = `<span class="status-indicator" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-size:0.78rem; font-weight:600;">✓ Verified (${pdfFiles.length} PDF${pdfFiles.length > 1 ? 's' : ''} Attached)</span>`;
    }
  }
}

// Browser-side PDF Text Extraction via PDF.js for 100x Faster & Lightweight Uploads
async function extractPdfTextInBrowser(file) {
  if (!window.pdfjsLib) return null;
  try {
    const extractionPromise = (async () => {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true
      });
      const pdfDoc = await loadingTask.promise;
      const numPages = Math.min(pdfDoc.numPages || 1, 40);
      const pages = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent({ disableCombineTextItems: false });
        
        const lineMap = new Map();
        textContent.items.forEach(item => {
          if (!item.str || !item.str.trim()) return;
          const y = Math.round((item.transform[5] || 0) * 100) / 100;
          const x = Math.round((item.transform[4] || 0) * 100) / 100;
          let foundY = null;
          for (const existingY of lineMap.keys()) {
            if (Math.abs(existingY - y) <= 3.0) {
              foundY = existingY;
              break;
            }
          }
          const targetY = foundY !== null ? foundY : y;
          if (!lineMap.has(targetY)) lineMap.set(targetY, []);
          lineMap.get(targetY).push({ str: item.str, x, y: targetY });
        });

        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        const lines = sortedY.map(yVal => {
          const items = lineMap.get(yVal).sort((a, b) => a.x - b.x);
          const lineText = items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
          return { y: yVal, text: lineText, items };
        }).filter(l => l.text.length > 0);

        pages.push({ pageNumber: i, lines });
      }

      const rawText = pages.flatMap(p => p.lines.map(l => l.text)).join('\n');
      return { numPages, pages, rawText, fileSize: file.size };
    })();

    // 3.5s timeout: if browser worker is slow or stalls, fall back cleanly to server parsing
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 3500));
    return await Promise.race([extractionPromise, timeoutPromise]);
  } catch (e) {
    console.warn('Browser PDF text extraction skipped, using direct upload:', e);
    return null;
  }
}

// Upload Accounts PDF
async function handleAccountsPdfUpload(file, replace = false) {
  if (!file) return;

  if (!adminPasscode) {
    adminPasscode = getAdminPasscode();
  }

  if (!currentSalaryMonth) {
    showToast('Please select a salary month first.', 'warning');
    return;
  }

  // 1. File Type Validation: accept only PDFs
  const isPdf = (file.type === 'application/pdf') || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    showToast('Please select a PDF file.', 'warning');
    return;
  }

  // 2. File Size Validation (35MB max)
  const MAX_FILE_SIZE_MB = 35;
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed PDF size is ${MAX_FILE_SIZE_MB}MB.`, 'error');
    return;
  }

  // 3. UI State: Show uploading state in drop zone
  const idleContent = document.getElementById('accounts-pdf-idle-content');
  const progressBox = document.getElementById('accounts-pdf-upload-progress');
  const filenameEl = document.getElementById('accounts-pdf-upload-filename');
  const statusEl = document.getElementById('accounts-pdf-upload-status');
  const iconEl = document.getElementById('accounts-pdf-upload-icon');

  if (idleContent) idleContent.style.display = 'none';
  if (progressBox) progressBox.style.display = 'block';
  if (filenameEl) filenameEl.textContent = file.name;
  if (iconEl) iconEl.textContent = '⚡';
  if (statusEl) {
    statusEl.innerHTML = `
      <span class="spinner" style="display:inline-block; width:13px; height:13px; border:2px solid rgba(129,140,248,0.3); border-top-color:#818cf8; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:5px;"></span>
      Processing Bank Statement Quickly...
    `;
  }

  showToast(`⚡ Reading ${file.name}...`, 'info');

  try {
    const extractedText = await extractPdfTextInBrowser(file);
    const payload = {
      month: currentSalaryMonth,
      fileName: file.name,
      replace
    };

    if (extractedText) {
      payload.extractedText = extractedText;
    } else {
      const base64Data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      payload.pdfBase64 = base64Data;
    }

    if (statusEl) {
      statusEl.innerHTML = `
        <span style="color:#34d399; font-weight:600;">✓ Extracted</span> • 
        <span style="color:#818cf8;">Matching employee bank credits...</span>
      `;
    }
    if (iconEl) iconEl.textContent = '🔍';

    const res = await API.uploadAccountsPdf(payload);

    if (res && res.success) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#34d399; font-weight:700;">✓ Bank Statement Verified!</span>`;
      }
      if (iconEl) iconEl.textContent = '✅';
      showToast('✅ Bank Statement uploaded & expenses verified!', 'success');

      // Instantly render the returned accountsPdf into the UI panel!
      if (res.accountsPdf) {
        currentAccountsPdf = res.accountsPdf;
        renderAccountsPdfPanel(res.accountsPdf);
      }

      // Refresh full salary sheet
      await loadSalarySheet(currentSalaryMonth);
    } else {
      const errMsg = (res && res.error) || 'Failed to process Accounts PDF';
      showToast(errMsg, 'error');
      if (idleContent) idleContent.style.display = 'block';
    }
  } catch (err) {
    if (err.message && err.message.includes('Unauthorized')) {
      showToast('Please verify admin passcode.', 'warning');
      openAdminAuthModal();
    } else {
      showToast('Upload note: ' + err.message, 'error');
    }
    if (idleContent) idleContent.style.display = 'block';
    if (progressBox) progressBox.style.display = 'none';
  }
}

// Re-verify Accounts PDF
async function handleReverifyAccountsPdf() {
  if (!adminPasscode) {
    showToast('Please authenticate as Admin first.', 'warning');
    openAdminAuthModal();
    return;
  }
  if (!currentSalaryMonth) return;
  showToast('Re-verifying against latest attendance records...', 'info');
  try {
    const res = await API.reverifyAccountsPdf(currentSalaryMonth);
    if (res && res.success) {
      showToast('✅ Verification updated!', 'success');
      await loadSalarySheet(currentSalaryMonth);
    } else {
      showToast((res && res.error) || 'Failed to reverify', 'error');
    }
  } catch (err) {
    if (err.message && err.message.includes('Unauthorized')) {
      showToast('Admin session expired. Please unlock Admin mode again.', 'error');
      openAdminAuthModal();
    } else {
      showToast('Error reverifying: ' + err.message, 'error');
    }
  }
}

// Delete Accounts PDF
async function handleDeleteAccountsPdf() {
  if (!adminPasscode) {
    showToast('Please authenticate as Admin first.', 'warning');
    openAdminAuthModal();
    return;
  }
  if (!currentSalaryMonth) return;
  if (!confirm(`Are you sure you want to remove the Accounts PDF for ${currentSalaryMonth}?\n\nThis will clear the verification columns for this month. (Your employee attendance and salaries will NOT be affected).`)) {
    return;
  }

  showToast('Removing Accounts PDF...', 'info');
  try {
    const res = await API.deleteAccountsPdf(currentSalaryMonth);
    if (res && res.success) {
      showToast('Accounts PDF removed.', 'success');
      await loadSalarySheet(currentSalaryMonth);
    } else {
      showToast((res && res.error) || 'Failed to remove', 'error');
    }
  } catch (err) {
    if (err.message && err.message.includes('Unauthorized')) {
      showToast('Admin session expired. Please unlock Admin mode again.', 'error');
      openAdminAuthModal();
    } else {
      showToast('Error removing: ' + err.message, 'error');
    }
  }
}

// Remove single accounts PDF file
async function removeAccountsPdfFile(pdfId) {
  if (!adminPasscode) {
    showToast('Please authenticate as Admin first.', 'warning');
    openAdminAuthModal();
    return;
  }
  if (!currentSalaryMonth || !pdfId) return;
  if (!confirm(`Are you sure you want to remove this attached PDF file?`)) {
    return;
  }

  showToast('Removing attached PDF file...', 'info');
  try {
    const res = await API.deleteAccountsPdfFile(currentSalaryMonth, pdfId);
    if (res && res.success) {
      showToast('Attached PDF file removed.', 'success');
      await loadSalarySheet(currentSalaryMonth);
    } else {
      showToast((res && res.error) || 'Failed to remove file', 'error');
    }
  } catch (err) {
    if (err.message && err.message.includes('Unauthorized')) {
      showToast('Admin session expired. Please unlock Admin mode again.', 'error');
      openAdminAuthModal();
    } else {
      showToast('Error removing file: ' + err.message, 'error');
    }
  }
}

// Table Scroll Helpers for Laptop/Desktop layout navigation
function scrollTableLeft(containerId) {
  const el = document.getElementById(containerId);
  if (el) {
    el.scrollBy({ left: -450, behavior: 'smooth' });
  }
}

function scrollTableRight(containerId) {
  const el = document.getElementById(containerId);
  if (el) {
    el.scrollBy({ left: 450, behavior: 'smooth' });
  }
}

// Global Horizontal Wheel Scroll Listener for Laptop Touchpad & Mouse Users
document.addEventListener('wheel', (e) => {
  const scrollTarget = e.target.closest('#salary-table-wrapper, #monthly-grid-sheet-container, .table-container, .work-record-table-wrap');
  if (scrollTarget) {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      scrollTarget.scrollLeft += e.deltaX;
    } else if (e.shiftKey && e.deltaY !== 0) {
      scrollTarget.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }
}, { passive: false });

window.removeAccountsPdfFile = removeAccountsPdfFile;
window.scrollTableLeft = scrollTableLeft;
window.scrollTableRight = scrollTableRight;

// Open In-Browser PDF Viewer Modal for a specific file or default PDF
function viewAccountsPdfViewerModal(pdfId = null) {
  if (!currentAccountsPdf) {
    showToast('No PDF data available to preview.', 'warning');
    return;
  }

  const modal = document.getElementById('modal-accounts-pdf-viewer');
  const iframe = document.getElementById('accounts-pdf-iframe');
  const titleEl = document.getElementById('pdf-viewer-title');
  const subtitleEl = document.getElementById('pdf-viewer-subtitle');
  const downloadBtn = document.getElementById('btn-download-accounts-pdf');

  let targetPdf = null;
  if (pdfId && currentAccountsPdf.pdfs && Array.isArray(currentAccountsPdf.pdfs)) {
    targetPdf = currentAccountsPdf.pdfs.find(p => p.id === pdfId);
  }
  if (!targetPdf) {
    if (currentAccountsPdf.pdfs && currentAccountsPdf.pdfs.length > 0) {
      targetPdf = currentAccountsPdf.pdfs[0];
    } else {
      targetPdf = currentAccountsPdf;
    }
  }

  const fileName = (targetPdf && targetPdf.fileName) || currentAccountsPdf.fileName || 'Bank_Statement.pdf';
  const pdfBase64 = (targetPdf && targetPdf.pdfData) || currentAccountsPdf.pdfData || '';

  if (titleEl) titleEl.textContent = `Bank Statement: ${fileName}`;
  if (subtitleEl) subtitleEl.textContent = `Month: ${currentSalaryMonth} • Bank: ${(targetPdf && targetPdf.bankName) || 'Bank Statement'} • Uploaded By: ${(targetPdf && targetPdf.uploadedBy) || currentAccountsPdf.uploadedBy || 'Admin'}`;

  if (pdfBase64) {
    const pdfDataUrl = 'data:application/pdf;base64,' + pdfBase64;
    if (iframe) iframe.src = pdfDataUrl;
    if (downloadBtn) {
      downloadBtn.href = pdfDataUrl;
      downloadBtn.download = fileName;
      downloadBtn.style.display = 'inline-flex';
    }
  } else if (targetPdf && targetPdf.id) {
    if (iframe) iframe.src = `/api/salary/accounts-pdf/view?month=${encodeURIComponent(currentSalaryMonth)}&pdfId=${encodeURIComponent(targetPdf.id)}`;
    if (downloadBtn) {
      downloadBtn.href = `/api/salary/accounts-pdf/file-data?month=${encodeURIComponent(currentSalaryMonth)}&pdfId=${encodeURIComponent(targetPdf.id)}`;
      downloadBtn.download = fileName;
      downloadBtn.style.display = 'inline-flex';
    }
  } else {
    showToast('PDF base64 data not cached. Uploaded text extracted cleanly.', 'info');
  }

  if (modal) modal.classList.remove('hidden');
}

function openAccountsPdfViewer(month) {
  viewAccountsPdfViewerModal();
}

window.viewAccountsPdfViewerModal = viewAccountsPdfViewerModal;
window.openAccountsPdfViewer = openAccountsPdfViewer;

// Open Discrepancy & Verification Detail Modal
let currentSelectedEmployeeIdForMapping = null;

async function openDiscrepancyModal(employeeId) {
  const emp = (currentSalaryEmployees || []).find(e => e.id === employeeId);
  if (!emp) return;

  const verifResults = (currentAccountsPdf && currentAccountsPdf.verificationResults) || [];
  const verif = verifResults.find(v => v.employeeId === employeeId) || {
    appExpense: 0,
    pdfExpense: 0,
    bankCreditTotal: 0,
    applicationTotal: 0,
    difference: 0,
    differenceDirection: 'Equal',
    status: 'NOT_FOUND',
    verificationStatus: 'NOT VERIFIED',
    pdfEntries: [],
    appEntries: [],
    bankTransactions: [],
    includedTransactionsCount: 0
  };

  currentSelectedEmployeeIdForMapping = employeeId;

  const modal = document.getElementById('modal-discrepancy-detail');
  const empInfoEl = document.getElementById('disc-modal-emp-info');
  const appTotalEl = document.getElementById('disc-modal-app-total');
  const pdfTotalEl = document.getElementById('disc-modal-pdf-total');
  const diffEl = document.getElementById('disc-modal-diff');
  const statusBadgeEl = document.getElementById('disc-modal-status-badge');
  const appListEl = document.getElementById('disc-modal-app-list');
  const pdfListEl = document.getElementById('disc-modal-pdf-list');
  const appCountEl = document.getElementById('disc-modal-app-count');
  const pdfCountEl = document.getElementById('disc-modal-pdf-count');
  const unmatchedSelect = document.getElementById('disc-modal-unmatched-select');

  if (empInfoEl) {
    empInfoEl.textContent = `Employee: ${emp.name} (${emp.role || 'Staff'}) • Month: ${currentSalaryMonth}`;
  }

  const appTotal = verif.applicationTotal !== undefined ? verif.applicationTotal : (verif.appExpense || 0);
  const bankTotal = verif.bankCreditTotal !== undefined ? verif.bankCreditTotal : (verif.pdfExpense || 0);
  const diff = verif.difference !== undefined ? verif.difference : Math.abs(bankTotal - appTotal);

  if (appTotalEl) appTotalEl.textContent = 'PKR ' + appTotal.toLocaleString();
  if (pdfTotalEl) pdfTotalEl.textContent = 'PKR ' + bankTotal.toLocaleString();
  if (diffEl) {
    const diffDir = verif.differenceDirection || (bankTotal > appTotal ? 'Bank > Application' : (appTotal > bankTotal ? 'Application > Bank' : 'Equal'));
    const prefix = diffDir === 'Bank > Application' ? '+B ' : (diffDir === 'Application > Bank' ? '+A ' : '');
    diffEl.textContent = prefix + 'PKR ' + diff.toLocaleString();
    diffEl.style.color = Math.abs(diff) < 1.0 ? '#4ade80' : '#fbbf24';
  }

  if (statusBadgeEl) {
    if (verif.verificationStatus === 'VERIFIED / MATCHED' || verif.status === 'MATCHED' || verif.status === 'MATCHED_ZERO') {
      statusBadgeEl.innerHTML = '<span class="verif-badge verif-matched">✓ MATCHED (PKR 0 Diff)</span>';
    } else if (verif.verificationStatus === 'MISMATCH' || verif.status === 'DISCREPANCY') {
      statusBadgeEl.innerHTML = `<span class="verif-badge verif-discrepancy">⚠ MISMATCH (${verif.differenceDirection || 'Diff'})</span>`;
    } else {
      statusBadgeEl.innerHTML = `<span class="verif-badge verif-notfound">? ${escapeHtml(verif.verificationStatus || 'NOT IN ACCOUNTS PDF')}</span>`;
    }
  }

  // Populate Bank PDF Transactions Audit Table
  const bankTxTbody = document.getElementById('disc-modal-bank-tx-tbody');
  const bankTxBadge = document.getElementById('disc-modal-bank-tx-badge');
  const bankTransactions = verif.bankTransactions || [];

  if (bankTxBadge) {
    const incCount = bankTransactions.filter(t => t.status === 'INCLUDED').length;
    bankTxBadge.textContent = `${bankTransactions.length} tx (${incCount} qualifying credits in ${currentSalaryMonth})`;
  }

  if (bankTxTbody) {
    if (bankTransactions.length === 0) {
      bankTxTbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center; padding:0.6rem;">No bank transactions found for this employee in the PDF.</td></tr>';
    } else {
      bankTxTbody.innerHTML = bankTransactions.map(bt => {
        let badge = '<span style="color:var(--text-muted);">—</span>';
        if (bt.status === 'INCLUDED') {
          badge = '<span style="background:rgba(34,197,94,0.2); color:#4ade80; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.72rem;">✓ INCLUDED</span>';
        } else if (bt.status === 'EXCLUDED_MONTH') {
          badge = '<span style="background:rgba(148,163,184,0.15); color:#94a3b8; padding:2px 6px; border-radius:4px; font-size:0.72rem;">⏳ EXCLUDED (MONTH)</span>';
        } else if (bt.status === 'EXCLUDED_DUPLICATE') {
          badge = '<span style="background:rgba(245,158,11,0.2); color:#fbbf24; padding:2px 6px; border-radius:4px; font-size:0.72rem;">⚠️ DUPLICATE</span>';
        } else if (bt.status === 'EXCLUDED_DEBIT') {
          badge = '<span style="background:rgba(99,102,241,0.2); color:#a5b4fc; padding:2px 6px; border-radius:4px; font-size:0.72rem;">ℹ️ DEBIT</span>';
        }

        return `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
            <td style="padding:0.35rem 0.5rem; font-weight:600; color:#e2e8f0; white-space:nowrap;">${escapeHtml(bt.date || bt.rawDate || '—')}</td>
            <td style="padding:0.35rem 0.5rem;">
              <div style="font-weight:600; color:#fff;">${escapeHtml(bt.description || 'Transaction')}</div>
              <div style="font-size:0.7rem; color:var(--text-muted);">Ref: ${escapeHtml(bt.refNo || '—')}</div>
            </td>
            <td style="padding:0.35rem 0.5rem; text-align:right; font-family:monospace; color:${bt.credit > 0 ? '#4ade80' : 'var(--text-muted)'}; font-weight:600;">
              ${bt.credit > 0 ? 'PKR ' + bt.credit.toLocaleString() : '—'}
            </td>
            <td style="padding:0.35rem 0.5rem; text-align:right; font-family:monospace; color:${bt.debit > 0 ? '#f87171' : 'var(--text-muted)'};">
              ${bt.debit > 0 ? 'PKR ' + bt.debit.toLocaleString() : '—'}
            </td>
            <td style="padding:0.35rem 0.5rem; text-align:right; font-family:monospace; color:#cbd5e1;">
              ${bt.balance ? 'PKR ' + bt.balance.toLocaleString() : '—'}
            </td>
            <td style="padding:0.35rem 0.5rem; text-align:center; white-space:nowrap;">
              ${badge}
            </td>
            <td style="padding:0.35rem 0.5rem; font-size:0.72rem; color:var(--text-secondary);">
              ${escapeHtml(bt.reason || '')}
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Populate Application Salary Breakdown
  if (appListEl) {
    const brk = verif.applicationBreakdown;
    let brkSummary = '';
    if (brk) {
      brkSummary = `
        <div style="padding:0.5rem 0.75rem; background:rgba(255,255,255,0.04); border-radius:6px; margin-bottom:0.5rem; font-size:0.8rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">Basic Salary:</span>
            <strong style="color:#fff;">PKR ${(brk.basicSalary || 0).toLocaleString()}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">Present Days:</span>
            <strong style="color:#22c55e;">${brk.regularDays || 0} days (Earned: PKR ${(brk.regularEarned || 0).toLocaleString()})</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">☀️ Sunday Bonus:</span>
            <strong style="color:#fbbf24;">${brk.sundayDays || 0} Sundays (PKR ${(brk.sundayBonus || 0).toLocaleString()})</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">Expenses Deductions:</span>
            <strong style="color:#f87171;">− PKR ${(brk.expenses || 0).toLocaleString()}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,0.08); padding-top:0.35rem; margin-top:0.35rem;">
            <span style="font-weight:700; color:#a5b4fc;">Net Application Total:</span>
            <strong style="font-size:0.92rem; color:#a5b4fc; font-family:monospace;">PKR ${(brk.netSalary !== undefined ? brk.netSalary : appTotal).toLocaleString()}</strong>
          </div>
        </div>
      `;
    }

    try {
      const detailRes = await API.getEmployeeExpensesDetail(employeeId, currentSalaryMonth);
      const entries = (detailRes && detailRes.details && detailRes.details.entries) || [];
      if (appCountEl) appCountEl.textContent = `(${entries.length} expenses)`;

      let entriesHtml = '';
      if (entries.length === 0) {
        entriesHtml = '<p class="text-muted" style="font-size:0.78rem; margin:0.35rem 0;">No individual clock-out expense deductions.</p>';
      } else {
        entriesHtml = entries.map(e => `
          <div style="padding:0.4rem 0.55rem; background:rgba(255,255,255,0.03); border-radius:5px; margin-bottom:0.35rem; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:600; color:#fff; font-size:0.8rem;">${escapeHtml(e.date)}</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(e.description || 'Expense')}</div>
            </div>
            <div style="font-family:monospace; font-weight:700; color:#f87171; font-size:0.8rem;">PKR ${(e.amount || 0).toLocaleString()}</div>
          </div>
        `).join('');
      }
      appListEl.innerHTML = brkSummary + entriesHtml;
    } catch (e) {
      appListEl.innerHTML = brkSummary || '<p style="color:#f87171; font-size:0.8rem;">Failed to load entries.</p>';
    }
  }

  // Populate PDF Lines
  if (pdfListEl) {
    const pdfEntries = verif.pdfEntries || [];
    if (pdfCountEl) pdfCountEl.textContent = `(${pdfEntries.length} lines)`;

    if (pdfEntries.length === 0) {
      pdfListEl.innerHTML = '<p class="text-muted" style="font-size:0.8rem; margin:0.5rem 0;">No matching entries found in Accounts PDF for this name.</p>';
    } else {
      pdfListEl.innerHTML = pdfEntries.map(pe => `
        <div style="padding:0.45rem 0.6rem; background:rgba(255,255,255,0.04); border-radius:6px; margin-bottom:0.4rem; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600; color:#fff;">${escapeHtml(pe.extractedName || emp.name)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); word-break:break-all;">${escapeHtml(pe.rawLine || pe.details || '')}</div>
          </div>
          <div style="font-family:monospace; font-weight:700; color:#6ee7b7; white-space:nowrap; margin-left:0.5rem;">
            PKR ${(pe.amount || 0).toLocaleString()}
          </div>
        </div>
      `).join('');
    }
  }

  // Populate Date-by-Date Cross-Check Comparison Table
  const reconTbody = document.getElementById('disc-modal-recon-tbody');
  const reconBadge = document.getElementById('disc-modal-recon-badge');
  const dateRecon = verif.dateReconciliation || [];

  if (reconBadge) {
    const exactMatches = dateRecon.filter(d => d.status === 'EXACT_MATCH' || d.status === 'INCLUDED').length;
    reconBadge.textContent = `${dateRecon.length} dates checked • ${exactMatches} matched`;
  }

  if (reconTbody) {
    if (dateRecon.length === 0) {
      reconTbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center; padding:0.6rem;">No date records available.</td></tr>';
    } else {
      reconTbody.innerHTML = dateRecon.map(d => {
        let statusBadge = '<span style="color:var(--text-muted);">—</span>';
        let diffColor = '#94a3b8';
        let diffSign = d.difference > 0 ? '+' : '';

        if (d.status === 'EXACT_MATCH' || d.status === 'INCLUDED') {
          statusBadge = '<span style="background:rgba(34,197,94,0.18); color:#4ade80; padding:2px 6px; border-radius:4px; font-weight:600; font-size:0.75rem;">✓ Matched</span>';
          diffColor = '#4ade80';
        } else if (d.status === 'AMOUNT_DIFF' || d.status === 'MISMATCH') {
          statusBadge = '<span style="background:rgba(245,158,11,0.18); color:#fbbf24; padding:2px 6px; border-radius:4px; font-weight:600; font-size:0.75rem;">⚠ Amount Diff</span>';
          diffColor = '#fbbf24';
        } else if (d.status === 'APP_ONLY') {
          statusBadge = '<span style="background:rgba(148,163,184,0.15); color:#94a3b8; padding:2px 6px; border-radius:4px; font-size:0.75rem;">📱 App Only</span>';
          diffColor = '#f87171';
        } else {
          statusBadge = '<span style="background:rgba(129,140,248,0.18); color:#a5b4fc; padding:2px 6px; border-radius:4px; font-size:0.75rem;">📄 Bank PDF</span>';
          diffColor = '#60a5fa';
        }

        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:0.4rem 0.5rem; font-weight:600; color:#e2e8f0; white-space:nowrap;">
              ${escapeHtml(d.date || '—')}
            </td>
            <td style="padding:0.4rem 0.5rem; text-align:right; font-family:monospace; color:${d.appAmount > 0 ? '#f87171' : 'var(--text-muted)'};">
              ${d.appAmount > 0 ? 'PKR ' + d.appAmount.toLocaleString() : '—'}
              <div style="font-size:0.7rem; color:var(--text-muted); font-family:var(--font-sans);">${escapeHtml(d.appNotes || '')}</div>
            </td>
            <td style="padding:0.4rem 0.5rem; text-align:right; font-family:monospace; color:${d.pdfAmount > 0 ? '#6ee7b7' : 'var(--text-muted)'};">
              ${d.pdfAmount > 0 ? 'PKR ' + d.pdfAmount.toLocaleString() : '—'}
              <div style="font-size:0.7rem; color:var(--text-muted); font-family:var(--font-sans);">${escapeHtml(d.pdfDetails || '')}</div>
            </td>
            <td style="padding:0.4rem 0.5rem; text-align:right; font-family:monospace; font-weight:700; color:${diffColor};">
              ${d.difference !== 0 ? diffSign + 'PKR ' + Math.abs(d.difference).toLocaleString() : 'PKR 0'}
            </td>
            <td style="padding:0.4rem 0.5rem; text-align:center; white-space:nowrap;">
              ${statusBadge}
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Populate Unmatched PDF names dropdown
  if (unmatchedSelect) {
    const unmatched = (currentAccountsPdf && currentAccountsPdf.unmatchedPdfEntries) || [];
    unmatchedSelect.innerHTML = '<option value="">-- Select an unmatched name from PDF to link --</option>';
    unmatched.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.extractedName;
      opt.textContent = `${u.extractedName} (PKR ${(u.totalAmount || 0).toLocaleString()})`;
      unmatchedSelect.appendChild(opt);
    });
  }

  if (modal) modal.classList.remove('hidden');
}

// Manual Mapping Save
async function handleSaveManualMapping() {
  if (!adminPasscode) {
    showToast('Please authenticate as Admin first.', 'warning');
    openAdminAuthModal();
    return;
  }
  if (!currentSelectedEmployeeIdForMapping || !currentSalaryMonth) return;
  const select = document.getElementById('disc-modal-unmatched-select');
  const extractedName = select ? select.value : '';
  if (!extractedName) {
    showToast('Please select a name from the dropdown to link.', 'warning');
    return;
  }

  showToast(`Linking "${extractedName}" to employee...`, 'info');
  try {
    const res = await API.mapAccountsPdfEmployee(currentSalaryMonth, extractedName, currentSelectedEmployeeIdForMapping);
    if (res && res.success) {
      showToast('✅ Mapped & re-verified successfully!', 'success');
      const modal = document.getElementById('modal-discrepancy-detail');
      if (modal) modal.classList.add('hidden');
      await loadSalarySheet(currentSalaryMonth);
    } else {
      showToast((res && res.error) || 'Failed to map', 'error');
    }
  } catch (err) {
    if (err.message && err.message.includes('Unauthorized')) {
      showToast('Admin session expired. Please unlock Admin mode again.', 'error');
      openAdminAuthModal();
    } else {
      showToast('Error mapping employee: ' + err.message, 'error');
    }
  }
}

// Salary Approval Modal & Confirmation Handlers
let currentApprovingEmployeeId = null;

async function openSalaryApprovalModal(employeeId) {
  if (!adminPasscode) {
    showToast('Admin authentication required to approve salaries.', 'warning');
    openAdminAuthModal();
    return;
  }

  const emp = (currentSalaryEmployees || []).find(e => e.id === employeeId);
  if (!emp) return;

  currentApprovingEmployeeId = employeeId;

  const verifResults = (currentAccountsPdf && currentAccountsPdf.verificationResults) || [];
  const verif = verifResults.find(v => v.employeeId === employeeId) || {
    bankCreditTotal: 0,
    applicationTotal: 0,
    difference: 0,
    differenceDirection: 'Equal',
    verificationStatus: 'NOT VERIFIED',
    includedTransactionsCount: 0
  };

  const modal = document.getElementById('modal-salary-approval');
  const empInfoEl = document.getElementById('sal-appr-emp-info');
  const bankTotalEl = document.getElementById('sal-appr-bank-total');
  const bankTxCountEl = document.getElementById('sal-appr-bank-tx-count');
  const appTotalEl = document.getElementById('sal-appr-app-total');
  const appBreakdownEl = document.getElementById('sal-appr-app-breakdown');
  const diffAmtEl = document.getElementById('sal-appr-diff-amount');
  const diffDirEl = document.getElementById('sal-appr-diff-dir');
  const statusBadgeEl = document.getElementById('sal-appr-status-badge');
  const amountInput = document.getElementById('sal-appr-amount-input');
  const notesInput = document.getElementById('sal-appr-notes-input');
  const existingBanner = document.getElementById('sal-appr-existing-banner');
  const existingAmtEl = document.getElementById('sal-appr-existing-amt');
  const existingMetaEl = document.getElementById('sal-appr-existing-meta');

  if (empInfoEl) {
    empInfoEl.textContent = `Employee: ${emp.name} (${emp.role || 'Staff'}) • Month: ${currentSalaryMonth}`;
  }

  const bankTotal = verif.bankCreditTotal !== undefined ? verif.bankCreditTotal : (verif.pdfExpense || 0);
  const appTotal = verif.applicationTotal !== undefined ? verif.applicationTotal : (verif.appExpense || 0);
  const diffVal = verif.difference !== undefined ? verif.difference : Math.abs(bankTotal - appTotal);

  if (bankTotalEl) bankTotalEl.textContent = 'PKR ' + bankTotal.toLocaleString();
  if (bankTxCountEl) bankTxCountEl.textContent = `${verif.includedTransactionsCount || 0} qualifying credit(s) in ${currentSalaryMonth}`;
  if (appTotalEl) appTotalEl.textContent = 'PKR ' + appTotal.toLocaleString();
  if (appBreakdownEl) {
    const brk = verif.applicationBreakdown || {};
    appBreakdownEl.textContent = `Earned: PKR ${(brk.totalEarned || appTotal).toLocaleString()} − Exp: PKR ${(brk.expenses || 0).toLocaleString()}`;
  }
  if (diffAmtEl) {
    diffAmtEl.textContent = 'PKR ' + diffVal.toLocaleString();
    diffAmtEl.style.color = Math.abs(diffVal) < 1.0 ? '#4ade80' : '#fbbf24';
  }
  if (diffDirEl) {
    diffDirEl.textContent = verif.differenceDirection || (diffVal < 1.0 ? 'Equal' : 'Difference');
  }

  if (statusBadgeEl) {
    if (verif.verificationStatus === 'VERIFIED / MATCHED' || verif.status === 'MATCHED' || verif.status === 'MATCHED_ZERO') {
      statusBadgeEl.innerHTML = '<span class="verif-badge verif-matched">✓ VERIFIED / MATCHED</span>';
    } else if (verif.verificationStatus === 'MISMATCH' || verif.status === 'DISCREPANCY') {
      statusBadgeEl.innerHTML = `<span class="verif-badge verif-discrepancy">⚠ MISMATCH (${verif.differenceDirection || 'Amount Diff'})</span>`;
    } else {
      statusBadgeEl.innerHTML = `<span class="verif-badge verif-notfound">? ${verif.verificationStatus || 'NOT VERIFIED'}</span>`;
    }
  }

  // Check if already approved
  const approval = verif.approval;
  if (approval && approval.approvalStatus === 'APPROVED') {
    if (existingBanner) existingBanner.classList.remove('hidden');
    if (existingAmtEl) existingAmtEl.textContent = 'PKR ' + (approval.approvedAmount || 0).toLocaleString();
    if (existingMetaEl) {
      const d = approval.approvedAt ? new Date(approval.approvedAt).toLocaleString() : '—';
      existingMetaEl.textContent = `Approved by ${approval.approvedBy || 'Admin'} on ${d}${approval.notes ? ' • Notes: ' + approval.notes : ''}`;
    }
    if (amountInput) amountInput.value = approval.approvedAmount;
    if (notesInput) notesInput.value = approval.notes || '';
  } else {
    if (existingBanner) existingBanner.classList.add('hidden');
    if (amountInput) {
      amountInput.value = (bankTotal > 0) ? bankTotal : (appTotal > 0 ? appTotal : '');
    }
    if (notesInput) notesInput.value = '';
  }

  // Quick-fill buttons
  const btnUseBank = document.getElementById('btn-use-bank-total');
  if (btnUseBank) {
    btnUseBank.onclick = () => { if (amountInput) amountInput.value = bankTotal; };
  }
  const btnUseApp = document.getElementById('btn-use-app-total');
  if (btnUseApp) {
    btnUseApp.onclick = () => { if (amountInput) amountInput.value = appTotal; };
  }

  if (modal) modal.classList.remove('hidden');
}

async function handleConfirmSalaryApproval() {
  if (!adminPasscode) {
    showToast('Admin authentication required.', 'warning');
    openAdminAuthModal();
    return;
  }

  if (!currentApprovingEmployeeId || !currentSalaryMonth) {
    showToast('Missing employee or month.', 'error');
    return;
  }

  const emp = (currentSalaryEmployees || []).find(e => e.id === currentApprovingEmployeeId);
  const verifResults = (currentAccountsPdf && currentAccountsPdf.verificationResults) || [];
  const verif = verifResults.find(v => v.employeeId === currentApprovingEmployeeId) || {};

  const amountInput = document.getElementById('sal-appr-amount-input');
  const notesInput = document.getElementById('sal-appr-notes-input');

  const amt = parseFloat(amountInput ? amountInput.value : 0);
  if (isNaN(amt) || amt < 0) {
    showToast('Please enter a valid positive approval amount.', 'warning');
    if (amountInput) amountInput.focus();
    return;
  }

  const notes = notesInput ? notesInput.value.trim() : '';

  try {
    showToast('Saving approval...', 'info');
    const res = await API.approveSalary({
      employeeId: currentApprovingEmployeeId,
      employeeName: emp ? emp.name : '',
      salaryMonth: currentSalaryMonth,
      bankTotal: verif.bankCreditTotal || 0,
      applicationTotal: verif.applicationTotal || 0,
      difference: verif.difference || 0,
      approvedAmount: amt,
      notes,
      verificationRecordId: currentAccountsPdf ? currentAccountsPdf.id : null,
      adminUser: 'Admin'
    });

    if (res && res.success) {
      showToast(`✅ Salary approved for ${emp ? emp.name : 'employee'}: PKR ${amt.toLocaleString()}`, 'success');
      const modal = document.getElementById('modal-salary-approval');
      if (modal) modal.classList.add('hidden');
      window.currentFinalizedSalaryReport = null;
      const tr = document.getElementById(`sal-row-${currentApprovingEmployeeId}`);
      if (tr) {
        const apprTd = tr.querySelector('.cell-sal-approval');
        if (apprTd) {
          apprTd.innerHTML = `
            <button type="button" class="btn btn-sm" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-size:0.75rem; font-weight:700; padding:0.25rem 0.55rem; border-radius:4px; cursor:pointer;"
              onclick="openSalaryApprovalModal('${currentApprovingEmployeeId}')" title="Approved PKR ${amt.toLocaleString()}">
              ✅ PKR ${amt.toLocaleString()}
            </button>
          `;
        }
      } else {
        await loadSalarySheet(currentSalaryMonth, true);
      }
    } else {
      showToast((res && res.error) || 'Failed to approve salary', 'error');
    }
  } catch (err) {
    showToast('Error approving salary: ' + err.message, 'error');
  }
}

async function handleRevokeSalaryApproval() {
  if (!adminPasscode) {
    showToast('Admin authentication required.', 'warning');
    openAdminAuthModal();
    return;
  }

  if (!currentApprovingEmployeeId || !currentSalaryMonth) return;

  const emp = (currentSalaryEmployees || []).find(e => e.id === currentApprovingEmployeeId);
  const empName = emp ? emp.name : 'this employee';

  if (!confirm(`Are you sure you want to revoke the salary approval for ${empName} for ${currentSalaryMonth}?`)) {
    return;
  }

  try {
    showToast('Revoking approval...', 'info');
    const res = await API.revokeSalaryApproval(currentApprovingEmployeeId, currentSalaryMonth, 'Revoked by admin');
    if (res && res.success) {
      showToast(`Approval revoked for ${empName}.`, 'info');
      const modal = document.getElementById('modal-salary-approval');
      if (modal) modal.classList.add('hidden');
      window.currentFinalizedSalaryReport = null;
      const tr = document.getElementById(`sal-row-${currentApprovingEmployeeId}`);
      if (tr) {
        const apprTd = tr.querySelector('.cell-sal-approval');
        if (apprTd) {
          apprTd.innerHTML = `
            <button type="button" class="btn btn-sm" style="background:#10b981; color:#fff; font-size:0.75rem; font-weight:600; padding:0.25rem 0.55rem; border-radius:4px; border:none; cursor:pointer;"
              onclick="openSalaryApprovalModal('${currentApprovingEmployeeId}')" title="Review & Approve Salary for ${escapeHtml(empName)}">
              🛡️ Approve
            </button>
          `;
        }
      } else {
        await loadSalarySheet(currentSalaryMonth, true);
      }
    } else {
      showToast((res && res.error) || 'Failed to revoke approval', 'error');
    }
  } catch (err) {
    showToast('Error revoking approval: ' + err.message, 'error');
  }
}

// Live recalculation as admin types basic salary, present days, or Sunday bonus
function updateRowSalaryLive(tr, basicVal) {
  if (!tr) return;
  const basicInput = tr.querySelector('.salary-basic-input');
  if (!basicInput) return;
  const basic = (basicVal !== undefined ? parseFloat(basicVal) : parseFloat(basicInput.value)) || 0;
  const presentInput = tr.querySelector('.salary-present-input');
  const totalPresentDays = presentInput ? (parseFloat(presentInput.value) || 0) : (parseFloat(basicInput.dataset.present) || 0);
  const sundayDays = parseFloat(basicInput.dataset.sunday) || 0;
  const expenses = parseFloat(basicInput.dataset.expenses) || 0;

  const perDay = basic > 0 ? Math.round(basic / 30) : 0;
  const effSunday = Math.min(sundayDays, totalPresentDays);
  const effRegular = Math.max(0, totalPresentDays - effSunday);
  const regularEarned = perDay * effRegular;

  const sundayInput = tr.querySelector('.salary-sunday-input');
  let sundayBonus = 0;
  if (sundayInput) {
    const inputVal = parseFloat(sundayInput.value);
    sundayBonus = !isNaN(inputVal) && inputVal >= 0 ? inputVal : (perDay * effSunday);
  } else {
    sundayBonus = perDay * effSunday;
  }

  const earnedSalary = regularEarned + sundayBonus;
  const netSalary = earnedSalary - expenses;

  const cellPerDay = tr.querySelector('.cell-perday');
  const cellRegularEarned = tr.querySelector('.cell-regular-earned');
  const cellEarned = tr.querySelector('.cell-earned');
  const cellNet = tr.querySelector('.cell-net');

  if (cellPerDay) cellPerDay.textContent = perDay > 0 ? perDay.toLocaleString() : '0';
  if (cellRegularEarned) cellRegularEarned.textContent = regularEarned > 0 ? regularEarned.toLocaleString() : '0';
  if (cellEarned) cellEarned.textContent = earnedSalary > 0 ? earnedSalary.toLocaleString() : '0';
  if (cellNet) {
    cellNet.textContent = netSalary.toLocaleString();
    cellNet.className = 'cell-net ' + (netSalary >= 0 ? 'net-salary-positive' : 'net-salary-negative');
  }

  // Update bank difference cell if present
  const cellBankDiff = tr.querySelector('.cell-bank-diff');
  if (cellBankDiff && cellBankDiff.dataset.bankcredits !== undefined && cellBankDiff.dataset.bankcredits !== '') {
    const bankCredits = parseFloat(cellBankDiff.dataset.bankcredits) || 0;
    const diffVal = Math.abs(bankCredits - netSalary);
    const diffColor = diffVal < 1.0 ? '#4ade80' : '#fbbf24';
    const diffDir = bankCredits > netSalary ? '+B ' : (netSalary > bankCredits ? '+A ' : '');
    cellBankDiff.innerHTML = `<span style="font-family:monospace; color:${diffColor}; font-weight:700;">${diffDir}PKR ${diffVal.toLocaleString()}</span>`;
  }

  // Update summary cards live
  updateSalarySummaryCards();
}

async function handleSaveSundayBonus(empId, month, btn) {
  const tr = document.getElementById(`sal-row-${empId}`);
  const input = tr ? tr.querySelector('.salary-sunday-input') : document.querySelector(`.salary-sunday-input[data-empid="${empId}"]`);
  if (!input) return;
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0) {
    showToast('Please enter a valid Sunday bonus amount (>= 0).', 'warning');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }

  try {
    const res = await API.setManualSundayBonus(empId, month, val);
    if (res && res.success) {
      showToast(`✅ Sunday bonus saved (PKR ${val.toLocaleString()})! Salary recalculated.`, 'success');
      clearSalaryFieldDirty(empId, 'sunday');
      window.currentFinalizedSalaryReport = null;

      if (tr) {
        const badgeContainer = tr.querySelector('.sunday-badge-container');
        if (badgeContainer) {
          badgeContainer.innerHTML = `
            <span class="badge-manual" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 5px; font-weight:600;" title="Edited by Admin">✏️ Manual</span>
            <button type="button" class="btn-reset-sunday" 
              onclick="handleResetSundayBonus('${empId}', '${month}', this)"
              style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; cursor:pointer; text-decoration:underline; padding:0;"
              title="Reset to auto-calculated Sunday bonus">↺ Reset</button>
          `;
        }
        input.value = val;
        updateRowSalaryLive(tr);
      }
    } else {
      showToast((res && res.error) || 'Failed to save Sunday bonus', 'error');
    }
  } catch (err) {
    showToast('Failed to save Sunday bonus: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Save';
    }
  }
}

async function handleResetSundayBonus(empId, month, btn) {
  if (!confirm('Reset Sunday Bonus to auto-calculated value? This will remove the manual override.')) return;
  const tr = document.getElementById(`sal-row-${empId}`);
  const input = tr ? tr.querySelector('.salary-sunday-input') : document.querySelector(`.salary-sunday-input[data-empid="${empId}"]`);
  if (!input) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }
  try {
    const res = await API.resetManualSundayBonus(empId, month);
    if (res && res.success) {
      showToast('↺ Reset to auto-calculated Sunday bonus!', 'success');
      clearSalaryFieldDirty(empId, 'sunday');
      window.currentFinalizedSalaryReport = null;

      const autoVal = parseFloat(input.dataset.auto) || 0;
      input.value = autoVal;
      if (tr) {
        const badgeContainer = tr.querySelector('.sunday-badge-container');
        if (badgeContainer) {
          badgeContainer.innerHTML = `
            <span class="badge-auto" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:4px; padding:1px 5px; font-weight:500;">🤖 Auto</span>
          `;
        }
        updateRowSalaryLive(tr);
      }
    } else {
      showToast((res && res.error) || 'Failed to reset Sunday bonus', 'error');
    }
  } catch (err) {
    showToast('Failed to reset: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '↺ Reset';
    }
  }
}

async function handleSavePresentDays(empId, month, btn) {
  const tr = document.getElementById(`sal-row-${empId}`);
  const input = tr ? tr.querySelector('.salary-present-input') : document.querySelector(`.salary-present-input[data-empid="${empId}"]`);
  if (!input) return;
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0 || val > 31) {
    showToast('Please enter a valid number of present days between 0 and 31.', 'warning');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }

  try {
    const res = await API.setManualPresentDays(empId, month, val);
    if (res && res.success) {
      showToast(`✅ Present days saved (${val} days)! Salary recalculated.`, 'success');
      clearSalaryFieldDirty(empId, 'present');
      window.currentFinalizedSalaryReport = null;

      if (tr) {
        const badgeContainer = tr.querySelector('.present-badge-container');
        if (badgeContainer) {
          badgeContainer.innerHTML = `
            <span class="badge-manual" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 5px; font-weight:600;" title="Edited by Admin">✏️ Manual</span>
            <button type="button" class="btn-reset-present" 
              onclick="handleResetPresentDays('${empId}', '${month}', this)"
              style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; cursor:pointer; text-decoration:underline; padding:0;"
              title="Reset to auto-calculated attendance">↺ Reset</button>
          `;
        }
        input.value = val;
        updateRowSalaryLive(tr);
      }
    } else {
      showToast((res && res.error) || 'Failed to save present days', 'error');
    }
  } catch (err) {
    showToast('Failed to save present days: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Save';
    }
  }
}

async function handleResetPresentDays(empId, month, btn) {
  if (!confirm('Reset Present Days to auto-calculated attendance? This will remove the manual override.')) return;
  const tr = document.getElementById(`sal-row-${empId}`);
  const input = tr ? tr.querySelector('.salary-present-input') : document.querySelector(`.salary-present-input[data-empid="${empId}"]`);
  if (!input) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }
  try {
    const res = await API.resetManualPresentDays(empId, month);
    if (res && res.success) {
      showToast('↺ Reset to auto-calculated attendance!', 'success');
      clearSalaryFieldDirty(empId, 'present');
      window.currentFinalizedSalaryReport = null;

      const autoDays = parseFloat(input.dataset.auto) || 0;
      input.value = autoDays;
      if (tr) {
        const badgeContainer = tr.querySelector('.present-badge-container');
        if (badgeContainer) {
          badgeContainer.innerHTML = `
            <span class="badge-auto" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:4px; padding:1px 5px; font-weight:500;">🤖 Auto</span>
          `;
        }
        updateRowSalaryLive(tr);
      }
    } else {
      showToast((res && res.error) || 'Failed to reset present days', 'error');
    }
  } catch (err) {
    showToast('Failed to reset: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '↺ Reset';
    }
  }
}

async function handleArchiveSalaryEmployee(empId, empName, month) {
  const confirmMsg = `Are you sure you want to remove "${empName}" from the Salary Sheet?\n\n` +
    `• They will be archived and hidden from the active Salary Sheet, PDF, and CSV.\n` +
    `• ALL historical attendance records and past salary data will be SAFELY PRESERVED.\n\n` +
    `Click OK to proceed.`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await API.archiveSalaryEmployee(empId);
    if (res && res.success) {
      showToast(`🗑 Employee "${empName}" removed from Salary Sheet.`, 'success');
      await loadSalarySheet(month, true);
    } else {
      showToast((res && res.error) || 'Failed to archive employee', 'error');
    }
  } catch (err) {
    showToast('Failed to archive employee: ' + err.message, 'error');
  }
}

async function handleSetBasicSalary(btn) {
  const empId = btn.dataset.empid;
  const month = btn.dataset.month;
  const tr = document.getElementById(`sal-row-${empId}`) || btn.closest('tr');
  const input = tr ? tr.querySelector('.salary-basic-input') : btn.parentElement.querySelector('.salary-basic-input');
  const value = parseFloat(input ? input.value : 0) || 0;
  if (!empId || !month) return;

  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await API.setSalaryBasic(empId, month, value);
    if (res && res.success !== false) {
      showToast(`✅ Basic salary saved (PKR ${value.toLocaleString()})!`, 'success');
      clearSalaryFieldDirty(empId, 'basic');
      window.currentFinalizedSalaryReport = null;
      if (tr) {
        updateRowSalaryLive(tr, value);
      }
    } else {
      showToast((res && res.error) || 'Failed to save basic salary', 'error');
    }
  } catch (err) {
    showToast('Failed to save basic salary: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function handleGenerateSingleSalary(empId, month) {
  const tr = document.getElementById(`sal-row-${empId}`);
  try {
    showToast('Recalculating employee salary...', 'info');
    const res = await API.generateSalary(empId, month);
    if (res && res.success && res.salary) {
      const sal = res.salary;
      if (tr) {
        const basicInput = tr.querySelector('.salary-basic-input');
        if (basicInput) {
          basicInput.value = sal.basicSalary || '';
          basicInput.dataset.regular = sal.regularPresentDays !== undefined ? sal.regularPresentDays : (sal.presentDays || 0);
          basicInput.dataset.sunday = sal.sundayPresentDays !== undefined ? sal.sundayPresentDays : 0;
          basicInput.dataset.expenses = sal.totalExpenses || 0;
        }
        const presentInput = tr.querySelector('.salary-present-input');
        if (presentInput) {
          const autoDays = sal.autoPresentDays !== undefined ? sal.autoPresentDays : (sal.presentDays || 0);
          presentInput.dataset.auto = autoDays;
          presentInput.value = sal.presentDays !== undefined ? sal.presentDays : autoDays;
          const presentBadge = tr.querySelector('.present-badge-container');
          if (presentBadge) {
            if (sal.isManualPresentDays) {
              presentBadge.innerHTML = `
                <span class="badge-manual" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 5px; font-weight:600;">✏️ Manual</span>
                <button type="button" class="btn-reset-present" 
                  onclick="handleResetPresentDays('${empId}', '${month}', this)"
                  style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; cursor:pointer; text-decoration:underline; padding:0;"
                  title="Reset to auto-calculated attendance">↺ Reset</button>
              `;
            } else {
              presentBadge.innerHTML = `<span class="badge-auto" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:4px; padding:1px 5px; font-weight:500;">🤖 Auto</span>`;
            }
          }
        }
        const sundayInput = tr.querySelector('.salary-sunday-input');
        if (sundayInput) {
          const autoBonus = sal.autoSundayBonus !== undefined ? sal.autoSundayBonus : 0;
          sundayInput.dataset.auto = autoBonus;
          sundayInput.value = sal.sundayBonus !== undefined ? sal.sundayBonus : autoBonus;
          const sundayBadge = tr.querySelector('.sunday-badge-container');
          if (sundayBadge) {
            if (sal.isManualSundayBonus) {
              sundayBadge.innerHTML = `
                <span class="badge-manual" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 5px; font-weight:600;">✏️ Manual</span>
                <button type="button" class="btn-reset-sunday" 
                  onclick="handleResetSundayBonus('${empId}', '${month}', this)"
                  style="background:none; border:none; color:#a5b4fc; font-size:0.72rem; cursor:pointer; text-decoration:underline; padding:0;"
                  title="Reset to auto-calculated Sunday bonus">↺ Reset</button>
              `;
            } else {
              sundayBadge.innerHTML = `<span class="badge-auto" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:4px; padding:1px 5px; font-weight:500;">🤖 Auto</span>`;
            }
          }
        }
        clearEmployeeSalaryDirty(empId);
        window.currentFinalizedSalaryReport = null;
        updateRowSalaryLive(tr);
      }
      showToast('⚡ Salary recalculated!', 'success');
    } else {
      await loadSalarySheet(month, true);
    }
  } catch (err) {
    showToast('Failed to recalculate salary: ' + err.message, 'error');
  }
}

async function handleGenerateAllSalaries() {
  const picker = document.getElementById('salary-month-picker');
  const month = (picker ? picker.value : '') || getCurrentMonthString();
  if (!month) { showToast('Please select a month first.', 'warning'); return; }

  const btn = document.getElementById('btn-generate-all-salaries');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...'; }

  try {
    showToast('Generating salaries for all employees...', 'info');
    const res = await API.generateAllSalaries(month);
    const count = res.salaries ? res.salaries.length : 0;
    showToast(`✅ Generated salaries for ${count} employee(s)!`, 'success');
    await loadSalarySheet(month);
  } catch (err) {
    showToast('Failed to generate salaries: ' + err.message, 'error');
    console.error('handleGenerateAllSalaries error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate All Salaries'; }
  }
}

async function printSalarySheet() {
  const month = currentSalaryMonth || getCurrentMonthString();
  if (!month) {
    showToast('Please select and load a salary sheet first.', 'warning');
    return;
  }

  showToast('Generating official finalized Salary Sheet PDF...', 'info');

  let report = window.currentFinalizedSalaryReport;
  if (!report || report.month !== month) {
    try {
      const res = await API.getFinalizedSalaryReport(month);
      report = res.report;
      window.currentFinalizedSalaryReport = report;
    } catch (e) {
      console.warn('Could not fetch report for print:', e);
    }
  }

  if (!report || !report.employees || report.employees.length === 0) {
    showToast('No salary data found to export.', 'error');
    return;
  }

  const fmt = (v) => typeof v === 'number' ? v.toLocaleString() : (v || '0');
  const orgName = report.officeName || (settings && settings.officeName) || 'Company Office';
  const monthTitle = report.formattedMonth || month;
  const nowStr = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const runId = `SAL-${month.replace('-', '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

  const printContainer = document.createElement('div');
  printContainer.className = 'pdf-export-container';
  printContainer.style.position = 'absolute';
  printContainer.style.left = '-9999px';
  printContainer.style.top = '-9999px';
  printContainer.style.width = '1080px';
  printContainer.style.padding = '24px 30px';
  printContainer.style.background = '#ffffff';
  printContainer.style.color = '#111827';
  printContainer.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  printContainer.style.fontSize = '11px';
  printContainer.style.lineHeight = '1.4';

  printContainer.innerHTML = `
    <!-- HEADER -->
    <div style="border-bottom: 2px solid #1e293b; padding-bottom: 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(orgName)}</h1>
        <h2 style="font-size: 13px; font-weight: 700; color: #4338ca; margin: 0; text-transform: uppercase;">Finalized Salary Sheet & Expense Reconciliation</h2>
        <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Billing Period: <strong>${escapeHtml(monthTitle)}</strong> • Divisor: <strong>30 Days</strong></div>
      </div>
      <div style="text-align: right; font-size: 10px; color: #475569;">
        <div>Reference ID: <strong style="font-family: monospace; color: #0f172a;">${runId}</strong></div>
        <div>Generated: <strong>${nowStr}</strong></div>
        <div style="margin-top: 4px; display: inline-block; padding: 2px 6px; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; border-radius: 3px; font-weight: 700; font-size: 9px;">OFFICIAL FINALIZED REPORT</div>
      </div>
    </div>

    <!-- SUMMARY KPI CARDS -->
    <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 18px;">
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center;">
        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600;">Total Staff</div>
        <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${report.summary.totalEmployees}</div>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center;">
        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600;">Base Payroll</div>
        <div style="font-size: 13px; font-weight: 800; color: #3b82f6;">PKR ${fmt(report.summary.totalBaseSalary)}</div>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center;">
        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600;">Earned Total</div>
        <div style="font-size: 13px; font-weight: 800; color: #6366f1;">PKR ${fmt(report.summary.totalEarnedSalary)}</div>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center;">
        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600;">Expenses Claimed</div>
        <div style="font-size: 13px; font-weight: 800; color: #ef4444;">PKR ${fmt(report.summary.totalClaimedExpenses)}</div>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center;">
        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600;">Net Payable</div>
        <div style="font-size: 14px; font-weight: 800; color: #10b981;">PKR ${fmt(report.summary.totalNetSalary)}</div>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center;">
        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600;">Bank Credits</div>
        <div style="font-size: 13px; font-weight: 800; color: #0284c7;">PKR ${fmt(report.summary.totalBankCredits)}</div>
      </div>
    </div>

    <!-- MASTER SALARY TABLE -->
    <div style="margin-bottom: 22px;">
      <h3 style="font-size: 11px; font-weight: 700; color: #1e293b; text-transform: uppercase; margin: 0 0 6px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
        1. Master Employee Payroll & Reconciliation Schedule
      </h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 9.5px;">
        <thead>
          <tr style="background: #f1f5f9; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; text-align: left;">
            <th style="padding: 5px 4px; width: 24px; text-align: center;">#</th>
            <th style="padding: 5px 6px;">Employee Name</th>
            <th style="padding: 5px 6px;">Role</th>
            <th style="padding: 5px 6px; text-align: right;">Basic (PKR)</th>
            <th style="padding: 5px 4px; text-align: center;">Days</th>
            <th style="padding: 5px 4px; text-align: center;">Present</th>
            <th style="padding: 5px 6px; text-align: right;">Per Day</th>
            <th style="padding: 5px 6px; text-align: right;">Reg. Earned</th>
            <th style="padding: 5px 6px; text-align: right;">Sun. Bonus</th>
            <th style="padding: 5px 6px; text-align: right; background: #f8fafc;">Earned Total</th>
            <th style="padding: 5px 6px; text-align: right; color: #b91c1c;">Expenses</th>
            <th style="padding: 5px 6px; text-align: right; font-weight: 700; background: #f0fdf4;">Net Payable</th>
            <th style="padding: 5px 6px; text-align: right;">Bank Credit</th>
            <th style="padding: 5px 6px; text-align: right;">Diff</th>
            <th style="padding: 5px 4px; text-align: center;">Bank Match</th>
            <th style="padding: 5px 4px; text-align: center;">Approval</th>
          </tr>
        </thead>
        <tbody>
          ${report.employees.map((e, idx) => `
            <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 1 ? 'background: #fbfcfe;' : ''}">
              <td style="padding: 4px; text-align: center; color: #64748b;">${idx + 1}</td>
              <td style="padding: 4px 6px; font-weight: 700; color: #0f172a;">${escapeHtml(e.name)}</td>
              <td style="padding: 4px 6px; color: #475569;">${escapeHtml(e.role || 'Staff')}</td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace;">${fmt(e.basicSalary)}</td>
              <td style="padding: 4px; text-align: center; color: #64748b;">30</td>
              <td style="padding: 4px; text-align: center; font-weight: 700; color: #16a34a;">
                ${e.presentDays}${e.isManualPresentDays ? ' <span style="font-size:7.5px; background:#fef3c7; color:#b45309; padding:1px 3px; border-radius:2px; font-weight:700;">(Manual)</span>' : ''}
              </td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace;">${fmt(e.perDaySalary)}</td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace;">${fmt(e.regularEarned)}</td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace; color: ${e.sundayBonus > 0 ? '#b45309' : '#64748b'};">
                ${e.sundayBonus > 0 ? '+' + fmt(e.sundayBonus) : '0'}${e.isManualSundayBonus ? ' <span style="font-size:7.5px; background:#fef3c7; color:#b45309; padding:1px 3px; border-radius:2px; font-weight:700;">(Manual)</span>' : ''}
              </td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace; font-weight: 700; background: #f8fafc;">${fmt(e.earnedSalary)}</td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace; color: #b91c1c; font-weight: 600;">
                ${e.totalExpenses > 0 ? fmt(e.totalExpenses) : '0'}
              </td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace; font-weight: 800; color: #15803d; background: #f0fdf4;">${fmt(e.netSalary)}</td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace; color: #0369a1;">${fmt(e.bankCredits)}</td>
              <td style="padding: 4px 6px; text-align: right; font-family: monospace; color: ${e.bankDifference < 1.0 ? '#15803d' : '#b45309'};">
                ${fmt(e.bankDifference)}
              </td>
              <td style="padding: 4px; text-align: center; font-size: 8.5px; font-weight: 700;">
                ${e.bankStatus === 'MATCHED' || e.bankStatus === 'MATCHED_ZERO' ? '<span style="color: #16a34a;">✓ MATCHED</span>' : (e.bankStatus === 'MISMATCH' ? '<span style="color: #b45309;">⚠ MISMATCH</span>' : '<span style="color: #64748b;">—</span>')}
              </td>
              <td style="padding: 4px; text-align: center; font-size: 8.5px; font-weight: 700;">
                ${e.salaryApprovalStatus === 'APPROVED' ? '<span style="color: #15803d;">✅ APPROVED</span>' : '<span style="color: #64748b;">PENDING</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background: #f1f5f9; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; font-weight: 800;">
            <td colspan="3" style="padding: 6px; text-align: right; text-transform: uppercase;">Totals:</td>
            <td style="padding: 6px; text-align: right; font-family: monospace;">PKR ${fmt(report.summary.totalBaseSalary)}</td>
            <td colspan="2"></td>
            <td></td>
            <td></td>
            <td></td>
            <td style="padding: 6px; text-align: right; font-family: monospace; background: #f8fafc;">PKR ${fmt(report.summary.totalEarnedSalary)}</td>
            <td style="padding: 6px; text-align: right; font-family: monospace; color: #b91c1c;">PKR ${fmt(report.summary.totalClaimedExpenses)}</td>
            <td style="padding: 6px; text-align: right; font-family: monospace; color: #15803d; background: #f0fdf4;">PKR ${fmt(report.summary.totalNetSalary)}</td>
            <td style="padding: 6px; text-align: right; font-family: monospace; color: #0369a1;">PKR ${fmt(report.summary.totalBankCredits)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- ITEMIZED EXPENSES SECTION -->
    <div style="margin-bottom: 24px; page-break-inside: avoid;">
      <h3 style="font-size: 11px; font-weight: 700; color: #1e293b; text-transform: uppercase; margin: 0 0 6px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
        2. Itemized Monthly Expenses Breakdown (Per Employee)
      </h3>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        ${report.employees.map(e => `
          <div style="border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; background: #fafafa; font-size: 9px;">
            <div style="display: flex; justify-content: space-between; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 4px;">
              <span>${escapeHtml(e.name)} <span style="font-weight: 400; color: #64748b;">(${escapeHtml(e.role || 'Staff')})</span></span>
              <span style="color: ${e.totalExpenses > 0 ? '#b91c1c' : '#15803d'};">
                Total: PKR ${fmt(e.totalExpenses)}
              </span>
            </div>
            ${e.itemizedExpenses && e.itemizedExpenses.length > 0 ? `
              <table style="width: 100%; border-collapse: collapse; font-size: 8.5px;">
                ${e.itemizedExpenses.map(item => `
                  <tr style="border-bottom: 1px dotted #e2e8f0;">
                    <td style="color: #64748b; width: 65px; padding: 2px 0;">${item.date}</td>
                    <td style="padding: 2px 4px; color: #334155;">${escapeHtml(item.description || 'Expense')}</td>
                    <td style="text-align: right; font-family: monospace; font-weight: 600; color: #b91c1c; padding: 2px 0;">PKR ${fmt(item.amount)}</td>
                  </tr>
                `).join('')}
              </table>
            ` : `
              <div style="color: #64748b; font-style: italic; padding: 2px 0;">Expenses: PKR 0 (No expenses recorded)</div>
            `}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- CERTIFICATION & SIGN-OFF BLOCKS -->
    <div style="border-top: 2px solid #cbd5e1; padding-top: 14px; margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; page-break-inside: avoid;">
      <div style="border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px; background: #f8fafc;">
        <div style="font-size: 10px; font-weight: 700; color: #1e293b; text-transform: uppercase; margin-bottom: 4px;">1. Admin 1 Expense Verification</div>
        <div style="font-size: 9px; color: #475569; margin-bottom: 18px;">I have inspected all receipts, clock-out submissions, and verified legitimate operational expenses.</div>
        <div style="display: flex; justify-content: space-between; border-top: 1px dashed #94a3b8; padding-top: 4px; font-size: 9px; color: #475569;">
          <span>Verified By: <strong>Admin 1</strong></span>
          <span>Date: ________________</span>
          <span>Signature: ________________</span>
        </div>
      </div>
      <div style="border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px; background: #f8fafc;">
        <div style="font-size: 10px; font-weight: 700; color: #1e293b; text-transform: uppercase; margin-bottom: 4px;">2. Senior Admin Final Approval</div>
        <div style="font-size: 9px; color: #475569; margin-bottom: 18px;">I hereby approve the finalized attendance records, disbursements, and reconciled net salary figures.</div>
        <div style="display: flex; justify-content: space-between; border-top: 1px dashed #94a3b8; padding-top: 4px; font-size: 9px; color: #475569;">
          <span>Approved By: <strong>Senior Admin</strong></span>
          <span>Date: ________________</span>
          <span>Signature: ________________</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(printContainer);

  const opt = {
    margin: [8, 8, 8, 8],
    filename: `Salary_Sheet_${month}_${runId}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  try {
    if (window.html2pdf) {
      await window.html2pdf().set(opt).from(printContainer).save();
      showToast(`✅ PDF ${opt.filename} downloaded successfully!`, 'success');
    } else {
      window.print();
    }
  } catch (err) {
    console.error('PDF export error:', err);
    showToast('Failed to export PDF: ' + err.message, 'error');
  } finally {
    if (document.body.contains(printContainer)) {
      document.body.removeChild(printContainer);
    }
  }
}

async function exportSalarySheetCSV(monthOverride) {
  const picker = document.getElementById('salary-month-picker');
  const month = monthOverride || (picker ? picker.value : '') || currentSalaryMonth || getCurrentMonthString();
  if (!month) {
    showToast('Please select a month first.', 'warning');
    return;
  }

  showToast('Generating Salary Sheet CSV...', 'info');

  let report = window.currentFinalizedSalaryReport;
  if (!report || report.month !== month) {
    try {
      const res = await API.getFinalizedSalaryReport(month);
      report = res && res.report;
      window.currentFinalizedSalaryReport = report;
    } catch (e) {
      console.warn('Could not fetch finalized report for CSV:', e);
    }
  }

  if (!report || !report.employees || report.employees.length === 0) {
    showToast('No salary records found to export.', 'error');
    return;
  }

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headers = [
    'Sr No',
    'Employee ID',
    'Employee Name',
    'Role',
    'Basic Salary (PKR)',
    'Divisor Days',
    'Present Days',
    'Calculation Type',
    'Per Day Rate (PKR)',
    'Regular Earned (PKR)',
    'Sunday Bonus (PKR)',
    'Sunday Bonus Type',
    'Earned Total (PKR)',
    'Claimed Expenses (PKR)',
    'Net Payable (PKR)',
    'Bank Credits (PKR)',
    'Bank Difference (PKR)',
    'Bank Match Status',
    'Salary Approval Status'
  ];

  const rows = [headers.map(escapeCsv).join(',')];

  report.employees.forEach((emp, idx) => {
    const row = [
      idx + 1,
      emp.id,
      emp.name,
      emp.role || 'Staff',
      emp.basicSalary || 0,
      30,
      emp.presentDays,
      emp.isManualPresentDays ? 'Manual' : 'Auto',
      emp.perDaySalary || 0,
      emp.regularEarned || 0,
      emp.sundayBonus || 0,
      emp.isManualSundayBonus ? 'Manual' : 'Auto',
      emp.earnedSalary || 0,
      emp.totalExpenses || 0,
      emp.netSalary || 0,
      emp.bankCredits || 0,
      emp.bankDifference || 0,
      emp.bankStatus || '—',
      emp.salaryApprovalStatus || 'PENDING'
    ];
    rows.push(row.map(escapeCsv).join(','));
  });

  // Summary row
  if (report.summary) {
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''].map(escapeCsv).join(','));
    const summaryRow = [
      'TOTALS',
      '',
      `Total Staff: ${report.summary.totalEmployees}`,
      '',
      report.summary.totalBaseSalary || 0,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.summary.totalEarnedSalary || 0,
      report.summary.totalClaimedExpenses || 0,
      report.summary.totalNetSalary || 0,
      report.summary.totalBankCredits || 0,
      '',
      '',
      ''
    ];
    rows.push(summaryRow.map(escapeCsv).join(','));
  }

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(rows.join('\r\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csvContent);
  link.setAttribute('download', `Salary_Sheet_${month}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`✅ Salary Sheet CSV exported for ${month}!`, 'success');
}

// ─── Expense Verification & Senior Admin Approval UI Logic ───────────────────
let currentExpVerifyEmpId = null;
let currentExpApproveEmpId = null;

async function openExpenseVerifyModal(empId) {
  currentExpVerifyEmpId = empId;
  const emp = (currentSalaryEmployees || []).find(e => e.id === empId);
  const expVer = (currentExpenseVerifications && currentExpenseVerifications[empId]) || null;
  const salRow = document.getElementById(`sal-row-${empId}`);
  
  const modal = document.getElementById('modal-expense-verify');
  if (!modal) return;

  const subtitleEl = document.getElementById('exp-verify-subtitle');
  const claimedEl = document.getElementById('exp-verify-claimed');
  const periodEl = document.getElementById('exp-verify-period');
  const itemizedEl = document.getElementById('exp-verify-itemized-container');
  const amtInput = document.getElementById('exp-verify-amount-input');
  const adminNameInput = document.getElementById('exp-verify-admin-name');
  const passcodeInput = document.getElementById('exp-verify-passcode');
  const notesInput = document.getElementById('exp-verify-notes');
  const auditBox = document.getElementById('exp-verify-audit-box');

  const empName = emp ? emp.name : 'Employee';
  if (subtitleEl) subtitleEl.textContent = `${empName} • ${currentSalaryMonth}`;
  if (periodEl) periodEl.textContent = currentSalaryMonth;

  let claimed = 0;
  if (expVer && typeof expVer.claimedAmount === 'number') {
    claimed = expVer.claimedAmount;
  } else if (salRow) {
    const input = salRow.querySelector('.salary-basic-input');
    claimed = input ? (parseFloat(input.dataset.expenses) || 0) : 0;
  }
  if (claimedEl) claimedEl.textContent = 'PKR ' + claimed.toLocaleString();

  // Itemized breakdown from server
  if (itemizedEl) {
    itemizedEl.innerHTML = '<div style="color:var(--text-muted); text-align:center;">Loading daily expense breakdown...</div>';
    try {
      const res = await API.getEmployeeExpensesDetail(empId, currentSalaryMonth);
      const entries = (res && res.details && res.details.entries) || [];
      if (entries.length === 0) {
        itemizedEl.innerHTML = '<div style="color:var(--text-muted); text-align:center;">No individual expense entries recorded for this month.</div>';
      } else {
        itemizedEl.innerHTML = `
          <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
            <thead>
              <tr style="color:var(--text-muted); border-bottom:1px solid rgba(255,255,255,0.06);">
                <th style="text-align:left; padding:3px 6px;">Date</th>
                <th style="text-align:left; padding:3px 6px;">Description</th>
                <th style="text-align:right; padding:3px 6px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map(e => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                  <td style="padding:3px 6px; color:#cbd5e1;">${escapeHtml(e.date)}</td>
                  <td style="padding:3px 6px; color:var(--text-muted);">${escapeHtml(e.description || e.source || 'Expense')}</td>
                  <td style="padding:3px 6px; text-align:right; font-family:monospace; color:#f87171;">PKR ${(e.amount||0).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    } catch (e) {
      itemizedEl.innerHTML = `<div style="color:#f87171; text-align:center;">Error loading details: ${escapeHtml(e.message)}</div>`;
    }
  }

  // Pre-fill amount
  if (amtInput) {
    if (expVer && typeof expVer.verifiedAmount === 'number') {
      amtInput.value = expVer.verifiedAmount;
    } else {
      amtInput.value = claimed > 0 ? claimed : '';
    }
  }

  if (adminNameInput) {
    adminNameInput.value = (expVer && expVer.verifiedBy) || 'Admin 1';
  }
  if (passcodeInput) {
    passcodeInput.value = adminPasscode || '';
  }
  if (notesInput) {
    notesInput.value = (expVer && expVer.notes) || '';
  }

  // Audit history
  if (auditBox) {
    if (expVer && Array.isArray(expVer.auditLog) && expVer.auditLog.length > 0) {
      auditBox.classList.remove('hidden');
      const last = expVer.auditLog[expVer.auditLog.length - 1];
      auditBox.innerHTML = `<strong>Last Activity:</strong> ${escapeHtml(last.action || 'VERIFIED')} by ${escapeHtml(last.by || 'Admin')} on ${new Date(last.at).toLocaleString()}${last.notes ? ` (Note: ${escapeHtml(last.notes)})` : ''}`;
    } else {
      auditBox.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
}

function closeExpenseVerifyModal() {
  const modal = document.getElementById('modal-expense-verify');
  if (modal) modal.classList.add('hidden');
  currentExpVerifyEmpId = null;
}

async function submitExpenseVerification() {
  if (!currentExpVerifyEmpId) return;

  const amtInput = document.getElementById('exp-verify-amount-input');
  const passcodeInput = document.getElementById('exp-verify-passcode');
  const adminNameInput = document.getElementById('exp-verify-admin-name');
  const notesInput = document.getElementById('exp-verify-notes');

  const amt = parseFloat(amtInput ? amtInput.value : '');
  if (isNaN(amt) || amt < 0) {
    showToast('Please enter a valid verified amount (0 or more).', 'warning');
    if (amtInput) amtInput.focus();
    return;
  }

  const passcode = passcodeInput ? passcodeInput.value.trim() : '';
  if (!passcode) {
    showToast('Please enter the Admin passcode.', 'warning');
    if (passcodeInput) passcodeInput.focus();
    return;
  }

  const adminName = (adminNameInput && adminNameInput.value.trim()) || 'Admin 1';
  const notes = notesInput ? notesInput.value.trim() : '';
  const emp = (currentSalaryEmployees || []).find(e => e.id === currentExpVerifyEmpId);
  const expVer = (currentExpenseVerifications && currentExpenseVerifications[currentExpVerifyEmpId]) || null;
  const claimed = expVer ? expVer.claimedAmount : 0;

  const btn = document.getElementById('btn-submit-expense-verify');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const res = await API.verifyExpense({
      employeeId: currentExpVerifyEmpId,
      employeeName: emp ? emp.name : '',
      salaryMonth: currentSalaryMonth,
      claimedAmount: claimed,
      verifiedAmount: amt,
      verifiedBy: adminName,
      notes,
      passcode
    });

    if (res && res.success) {
      showToast(`✓ Expense verified by ${adminName}: PKR ${amt.toLocaleString()}`, 'success');
      const verifiedId = currentExpVerifyEmpId;
      closeExpenseVerifyModal();
      window.currentFinalizedSalaryReport = null;
      const tr = document.getElementById(`sal-row-${verifiedId}`);
      if (tr) {
        const basicInput = tr.querySelector('.salary-basic-input');
        if (basicInput) basicInput.dataset.expenses = amt;
        const verifyBtn = tr.querySelector('.cell-expenses button[onclick*="openExpenseVerifyModal"]');
        if (verifyBtn) {
          verifyBtn.style.background = 'rgba(59,130,246,0.18)';
          verifyBtn.style.color = '#60a5fa';
          verifyBtn.style.border = '1px solid rgba(59,130,246,0.5)';
          verifyBtn.style.fontWeight = '700';
          verifyBtn.textContent = `✓ Ver: ${amt.toLocaleString()}`;
        }
        updateRowSalaryLive(tr);
      } else {
        await loadSalarySheet(currentSalaryMonth, true);
      }
    } else {
      showToast((res && res.error) || 'Failed to verify expense', 'error');
    }
  } catch (err) {
    showToast('Verification failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Verification'; }
  }
}

async function openExpenseApproveModal(empId) {
  currentExpApproveEmpId = empId;
  const emp = (currentSalaryEmployees || []).find(e => e.id === empId);
  const expVer = (currentExpenseVerifications && currentExpenseVerifications[empId]) || null;
  const salRow = document.getElementById(`sal-row-${empId}`);

  const modal = document.getElementById('modal-expense-approve');
  if (!modal) return;

  const subtitleEl = document.getElementById('exp-approve-subtitle');
  const claimedEl = document.getElementById('exp-approve-claimed');
  const verifiedEl = document.getElementById('exp-approve-verified');
  const verifiedByEl = document.getElementById('exp-approve-verified-by');
  const maxHintEl = document.getElementById('exp-approve-max-hint');
  const amtInput = document.getElementById('exp-approve-amount-input');
  const seniorNameInput = document.getElementById('exp-approve-senior-name');
  const passcodeInput = document.getElementById('exp-approve-passcode');
  const notesInput = document.getElementById('exp-approve-notes');
  const auditBox = document.getElementById('exp-approve-audit-box');

  const empName = emp ? emp.name : 'Employee';
  if (subtitleEl) subtitleEl.textContent = `${empName} • ${currentSalaryMonth}`;

  let claimed = 0;
  if (expVer && typeof expVer.claimedAmount === 'number') {
    claimed = expVer.claimedAmount;
  } else if (salRow) {
    const input = salRow.querySelector('.salary-basic-input');
    claimed = input ? (parseFloat(input.dataset.expenses) || 0) : 0;
  }
  if (claimedEl) claimedEl.textContent = 'PKR ' + claimed.toLocaleString();

  const verifiedAmt = (expVer && typeof expVer.verifiedAmount === 'number') ? expVer.verifiedAmount : claimed;
  if (verifiedEl) verifiedEl.textContent = 'PKR ' + verifiedAmt.toLocaleString();
  if (verifiedByEl) {
    if (expVer && expVer.verifiedBy) {
      verifiedByEl.textContent = `By ${expVer.verifiedBy} on ${new Date(expVer.verifiedAt || Date.now()).toLocaleDateString()}`;
    } else {
      verifiedByEl.textContent = 'Pending Admin 1 verification';
    }
  }
  if (maxHintEl) maxHintEl.textContent = 'PKR ' + verifiedAmt.toLocaleString();

  // Pre-fill approved amount
  if (amtInput) {
    if (expVer && typeof expVer.approvedAmount === 'number') {
      amtInput.value = expVer.approvedAmount;
    } else {
      amtInput.value = verifiedAmt;
    }
    amtInput.max = verifiedAmt;
  }

  if (seniorNameInput) {
    seniorNameInput.value = (expVer && expVer.approvedBy) || 'Senior Admin';
  }
  if (passcodeInput) {
    passcodeInput.value = '';
  }
  if (notesInput) {
    notesInput.value = (expVer && expVer.notes) || '';
  }

  if (auditBox) {
    if (expVer && Array.isArray(expVer.auditLog) && expVer.auditLog.length > 0) {
      auditBox.classList.remove('hidden');
      auditBox.innerHTML = `<strong>Approval History:</strong><ul style="margin:4px 0 0 16px; padding:0;">${
        expVer.auditLog.map(a => `<li>${escapeHtml(a.action)}: PKR ${(a.approvedAmount||a.verifiedAmount||0).toLocaleString()} by ${escapeHtml(a.by||'Admin')} (${new Date(a.at).toLocaleDateString()})</li>`).join('')
      }</ul>`;
    } else {
      auditBox.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
}

function closeExpenseApproveModal() {
  const modal = document.getElementById('modal-expense-approve');
  if (modal) modal.classList.add('hidden');
  currentExpApproveEmpId = null;
}

async function submitExpenseApproval() {
  if (!currentExpApproveEmpId) return;

  const amtInput = document.getElementById('exp-approve-amount-input');
  const passcodeInput = document.getElementById('exp-approve-passcode');
  const seniorNameInput = document.getElementById('exp-approve-senior-name');
  const notesInput = document.getElementById('exp-approve-notes');

  const amt = parseFloat(amtInput ? amtInput.value : '');
  if (isNaN(amt) || amt < 0) {
    showToast('Please enter a valid approved amount (0 or more).', 'warning');
    if (amtInput) amtInput.focus();
    return;
  }

  const expVer = (currentExpenseVerifications && currentExpenseVerifications[currentExpApproveEmpId]) || null;
  const verifiedLimit = (expVer && typeof expVer.verifiedAmount === 'number') ? expVer.verifiedAmount : null;

  if (verifiedLimit !== null && amt > verifiedLimit) {
    showToast(`Approved amount (PKR ${amt.toLocaleString()}) cannot exceed verified amount (PKR ${verifiedLimit.toLocaleString()}).`, 'error');
    if (amtInput) amtInput.focus();
    return;
  }

  const passcode = passcodeInput ? passcodeInput.value.trim() : '';
  if (!passcode) {
    showToast('Please enter the Senior Admin passcode (default 9999).', 'warning');
    if (passcodeInput) passcodeInput.focus();
    return;
  }

  const seniorName = (seniorNameInput && seniorNameInput.value.trim()) || 'Senior Admin';
  const notes = notesInput ? notesInput.value.trim() : '';
  const emp = (currentSalaryEmployees || []).find(e => e.id === currentExpApproveEmpId);

  const btn = document.getElementById('btn-submit-expense-approve');
  if (btn) { btn.disabled = true; btn.textContent = 'Approving...'; }

  try {
    const res = await API.approveExpense({
      employeeId: currentExpApproveEmpId,
      employeeName: emp ? emp.name : '',
      salaryMonth: currentSalaryMonth,
      claimedAmount: expVer ? expVer.claimedAmount : amt,
      approvedAmount: amt,
      approvedBy: seniorName,
      notes,
      passcode
    });

    if (res && res.success) {
      showToast(`🛡️ Expense approved by ${seniorName}: PKR ${amt.toLocaleString()}`, 'success');
      const approvedId = currentExpApproveEmpId;
      closeExpenseApproveModal();
      window.currentFinalizedSalaryReport = null;
      const tr = document.getElementById(`sal-row-${approvedId}`);
      if (tr) {
        const basicInput = tr.querySelector('.salary-basic-input');
        if (basicInput) basicInput.dataset.expenses = amt;
        const approveBtn = tr.querySelector('.cell-expenses button[onclick*="openExpenseApproveModal"]');
        if (approveBtn) {
          approveBtn.style.background = 'rgba(16,185,129,0.18)';
          approveBtn.style.color = '#34d399';
          approveBtn.style.border = '1px solid rgba(16,185,129,0.5)';
          approveBtn.style.fontWeight = '700';
          approveBtn.textContent = `✅ Appr: ${amt.toLocaleString()}`;
        }
        updateRowSalaryLive(tr);
      } else {
        await loadSalarySheet(currentSalaryMonth, true);
      }
    } else {
      showToast((res && res.error) || 'Failed to approve expense', 'error');
    }
  } catch (err) {
    showToast('Approval failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🛡️ Confirm Approval'; }
  }
}

async function openCreditHistoryModal(employeeId) {
  const emp = (currentSalaryEmployees || []).find(e => e.id === employeeId);
  const empName = emp ? emp.name : 'Employee';

  const modal = document.getElementById('modal-credit-history');
  if (!modal) return;

  const subtitleEl = document.getElementById('credit-history-subtitle');
  if (subtitleEl) subtitleEl.textContent = `${empName} (${emp ? (emp.role || 'Staff') : ''}) • All-Time Bank Credit History`;

  const statAllCredits = document.getElementById('hist-stat-all-credits');
  const statMonthName = document.getElementById('hist-current-month-name');
  const statCurrentMonth = document.getElementById('hist-stat-current-month');
  const statTotalTx = document.getElementById('hist-stat-total-tx');
  const monthlyTbody = document.getElementById('hist-monthly-summary-tbody');
  const txTbody = document.getElementById('hist-transactions-tbody');

  if (statMonthName) statMonthName.textContent = currentSalaryMonth;
  if (monthlyTbody) monthlyTbody.innerHTML = '<tr><td colspan="6" style="padding:10px; text-align:center; color:var(--text-muted);">Loading monthly summary...</td></tr>';
  if (txTbody) txTbody.innerHTML = '<tr><td colspan="5" style="padding:10px; text-align:center; color:var(--text-muted);">Loading transactions...</td></tr>';

  modal.classList.remove('hidden');

  try {
    const res = await API.getEmployeeCreditHistory(employeeId);
    if (!res || !res.success || !res.history) {
      if (txTbody) txTbody.innerHTML = '<tr><td colspan="5" style="padding:10px; text-align:center; color:var(--text-muted);">No credit history found.</td></tr>';
      return;
    }

    const hist = res.history;
    if (statAllCredits) statAllCredits.textContent = 'PKR ' + (hist.totalCreditsAllTime || 0).toLocaleString();
    if (statCurrentMonth) statCurrentMonth.textContent = 'PKR ' + ((hist.creditsByMonth && hist.creditsByMonth[currentSalaryMonth]) || 0).toLocaleString();
    if (statTotalTx) statTotalTx.textContent = `${(hist.allCreditTransactions || []).length} TX`;

    // Monthly summary table
    if (monthlyTbody) {
      const summaries = hist.monthlySummary || [];
      if (summaries.length === 0) {
        monthlyTbody.innerHTML = '<tr><td colspan="6" style="padding:10px; text-align:center; color:var(--text-muted);">No monthly summary available.</td></tr>';
      } else {
        monthlyTbody.innerHTML = summaries.map(s => {
          const isSelectedMonth = s.month === currentSalaryMonth;
          const bg = isSelectedMonth ? 'background:rgba(99,102,241,0.12); font-weight:600;' : '';
          const statusColor = s.approvalStatus === 'APPROVED' ? '#34d399' : (s.verificationStatus === 'VERIFIED' ? '#60a5fa' : '#94a3b8');
          const statusText = s.approvalStatus === 'APPROVED' ? `✅ Approved` : (s.verificationStatus === 'VERIFIED' ? `✓ Verified` : `Pending`);

          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${bg}">
              <td style="padding:6px 10px; color:#fff;">${escapeHtml(s.month)}${isSelectedMonth ? ' 👈' : ''}</td>
              <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#6ee7b7;">PKR ${(s.bankCredits||0).toLocaleString()}</td>
              <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#f87171;">${s.claimedAmount ? 'PKR ' + s.claimedAmount.toLocaleString() : '—'}</td>
              <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#60a5fa;">${s.verifiedAmount !== null && s.verifiedAmount !== undefined ? 'PKR ' + s.verifiedAmount.toLocaleString() : '—'}</td>
              <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#34d399; font-weight:700;">${s.approvedAmount !== null && s.approvedAmount !== undefined ? 'PKR ' + s.approvedAmount.toLocaleString() : '—'}</td>
              <td style="padding:6px 10px; text-align:center;"><span style="color:${statusColor}; font-size:0.75rem;">${statusText}</span></td>
            </tr>
          `;
        }).join('');
      }
    }

    // Individual transactions table
    if (txTbody) {
      const txs = hist.allCreditTransactions || [];
      if (txs.length === 0) {
        txTbody.innerHTML = '<tr><td colspan="5" style="padding:10px; text-align:center; color:var(--text-muted);">No credit transactions found in uploaded bank statements.</td></tr>';
      } else {
        txTbody.innerHTML = txs.map(t => `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
            <td style="padding:6px 10px; color:#cbd5e1; font-family:monospace;">${escapeHtml(t.date || '—')}</td>
            <td style="padding:6px 10px; color:var(--text-secondary); max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(t.description)}">${escapeHtml(t.description || '—')}</td>
            <td style="padding:6px 10px; color:var(--text-muted); font-family:monospace;">${escapeHtml(t.refNo || '—')}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:700;">PKR ${(t.amount||0).toLocaleString()}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace; color:var(--text-muted);">${t.balance ? 'PKR ' + t.balance.toLocaleString() : '—'}</td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    if (txTbody) txTbody.innerHTML = `<tr><td colspan="5" style="padding:10px; text-align:center; color:#f87171;">Error loading history: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function closeCreditHistoryModal() {
  const modal = document.getElementById('modal-credit-history');
  if (modal) modal.classList.add('hidden');
}

// ─── Emergency Salary Generator Controller ────────────────────────────────────
let currentEmergReport = null;
let currentEmergMonth = null;
let selectedEmergEmpIdForOverride = null;

function initEmergencySalaryGenerator() {
  const monthInput = document.getElementById('emerg-salary-month');
  if (monthInput && !monthInput.value) {
    monthInput.value = getCurrentMonthString();
  }
  currentEmergMonth = monthInput ? monthInput.value : getCurrentMonthString();

  if (monthInput) {
    monthInput.addEventListener('change', (e) => {
      currentEmergMonth = e.target.value;
      loadEmergencySalaryGenerator(currentEmergMonth);
    });
  }

  const triggerUploadBtn = document.getElementById('btn-emerg-trigger-pdf-upload');
  const fileInput = document.getElementById('emerg-pdf-file-input');
  if (triggerUploadBtn && fileInput) {
    triggerUploadBtn.onclick = () => fileInput.click();
  }

  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        processAndVerifyEmergPDFs(Array.from(e.target.files));
      }
    };
  }

  const processBtn = document.getElementById('btn-emerg-process');
  if (processBtn) {
    processBtn.onclick = () => {
      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        processAndVerifyEmergPDFs(Array.from(fileInput.files));
      } else {
        showToast('Please select one or more bank statement PDFs first.', 'info');
        if (fileInput) fileInput.click();
      }
    };
  }

  const genPdfBtn = document.getElementById('btn-emerg-generate-pdf');
  if (genPdfBtn) {
    genPdfBtn.onclick = () => triggerEmergencySalaryPDFExport();
  }

  const indivPdfBtn = document.getElementById('btn-emerg-individual-pdf');
  if (indivPdfBtn) {
    indivPdfBtn.onclick = () => promptAndGenerateIndividualPDF();
  }

  // Review Modal close buttons
  const closeRevBtn = document.getElementById('btn-close-emerg-review-modal');
  const cancelRevBtn = document.getElementById('btn-cancel-emerg-review');
  if (closeRevBtn) closeRevBtn.onclick = closeEmergReviewModal;
  if (cancelRevBtn) cancelRevBtn.onclick = closeEmergReviewModal;

  const formOverride = document.getElementById('form-emerg-override');
  if (formOverride) {
    formOverride.onsubmit = (e) => {
      e.preventDefault();
      saveEmergencyOverrideSubmit();
    };
  }

  // Warning Modal close buttons
  const cancelWarnBtn = document.getElementById('btn-cancel-emerg-warning');
  const proceedWarnBtn = document.getElementById('btn-proceed-emerg-warning');
  if (cancelWarnBtn) cancelWarnBtn.onclick = closeEmergWarningModal;
  if (proceedWarnBtn) {
    proceedWarnBtn.onclick = () => {
      closeEmergWarningModal();
      executeProgrammaticSalaryPDFExport(true);
    };
  }
}

async function loadEmergencySalaryGenerator(month) {
  if (!month) month = getCurrentMonthString();
  currentEmergMonth = month;
  const tbody = document.getElementById('emerg-salary-tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="12" class="table-empty" style="text-align:center; padding:1rem;"><span class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid #818cf8; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:8px;"></span>Loading real employee salary & credit data...</td></tr>';
  }

  try {
    const report = await API.getEmergencySalary(month);
    currentEmergReport = report;
    renderEmergencySalaryUI(report);
  } catch (err) {
    console.error('loadEmergencySalaryGenerator error:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="12" class="table-empty" style="color:var(--color-danger); text-align:center; padding:1rem;">Failed to load emergency salary data: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderEmergencySalaryUI(report) {
  if (!report) return;

  const summary = report.summary || {};
  const employees = report.employees || [];

  // Update stat cards
  const elEmp = document.getElementById('emerg-stat-employees');
  if (elEmp) elEmp.textContent = summary.totalEmployees || employees.length || 0;

  const elBase = document.getElementById('emerg-stat-base');
  if (elBase) elBase.textContent = 'PKR ' + (summary.totalBaseSalary || 0).toLocaleString();

  const elCred = document.getElementById('emerg-stat-verified-credits');
  if (elCred) elCred.textContent = 'PKR ' + (summary.totalVerifiedCredits || 0).toLocaleString();

  const elExp = document.getElementById('emerg-stat-expenses');
  if (elExp) elExp.textContent = 'PKR ' + (summary.totalExpenses || 0).toLocaleString();

  const elFinal = document.getElementById('emerg-stat-final-payable');
  if (elFinal) elFinal.textContent = 'PKR ' + (summary.totalFinalPayable || 0).toLocaleString();

  // Status Summary Badges
  const badgesContainer = document.getElementById('emerg-status-summary-badges');
  if (badgesContainer) {
    const totalDiscrepancies = summary.totalDiscrepancies || 0;
    const totalUnapproved = summary.unapprovedCount || 0;

    let badgesHtml = '';
    if (totalDiscrepancies > 0) {
      badgesHtml += `<span class="status-indicator" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.4); font-size:0.78rem; font-weight:600;">⚠️ ${totalDiscrepancies} Mismatch / Discrepanc${totalDiscrepancies > 1 ? 'ies' : 'y'}</span>`;
    } else {
      badgesHtml += `<span class="status-indicator" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.4); font-size:0.78rem; font-weight:600;">✓ All Bank Credits Verified</span>`;
    }

    if (totalUnapproved > 0) {
      badgesHtml += `<span class="status-indicator" style="background:rgba(99,102,241,0.15); color:#a5b4fc; border:1px solid rgba(99,102,241,0.3); font-size:0.78rem; font-weight:600;">🛡️ ${totalUnapproved} Pending Senior Approval</span>`;
    } else {
      badgesHtml += `<span class="status-indicator" style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.4); font-size:0.78rem; font-weight:600;">🛡️ Senior Admin Approved</span>`;
    }
    badgesContainer.innerHTML = badgesHtml;
  }

  // Render Employee Salary Rows
  const tbody = document.getElementById('emerg-salary-tbody');
  if (tbody) {
    if (employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="12" class="table-empty" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No active employee records found for this month.</td></tr>';
      return;
    }

    tbody.innerHTML = employees.map((emp, idx) => {
      let statusBadge = '';
      if (emp.verificationStatus === 'VERIFIED') {
        statusBadge = '<span class="status-badge" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.4); padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;">✓ VERIFIED</span>';
      } else if (emp.verificationStatus === 'MISMATCH') {
        statusBadge = '<span class="status-badge" style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.4); padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;">⚠️ MISMATCH</span>';
      } else if (emp.verificationStatus === 'NEEDS REVIEW') {
        statusBadge = '<span class="status-badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.4); padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;">🔍 NEEDS REVIEW</span>';
      } else {
        statusBadge = '<span class="status-badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; border:1px solid rgba(148,163,184,0.3); padding:2px 8px; border-radius:4px; font-size:0.75rem;">? NO CREDIT FOUND</span>';
      }

      let approvalBadge = '';
      if (emp.approvalStatus === 'APPROVED') {
        approvalBadge = `<span style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.5); padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;" title="Approved by ${escapeHtml(emp.approvedBy || 'Senior Admin')}">🛡️ APPROVED</span>`;
      } else {
        approvalBadge = `<button type="button" class="btn btn-sm" style="background:#10b981; color:#fff; font-size:0.72rem; padding:0.25rem 0.55rem; border-radius:4px; border:none; cursor:pointer;" onclick="openEmergApproveModal('${emp.id}')">🛡️ Approve</button>`;
      }

      const netSalary = emp.finalPayable || 0;
      const netClass = netSalary >= 0 ? 'color:#22c55e; font-weight:700;' : 'color:#ef4444; font-weight:700;';

      return `
        <tr id="emerg-emp-row-${emp.id}" style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="text-align:center; color:var(--text-muted);">${idx + 1}</td>
          <td style="font-weight:600; color:#fff;">${escapeHtml(emp.name)}</td>
          <td style="color:var(--text-secondary); font-size:0.85rem;">${escapeHtml(emp.role || 'Staff')}</td>
          <td style="text-align:right; font-family:monospace; color:#a5b4fc; font-weight:600;">PKR ${fmtNum(emp.baseSalary)}</td>
          <td style="text-align:right; font-family:monospace; color:#818cf8;">PKR ${fmtNum(emp.appCredit)}</td>
          <td style="text-align:right; font-family:monospace; color:#6ee7b7; font-weight:600;">PKR ${fmtNum(emp.verifiedCredit)}</td>
          <td style="text-align:right; font-family:monospace; color:#f87171;">PKR ${fmtNum(emp.expenses)}</td>
          <td style="text-align:right; font-family:monospace; font-size:0.95rem; ${netClass}">PKR ${fmtNum(netSalary)}</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">${approvalBadge}</td>
          <td style="text-align:center;">
            <div style="display:flex; gap:0.35rem; justify-content:center;">
              <button type="button" class="btn btn-sm btn-secondary" style="padding:0.22rem 0.45rem; font-size:0.75rem;" onclick="openEmergReviewModal('${emp.id}')" title="Review Bank Transactions & Override">🔍 Review</button>
              <button type="button" class="btn btn-sm btn-primary" style="padding:0.22rem 0.45rem; font-size:0.75rem; background:#4f46e5; border:none;" onclick="generateIndividualEmployeePDF('${emp.id}')" title="Download Pay Slip PDF">📄 Slip</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render Attached PDFs list inside emerg-pdf-file-list & container
  const pdfContainer = document.getElementById('emerg-pdf-tags-container');
  const pdfList = document.getElementById('emerg-pdf-file-list');
  const attachedPdfs = report.attachedPdfs || [];

  if (pdfContainer && pdfList) {
    if (attachedPdfs.length === 0) {
      pdfContainer.style.display = 'none';
    } else {
      pdfContainer.style.display = 'block';
      pdfList.innerHTML = attachedPdfs.map(p => `
        <div style="display:inline-flex; align-items:center; gap:0.5rem; background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.4); padding:0.35rem 0.75rem; border-radius:20px; font-size:0.8rem; color:#a5b4fc;">
          <span>📑 <strong>${escapeHtml(p.fileName)}</strong> (${escapeHtml(p.bankName || 'Bank Statement')} • ${p.transactionCount || 0} tx)</span>
        </div>
      `).join('');
    }
  }
}

async function processAndVerifyEmergPDFs(files) {
  if (!files || files.length === 0) return;
  if (!currentEmergMonth) currentEmergMonth = getCurrentMonthString();

  showToast(`Extracting & parsing ${files.length} bank statement PDF(s)...`, 'info');

  try {
    const parsedFilesData = [];
    for (const file of files) {
      const extractedText = await extractPdfTextInBrowser(file);
      let payloadFile = {
        fileName: file.name,
        fileSize: file.size
      };
      if (extractedText) {
        payloadFile.extractedText = extractedText;
      } else {
        const base64Data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        payloadFile.pdfBase64 = base64Data;
      }
      parsedFilesData.push(payloadFile);
    }

    showToast('Merging transactions & calculating salary credits...', 'info');

    const res = await API.uploadEmergencyBankPdf({
      month: currentEmergMonth,
      files: parsedFilesData
    });

    if (res && res.success) {
      showToast(`✅ Uploaded & merged ${files.length} bank statement(s)!`, 'success');
      await loadEmergencySalaryGenerator(currentEmergMonth);
    } else {
      showToast((res && res.error) || 'Failed to process bank statement PDFs', 'error');
    }
  } catch (err) {
    console.error('processAndVerifyEmergPDFs error:', err);
    showToast('Error processing PDFs: ' + err.message, 'error');
  }
}

// Modal Review & Override
function openEmergReviewModal(empId) {
  if (!currentEmergReport || !currentEmergReport.employees) return;
  const emp = currentEmergReport.employees.find(e => e.id === empId);
  if (!emp) return;

  selectedEmergEmpIdForOverride = empId;

  const modal = document.getElementById('modal-emerg-review');
  const titleEl = document.getElementById('emerg-review-title');
  const subtitleEl = document.getElementById('emerg-review-subtitle');
  const appCredEl = document.getElementById('emerg-rev-app-credit');
  const bankCredEl = document.getElementById('emerg-rev-bank-credit');
  const diffEl = document.getElementById('emerg-rev-diff');
  const badgeEl = document.getElementById('emerg-rev-status-badge');
  const txListEl = document.getElementById('emerg-rev-tx-list');
  const empIdInput = document.getElementById('emerg-rev-emp-id');
  const overrideAmtInput = document.getElementById('emerg-rev-override-amount');
  const overrideStatusSelect = document.getElementById('emerg-rev-override-status');
  const notesInput = document.getElementById('emerg-rev-override-notes');

  if (titleEl) titleEl.textContent = `Credit Review: ${emp.name}`;
  if (subtitleEl) subtitleEl.textContent = `Role: ${emp.role || 'Staff'} • Month: ${currentEmergMonth}`;
  if (empIdInput) empIdInput.value = emp.id;

  if (appCredEl) appCredEl.textContent = 'PKR ' + (emp.appCredit || 0).toLocaleString();
  if (bankCredEl) bankCredEl.textContent = 'PKR ' + (emp.verifiedCredit || 0).toLocaleString();
  if (diffEl) {
    const diff = (emp.verifiedCredit || 0) - (emp.appCredit || 0);
    diffEl.textContent = (diff >= 0 ? '+' : '') + 'PKR ' + diff.toLocaleString();
    diffEl.style.color = Math.abs(diff) < 1.0 ? '#4ade80' : '#fbbf24';
  }

  if (badgeEl) {
    badgeEl.innerHTML = `<span style="padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem; background:rgba(99,102,241,0.2); color:#a5b4fc;">${escapeHtml(emp.verificationStatus || 'NEEDS REVIEW')}</span>`;
  }

  // Render transaction history list for this employee
  if (txListEl) {
    const txs = emp.bankTransactions || [];
    if (txs.length === 0) {
      txListEl.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:0.5rem; font-size:0.8rem;">No matching bank transactions found in uploaded statements.</div>';
    } else {
      txListEl.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
          <thead>
            <tr style="color:var(--text-muted); border-bottom:1px solid rgba(255,255,255,0.1);">
              <th style="text-align:left; padding:4px;">Date</th>
              <th style="text-align:left; padding:4px;">Description</th>
              <th style="text-align:right; padding:4px;">Credit (PKR)</th>
              <th style="text-align:center; padding:4px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${txs.map(t => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                <td style="padding:4px; color:#cbd5e1;">${escapeHtml(t.date || '—')}</td>
                <td style="padding:4px; color:#94a3b8;">${escapeHtml(t.description || '—')}</td>
                <td style="padding:4px; text-align:right; font-family:monospace; color:#6ee7b7; font-weight:700;">${(t.credit || 0).toLocaleString()}</td>
                <td style="text-align:center; padding:4px;">
                  <span style="font-size:0.7rem; color:${t.status === 'INCLUDED' ? '#4ade80' : '#94a3b8'};">${escapeHtml(t.status || 'PARSED')}</span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }

  if (overrideAmtInput) overrideAmtInput.value = emp.verifiedCredit !== undefined ? emp.verifiedCredit : emp.appCredit;
  if (overrideStatusSelect) overrideStatusSelect.value = emp.verificationStatus || 'VERIFIED';
  if (notesInput) notesInput.value = emp.notes || '';

  if (modal) modal.classList.remove('hidden');
}

function closeEmergReviewModal() {
  const modal = document.getElementById('modal-emerg-review');
  if (modal) modal.classList.add('hidden');
  selectedEmergEmpIdForOverride = null;
}

async function saveEmergencyOverrideSubmit() {
  if (!selectedEmergEmpIdForOverride || !currentEmergMonth) return;

  const overrideAmtInput = document.getElementById('emerg-rev-override-amount');
  const overrideStatusSelect = document.getElementById('emerg-rev-override-status');
  const notesInput = document.getElementById('emerg-rev-override-notes');

  const verifiedCredit = parseFloat(overrideAmtInput ? overrideAmtInput.value : 0);
  const status = overrideStatusSelect ? overrideStatusSelect.value : 'VERIFIED';
  const notes = notesInput ? notesInput.value.trim() : '';

  try {
    showToast('Saving verification override...', 'info');
    const res = await API.verifyEmergencySalary({
      month: currentEmergMonth,
      employeeId: selectedEmergEmpIdForOverride,
      verifiedCredit,
      status,
      notes,
      verifiedBy: 'Admin 1'
    });

    if (res && res.success) {
      showToast('✅ Credit verification saved!', 'success');
      closeEmergReviewModal();
      await loadEmergencySalaryGenerator(currentEmergMonth);
    } else {
      showToast((res && res.error) || 'Failed to save verification', 'error');
    }
  } catch (err) {
    showToast('Error saving verification: ' + err.message, 'error');
  }
}

async function openEmergApproveModal(empId) {
  if (!currentEmergReport || !currentEmergReport.employees) return;
  const emp = currentEmergReport.employees.find(e => e.id === empId);
  if (!emp) return;

  const passcode = prompt(`Senior Admin Passcode required to approve salary for ${emp.name}:\n\n(Default Passcode: 9999)`);
  if (!passcode) return;

  try {
    showToast(`Approving salary for ${emp.name}...`, 'info');
    const res = await API.approveEmergencySalary({
      month: currentEmergMonth,
      employeeId: empId,
      passcode,
      approvedBy: 'Senior Admin',
      notes: 'Approved via Emergency Generator'
    });

    if (res && res.success) {
      showToast(`🛡️ Salary approved for ${emp.name}!`, 'success');
      await loadEmergencySalaryGenerator(currentEmergMonth);
    } else {
      showToast((res && res.error) || 'Failed to approve salary', 'error');
    }
  } catch (err) {
    showToast('Approval error: ' + err.message, 'error');
  }
}

// Warning Modal Handlers
function openEmergWarningModal(discrepancies) {
  const modal = document.getElementById('modal-emerg-warning');
  const textEl = document.getElementById('emerg-warning-text');

  if (textEl) {
    textEl.innerHTML = `
      There ${discrepancies.length === 1 ? 'is' : 'are'} <strong>${discrepancies.length} unresolved credit discrepancy/discrepancies</strong> in current month (${currentEmergMonth}):
      <ul style="margin:8px 0 0 18px; padding:0; text-align:left;">
        ${discrepancies.map(d => `<li><strong>${escapeHtml(d.name)}</strong>: App Credit (PKR ${(d.appCredit||0).toLocaleString()}) vs Bank Credit (PKR ${(d.verifiedCredit||0).toLocaleString()}) [${escapeHtml(d.verificationStatus)}]</li>`).join('')}
      </ul>
      <br/>
      Do you want to proceed with PDF export anyway?
    `;
  }

  if (modal) modal.classList.remove('hidden');
}

function closeEmergWarningModal() {
  const modal = document.getElementById('modal-emerg-warning');
  if (modal) modal.classList.add('hidden');
}

function triggerEmergencySalaryPDFExport() {
  if (!currentEmergReport || !currentEmergReport.employees) {
    showToast('No emergency salary data loaded.', 'warning');
    return;
  }

  const discrepancies = currentEmergReport.employees.filter(e => e.verificationStatus === 'MISMATCH' || e.verificationStatus === 'NEEDS REVIEW');
  if (discrepancies.length > 0) {
    openEmergWarningModal(discrepancies);
  } else {
    executeProgrammaticSalaryPDFExport(false);
  }
}

async function executeProgrammaticSalaryPDFExport(overrideWarning = false) {
  if (!currentEmergReport || !currentEmergReport.employees) return;

  const month = currentEmergMonth || getCurrentMonthString();
  const monthTitle = new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const runId = `SAL-${month.replace('-', '')}-` + String(Math.floor(100 + Math.random() * 900));
  const generatedAt = new Date().toLocaleString();

  showToast(`Generating Programmatic Salary PDF (${runId})...`, 'info');

  const summary = currentEmergReport.summary || {};
  const employees = currentEmergReport.employees || [];

  // Construct Printable HTML Document
  const printContainer = document.createElement('div');
  printContainer.id = 'emerg-pdf-print-root';
  printContainer.style.position = 'absolute';
  printContainer.style.left = '-9999px';
  printContainer.style.top = '-9999px';
  printContainer.style.width = '800px';
  printContainer.style.padding = '24px';
  printContainer.style.background = '#ffffff';
  printContainer.style.color = '#1e293b';
  printContainer.style.fontFamily = "'Inter', Arial, sans-serif";

  printContainer.innerHTML = `
    <div style="border-bottom:2px solid #334155; padding-bottom:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-end;">
      <div>
        <h1 style="margin:0; font-size:20px; font-weight:800; color:#0f172a; text-transform:uppercase; letter-spacing:0.5px;">Office Attendance & Salary Management System</h1>
        <h2 style="margin:4px 0 0; font-size:14px; font-weight:600; color:#475569;">Emergency Salary Calculation & Disbursal Sheet</h2>
      </div>
      <div style="text-align:right; font-size:11px; color:#64748b;">
        <div><strong>Run ID:</strong> <span style="font-family:monospace; font-weight:700; color:#0f172a;">${runId}</span></div>
        <div><strong>Period:</strong> ${monthTitle}</div>
        <div><strong>Generated:</strong> ${generatedAt}</div>
      </div>
    </div>

    <!-- Summary Metrics Box -->
    <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; margin-bottom:16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px;">
      <div style="text-align:center;">
        <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Employees</div>
        <div style="font-size:14px; font-weight:700; color:#0f172a;">${summary.totalEmployees || employees.length}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Base Salary</div>
        <div style="font-size:13px; font-weight:700; color:#3b82f6;">PKR ${(summary.totalBaseSalary || 0).toLocaleString()}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Verified Credits</div>
        <div style="font-size:13px; font-weight:700; color:#10b981;">PKR ${(summary.totalVerifiedCredits || 0).toLocaleString()}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Month Expenses</div>
        <div style="font-size:13px; font-weight:700; color:#ef4444;">PKR ${(summary.totalExpenses || 0).toLocaleString()}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Net Payable</div>
        <div style="font-size:14px; font-weight:800; color:#15803d;">PKR ${(summary.totalFinalPayable || 0).toLocaleString()}</div>
      </div>
    </div>

    <!-- Main Salary Table -->
    <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px;">
      <thead>
        <tr style="background:#0f172a; color:#ffffff;">
          <th style="padding:6px 8px; text-align:center; border:1px solid #334155;">#</th>
          <th style="padding:6px 8px; text-align:left; border:1px solid #334155;">Employee Name</th>
          <th style="padding:6px 8px; text-align:left; border:1px solid #334155;">Role</th>
          <th style="padding:6px 8px; text-align:right; border:1px solid #334155;">Base Salary</th>
          <th style="padding:6px 8px; text-align:right; border:1px solid #334155;">Verified Credits</th>
          <th style="padding:6px 8px; text-align:right; border:1px solid #334155;">Month Expense</th>
          <th style="padding:6px 8px; text-align:right; border:1px solid #334155;">Final Payable</th>
          <th style="padding:6px 8px; text-align:center; border:1px solid #334155;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${employees.map((emp, i) => `
          <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding:6px 8px; text-align:center; border:1px solid #cbd5e1; color:#64748b;">${i + 1}</td>
            <td style="padding:6px 8px; font-weight:600; border:1px solid #cbd5e1; color:#0f172a;">${escapeHtml(emp.name)}</td>
            <td style="padding:6px 8px; border:1px solid #cbd5e1; color:#475569;">${escapeHtml(emp.role || 'Staff')}</td>
            <td style="padding:6px 8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace;">${fmtNum(emp.baseSalary)}</td>
            <td style="padding:6px 8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace; color:#047857; font-weight:600;">${fmtNum(emp.verifiedCredit)}</td>
            <td style="padding:6px 8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace; color:#b91c1c;">${fmtNum(emp.expenses)}</td>
            <td style="padding:6px 8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace; font-weight:700; color:#15803d;">PKR ${fmtNum(emp.finalPayable)}</td>
            <td style="padding:6px 8px; text-align:center; border:1px solid #cbd5e1; font-size:10px; font-weight:700;">
              ${emp.approvalStatus === 'APPROVED' ? '<span style="color:#047857;">APPROVED</span>' : '<span style="color:#b45309;">VERIFIED</span>'}
            </td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#f1f5f9; font-weight:700;">
          <td colspan="3" style="padding:8px; border:1px solid #94a3b8; text-align:right; font-size:11px;">TOTALS:</td>
          <td style="padding:8px; border:1px solid #94a3b8; text-align:right; font-family:monospace;">PKR ${(summary.totalBaseSalary || 0).toLocaleString()}</td>
          <td style="padding:8px; border:1px solid #94a3b8; text-align:right; font-family:monospace; color:#047857;">PKR ${(summary.totalVerifiedCredits || 0).toLocaleString()}</td>
          <td style="padding:8px; border:1px solid #94a3b8; text-align:right; font-family:monospace; color:#b91c1c;">PKR ${(summary.totalExpenses || 0).toLocaleString()}</td>
          <td style="padding:8px; border:1px solid #94a3b8; text-align:right; font-family:monospace; color:#15803d; font-size:12px;">PKR ${(summary.totalFinalPayable || 0).toLocaleString()}</td>
          <td style="padding:8px; border:1px solid #94a3b8;"></td>
        </tr>
      </tfoot>
    </table>

    <!-- Signatures & Authorization Section -->
    <div style="margin-top:40px; display:grid; grid-template-columns:1fr 1fr; gap:40px;">
      <div style="border-top:1px solid #94a3b8; padding-top:8px; text-align:center;">
        <div style="font-weight:700; font-size:11px; color:#0f172a;">Prepared & Verified By (Admin 1)</div>
        <div style="font-size:10px; color:#64748b; margin-top:2px;">Signature & Date</div>
      </div>
      <div style="border-top:1px solid #94a3b8; padding-top:8px; text-align:center;">
        <div style="font-weight:700; font-size:11px; color:#0f172a;">Approved By (Senior Admin)</div>
        <div style="font-size:10px; color:#64748b; margin-top:2px;">Signature & Stamp (Passcode 9999)</div>
      </div>
    </div>
  `;

  document.body.appendChild(printContainer);

  const opt = {
    margin: [10, 10, 10, 10],
    filename: `Salary_Sheet_${month}_${runId}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    if (window.html2pdf) {
      await window.html2pdf().set(opt).from(printContainer).save();
    } else {
      window.print();
    }

    showToast(`✅ PDF ${opt.filename} generated successfully!`, 'success');

    // Log run to database
    await API.logEmergencyPdfRun({
      month,
      runId,
      totalEmployees: summary.totalEmployees || employees.length,
      totalPayable: summary.totalFinalPayable || 0,
      generatedBy: 'Admin'
    });

  } catch (err) {
    console.error('PDF export error:', err);
    showToast('Failed to export PDF: ' + err.message, 'error');
  } finally {
    if (document.body.contains(printContainer)) {
      document.body.removeChild(printContainer);
    }
  }
}

async function generateIndividualEmployeePDF(empId) {
  if (!currentEmergReport || !currentEmergReport.employees) return;
  const emp = currentEmergReport.employees.find(e => e.id === empId);
  if (!emp) {
    showToast('Employee record not found', 'error');
    return;
  }

  const month = currentEmergMonth || getCurrentMonthString();
  const monthTitle = new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const generatedAt = new Date().toLocaleString();

  showToast(`Generating Pay Slip PDF for ${emp.name}...`, 'info');

  const printContainer = document.createElement('div');
  printContainer.style.position = 'absolute';
  printContainer.style.left = '-9999px';
  printContainer.style.top = '-9999px';
  printContainer.style.width = '700px';
  printContainer.style.padding = '24px';
  printContainer.style.background = '#ffffff';
  printContainer.style.color = '#1e293b';
  printContainer.style.fontFamily = "'Inter', Arial, sans-serif";

  printContainer.innerHTML = `
    <div style="border:2px solid #0f172a; padding:20px; border-radius:8px;">
      <div style="border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:16px; text-align:center;">
        <h2 style="margin:0; font-size:18px; font-weight:800; color:#0f172a; text-transform:uppercase;">Office Attendance & Salary Management System</h2>
        <h3 style="margin:4px 0 0; font-size:14px; font-weight:600; color:#475569;">EMPLOYEE PAY SLIP — ${monthTitle.toUpperCase()}</h3>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; font-size:12px; background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;">
        <div><strong>Employee Name:</strong> ${escapeHtml(emp.name)}</div>
        <div><strong>Designation / Role:</strong> ${escapeHtml(emp.role || 'Staff')}</div>
        <div><strong>Pay Month:</strong> ${monthTitle}</div>
        <div><strong>Issue Date:</strong> ${generatedAt}</div>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px;">
        <thead>
          <tr style="background:#0f172a; color:#ffffff;">
            <th style="padding:8px; text-align:left; border:1px solid #334155;">Description</th>
            <th style="padding:8px; text-align:right; border:1px solid #334155;">Amount (PKR)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px; border:1px solid #cbd5e1;">Base Monthly Salary</td>
            <td style="padding:8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace; font-weight:600;">${fmtNum(emp.baseSalary)}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #cbd5e1; color:#047857;">Less: Verified Bank Advances / Credits Received</td>
            <td style="padding:8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace; color:#047857;">− ${fmtNum(emp.verifiedCredit)}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #cbd5e1; color:#b91c1c;">Less: Month Expense Deductions</td>
            <td style="padding:8px; text-align:right; border:1px solid #cbd5e1; font-family:monospace; color:#b91c1c;">− ${fmtNum(emp.expenses)}</td>
          </tr>
          <tr style="background:#f1f5f9; font-weight:800; font-size:13px;">
            <td style="padding:10px; border:2px solid #0f172a; color:#0f172a;">NET PAYABLE SALARY</td>
            <td style="padding:10px; text-align:right; border:2px solid #0f172a; font-family:monospace; color:#15803d;">PKR ${fmtNum(emp.finalPayable)}</td>
          </tr>
        </tbody>
      </table>

      <div style="font-size:10px; color:#64748b; margin-top:20px; border-top:1px solid #e2e8f0; padding-top:8px;">
        <div>Verification Status: <strong>${escapeHtml(emp.verificationStatus || 'VERIFIED')}</strong></div>
        <div>Approval Status: <strong>${escapeHtml(emp.approvalStatus || 'APPROVED')}</strong></div>
      </div>

      <div style="margin-top:36px; display:grid; grid-template-columns:1fr 1fr; gap:30px;">
        <div style="border-top:1px solid #94a3b8; padding-top:6px; text-align:center; font-size:11px;">
          Employer Signature
        </div>
        <div style="border-top:1px solid #94a3b8; padding-top:6px; text-align:center; font-size:11px;">
          Employee Acknowledgment Signature
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(printContainer);

  const opt = {
    margin: [10, 10, 10, 10],
    filename: `PaySlip_${emp.name.replace(/\s+/g, '_')}_${month}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    if (window.html2pdf) {
      await window.html2pdf().set(opt).from(printContainer).save();
    } else {
      window.print();
    }
    showToast(`✅ Pay slip downloaded for ${emp.name}`, 'success');
  } catch (err) {
    showToast('Failed to export Pay Slip PDF: ' + err.message, 'error');
  } finally {
    if (document.body.contains(printContainer)) {
      document.body.removeChild(printContainer);
    }
  }
}

function promptAndGenerateIndividualPDF() {
  if (!currentEmergReport || !currentEmergReport.employees || currentEmergReport.employees.length === 0) {
    showToast('No employee data loaded.', 'warning');
    return;
  }
  const empList = currentEmergReport.employees.map((e, idx) => `${idx + 1}. ${e.name}`).join('\n');
  const sel = prompt(`Select employee number for Pay Slip PDF:\n\n${empList}`);
  if (!sel) return;
  const num = parseInt(sel, 10);
  if (isNaN(num) || num < 1 || num > currentEmergReport.employees.length) {
    showToast('Invalid selection.', 'warning');
    return;
  }
  const targetEmp = currentEmergReport.employees[num - 1];
  generateIndividualEmployeePDF(targetEmp.id);
}

window.initEmergencySalaryGenerator = initEmergencySalaryGenerator;
window.loadEmergencySalaryGenerator = loadEmergencySalaryGenerator;
window.processAndVerifyEmergPDFs = processAndVerifyEmergPDFs;
window.openEmergReviewModal = openEmergReviewModal;
window.closeEmergReviewModal = closeEmergReviewModal;
window.saveEmergencyOverrideSubmit = saveEmergencyOverrideSubmit;
window.openEmergApproveModal = openEmergApproveModal;
window.openEmergWarningModal = openEmergWarningModal;
window.closeEmergWarningModal = closeEmergWarningModal;
window.triggerEmergencySalaryPDFExport = triggerEmergencySalaryPDFExport;
window.executeProgrammaticSalaryPDFExport = executeProgrammaticSalaryPDFExport;
window.generateIndividualEmployeePDF = generateIndividualEmployeePDF;
window.promptAndGenerateIndividualPDF = promptAndGenerateIndividualPDF;
window.handleSavePresentDays = handleSavePresentDays;
window.handleResetPresentDays = handleResetPresentDays;
window.handleSaveSundayBonus = handleSaveSundayBonus;
window.handleResetSundayBonus = handleResetSundayBonus;
window.handleDeleteEmployee = handleDeleteEmployee;
window.confirmDeleteEmployeeModal = confirmDeleteEmployeeModal;
window.handleArchiveSalaryEmployee = handleArchiveSalaryEmployee;
window.exportSalarySheetCSV = exportSalarySheetCSV;
window.updateRowSalaryLive = updateRowSalaryLive;
window.handleSetBasicSalary = handleSetBasicSalary;
window.updateSalarySummaryCards = updateSalarySummaryCards;
window.hasUnsavedSalaryEdits = hasUnsavedSalaryEdits;

