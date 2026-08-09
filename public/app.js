// ==========================================================================
// STATE MANAGEMENT & GLOBALS
// ==========================================================================
let allEmployees = [];
let selectedEmployee = null;
let userLocation = null;
let adminPasscode = '';
let currentView = 'employee'; // 'employee' or 'admin'
let activeShiftTimer = null;
let currentAdminTab = 'tab-dashboard';
let selectedDocumentImageBase64 = null;
let settings = {
  organizationName: 'Company Name',
  clockInRadius: 500
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
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
  getStats: () => fetchJson('/api/stats'),
  getAttendanceStatus: (employeeId) => fetchJson(`/api/attendance/status/${employeeId}`),
  getMonthlySummary: (month) => fetchJson(`/api/attendance/monthly-summary?month=${encodeURIComponent(month || '')}`),
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

// Helper: YYYY-MM-DD local format
function getLocalDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
  return adjustedDate.toISOString().split('T')[0];
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
  } else if (selectedEmployee.status === 'LEAVE') {
    btnIn.disabled = true;
    btnOut.disabled = true;
  } else {
    // Only enable clock-in when GPS location is available
    btnIn.disabled = !locationReady;
    btnOut.disabled = true;
  }

  // Update clock-in button tooltip/title to guide the user
  if (!locationReady && selectedEmployee.status !== 'IN' && selectedEmployee.status !== 'LEAVE') {
    btnIn.title = 'Please turn on your location to clock in';
  } else {
    btnIn.title = '';
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
      <div>
        <div class="emp-name">${emp.name}</div>
        <div class="emp-role">${emp.role || 'Staff'}</div>
      </div>
      <div>${statusDot}</div>
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
      updateEmployeeStatusBadge('OUT');
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
      updateEmployeeStatusBadge('OUT');
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
  document.getElementById('clockout-modal').classList.remove('hidden');
  document.getElementById('performance-notes').value = '';
  document.getElementById('clockout-starting-balance').value = '';
  document.getElementById('clockout-received').value = '';
  document.getElementById('clockout-expense').value = '';
  document.getElementById('clockout-balance').value = '';
  resetClockOutPhoto();
  document.getElementById('performance-notes').focus();
  
  // Pre-fill with today's existing values to prevent overwriting
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
  
  await updateAutoCalculatedBalance(getLocalDateString());
}

function closeClockOutModal() {
  document.getElementById('clockout-modal').classList.add('hidden');
  resetClockOutPhoto();
}

function handleClockOut() {
  if (!selectedEmployee) return;
  openClockOutModal();
}

async function submitClockOutDetails(e) {
  e.preventDefault();
  if (!selectedEmployee) return;

  const performanceNotes = document.getElementById('performance-notes').value.trim();
  const receivedAmount = document.getElementById('clockout-received').value;
  const expenseAmount = document.getElementById('clockout-expense').value;

  if (!performanceNotes) {
    showToast('Performance notes are required', 'error');
    return;
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
      updateEmployeeStatusBadge('OUT');
      await loadEmployeesList(selectedEmployee.id);
      updateClockButtonsDisabledState(false);
    } else {
      showToast(res.error || 'Clock out failed', 'error');
      updateClockButtonsDisabledState(false);
    }
  } catch (err) {
    showToast('Network error during clock out', 'error');
    updateClockButtonsDisabledState(false);
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
    const employees = await API.getEmployees();
    Store.saveEmployees(employees);
    const tbody = document.querySelector('#admin-roster-table tbody');
    tbody.innerHTML = '';

    if (employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Roster is empty. Register a staff member.</td></tr>';
      return;
    }

    employees.forEach(emp => {
      const tr = document.createElement('tr');
      const formattedDate = new Date(emp.dateCreated).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      
      const statusBadge = emp.status === 'IN' 
        ? '<span class="status-indicator status-in">Clocked In</span>' 
        : '<span class="status-indicator status-out">Clocked Out</span>';

      tr.innerHTML = `
        <td><strong>${emp.name}</strong></td>
        <td><span class="badge-role">${emp.role || 'Staff'}</span></td>
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

      // Delete listener
      tr.querySelector('.btn-delete-emp').addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
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

// Delete staff record (SOFT DELETE — all past data is preserved and visible in admin reports)
async function handleDeleteEmployee(id, name) {
  if (!confirm(`Are you sure you want to delete "${name}" from the active roster?\n\n✅ All their past attendance logs, work records, and expense history will be KEPT.\n❌ They will no longer be able to log in using their link.\n\nThis action archives the employee — it does NOT erase any data.`)) {
    return;
  }

  try {
    const res = await API.deleteEmployee(id);
    if (res && res.success) {
      showToast(`✅ ${name} archived successfully. All their past data is preserved.`, 'success');
      loadAdminRoster();
    } else {
      const msg = (res && res.error) ? res.error : 'Failed to archive employee';
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

  const btnTriggerUpload = document.getElementById('btn-trigger-pdf-upload');
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
  const selectedMonth = (monthInput && monthInput.value) ? monthInput.value : getCurrentMonthString();
  const tbody = document.querySelector('#monthly-summary-table tbody');
  
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading and analyzing monthly attendance data...</td></tr>';
  }

  try {
    const res = await API.getMonthlySummary(selectedMonth);
    let summaryData = (res && res.summaries) ? res.summaries : [];
    const daysInMonth = res.daysInMonth || 31;
    const daysEvaluated = res.daysEvaluated || 31;

    // Merge text extracted from uploaded PDFs into summary metrics
    if (parsedPDFTextData.length > 0) {
      summaryData = mergePDFTextIntoSummaryData(summaryData, parsedPDFTextData, selectedMonth, daysEvaluated);
    }

    currentMonthlySummaryResults = {
      month: selectedMonth,
      daysInMonth,
      daysEvaluated,
      summaries: summaryData
    };

    // Render the Full Day-by-Day Monthly Attendance Sheet Grid Table
    await renderMonthlyGridSheetUI(selectedMonth);

    // Update Summary Header Title
    const titleEl = document.getElementById('summary-month-title');
    if (titleEl) {
      const dateObj = new Date(`${selectedMonth}-01T00:00:00`);
      const monthName = isNaN(dateObj.getTime()) ? selectedMonth : dateObj.toLocaleDateString([], { month: 'long', year: 'numeric' });
      const workDays = res.workingDaysToEvaluate || daysEvaluated;
      titleEl.innerText = `Monthly Employee Attendance Summary — ${monthName} (${workDays} Working Days Evaluated, Sundays Off)`;
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
      tbody.innerHTML = '<tr><td colspan="9" class="table-empty">Failed to load monthly summary report.</td></tr>';
    }
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
          empEntry.presentDates.add(dateStr);

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

    summaryMap.forEach((empEntry, nameKey) => {
      const escapedName = nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${escapedName}[\\s\\S]*?\\b(${selectedMonth}-\\d{2})\\b`, 'gi');
      let m;
      while ((m = pattern.exec(text)) !== null) {
        if (m[1]) {
          empEntry.presentDates.add(m[1]);
        }
      }
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
  const dateObj = new Date(`${monthStr}-01T00:00:00`);
  const monthDisplay = isNaN(dateObj.getTime()) ? monthStr : dateObj.toLocaleDateString([], { month: 'long', year: 'numeric' });

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
        <h1 style="font-size: 20px; margin: 0; color: #4f46e5; text-transform: uppercase; font-weight: 800;">MONTHLY ATTENDANCE & EXPENSE SUMMARY</h1>
        <div style="font-size: 14px; color: #4b5563; margin-top: 4px;">Month: <strong>${monthDisplay}</strong> (${currentMonthlySummaryResults.daysEvaluated} Days Evaluated)</div>
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
      let msg = "You expired your link for 1 time";
      if (count === 2) {
        msg = "You expired it for 2nd time";
      } else if (count > 2) {
        msg = `You expired your link for ${count} times`;
      }
      promptMsg.innerText = msg;
      modal.classList.remove('hidden');

      const btnClose = document.getElementById('btn-close-link-expiry-modal');
      if (btnClose) {
        btnClose.onclick = () => {
          modal.classList.add('hidden');
          sessionStorage.setItem('seenExpiryNotice_' + employee.id, 'true');
        };
      }
    }
    const toastMsg = count === 1 
      ? "Notice: You expired your link for 1 time" 
      : (count === 2 ? "Notice: You expired it for 2nd time" : `Notice: You expired your link for ${count} times`);
    showToast(toastMsg, 'warning');
  }
}

async function renderMonthlyGridSheetUI(monthStr) {
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
    if (activeEmps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (daysInMonth + 4) + '" class="table-empty">No active staff members found for this month.</td></tr>';
      return;
    }

    tbody.innerHTML = '';

    activeEmps.forEach((emp, idx) => {
      const empDays = empAttendanceMap.get(emp.id) || {};
      let presentCount = 0;
      let rowHtml = `<tr>
        <td style="font-weight: bold; color: var(--text-muted); background: var(--bg-card, #1e293b); position: sticky; left: 0; z-index: 1;">${idx + 1}</td>
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

      // Spacer row between employees
      const spacerHtml = `<tr style="height: 4px;"><td colspan="${daysInMonth + 4}" style="padding:0; border:none; background: transparent;"></td></tr>`;

      tbody.insertAdjacentHTML('beforeend', rowHtml + spacerHtml);
    });

  } catch (err) {
    console.error('Error rendering grid sheet UI:', err);
    tbody.innerHTML = '<tr><td colspan="' + (daysInMonth + 4) + '" class="table-empty">Failed to load attendance grid sheet.</td></tr>';
  }
}


