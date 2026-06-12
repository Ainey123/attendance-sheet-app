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
let settings = {
  organizationName: 'Company Name',
  clockInRadius: 500
};

// Base API endpoints
const API = {
  getSettings: () => fetch('/api/settings').then(r => r.json()),
  getEmployees: () => fetch('/api/employees', {
    headers: { 'X-Admin-Passcode': adminPasscode }
  }).then(r => r.json()),
  verifyPasscode: (passcode) => fetch('/api/settings/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode })
  }).then(r => r.json()),
  updateSettings: (data) => fetch('/api/settings/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  getEmployeeByToken: (token) => fetch(`/api/employees/token/${token}`).then(r => r.json()),
  addEmployee: (name, role) => fetch('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': adminPasscode },
    body: JSON.stringify({ name, role })
  }).then(r => r.json()),
  deleteEmployee: (id) => fetch(`/api/employees/${id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Passcode': adminPasscode }
  }).then(r => r.json()),
  getStats: () => fetch('/api/stats').then(r => r.json()),
  getAttendanceStatus: (employeeId) => fetch(`/api/attendance/status/${employeeId}`).then(r => r.json()),
  getAttendanceLogs: (date) => {
    let url = '/api/attendance';
    if (date) url += `?date=${date}`;
    return fetch(url, {
      headers: { 'X-Admin-Passcode': adminPasscode }
    }).then(r => r.json());
  },
  clockIn: (employeeId, location) => fetch('/api/attendance/clock-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, location })
  }).then(r => r.json()),
  clockOut: (employeeId, location, performanceNotes, moneySpent, image) => fetch('/api/attendance/clock-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, location, performanceNotes, moneySpent, image })
  }).then(r => r.json()),
  verifyEmployeePin: (employeeId, pin) => fetch('/api/employees/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, pin })
  }).then(r => r.json()),
  updateEmployeePin: (employeeId, oldPin, newPin) => fetch('/api/employees/update-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, oldPin, newPin })
  }).then(r => r.json()),
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
    fetch(`/api/work-records/${id}?employeeId=${encodeURIComponent(employeeId)}`, { method: 'DELETE' }).then(r => r.json())
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
  
  locCard.className = 'location-status-card';
  locIcon.className = 'loc-icon spinner';
  locTitle.innerText = 'Detecting GPS Location...';
  locText.innerText = 'Attendance registry requires location permissions.';
  btnRetry.classList.add('hidden');
  if (mapContainer) mapContainer.classList.add('hidden');

  if (!navigator.geolocation) {
    locCard.classList.add('error');
    locIcon.className = 'loc-icon';
    locTitle.innerText = 'GPS Not Available';
    locText.innerText = 'Clock in/out will work without GPS. Location will not be recorded.';
    btnRetry.classList.add('hidden');
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
      locTitle.innerText = 'GPS Location Secured';
      locText.innerText = `Coordinates: ${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)} (±${Math.round(userLocation.accuracy)}m)`;
      
      if (mapContainer) {
        mapContainer.innerHTML = `<iframe width="100%" height="100%" frameborder="0" scrolling="no" marginheight="0" marginwidth="0" src="https://www.openstreetmap.org/export/embed.html?bbox=${userLocation.longitude-0.005},${userLocation.latitude-0.005},${userLocation.longitude+0.005},${userLocation.latitude+0.005}&layer=mapnik&marker=${userLocation.latitude},${userLocation.longitude}"></iframe>`;
        mapContainer.classList.remove('hidden');
      }

      updateClockButtonsDisabledState(false);
    },
    (error) => {
      userLocation = null;
      locCard.classList.add('error');
      locIcon.className = 'loc-icon';
      btnRetry.classList.remove('hidden');
      if (mapContainer) mapContainer.classList.add('hidden');
      
      let errMsg = 'Location permission denied. Please allow GPS to verify check-in location.';
      if (error.code === error.POSITION_UNAVAILABLE) {
        errMsg = 'Location information is unavailable. Please try again.';
      } else if (error.code === error.TIMEOUT) {
        errMsg = 'Request to get location timed out. Please try again.';
      }
      
      locTitle.innerText = 'GPS Unavailable';
      locText.innerText = `${errMsg} You can still clock in/out without location.`;
      
      updateClockButtonsDisabledState(false);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

// Enable/disable clock buttons from employee selection and shift status (GPS is optional)
function updateClockButtonsDisabledState(disableAll = false) {
  const btnIn = document.getElementById('btn-clock-in');
  const btnOut = document.getElementById('btn-clock-out');
  if (!btnIn || !btnOut) return;

  if (disableAll || !selectedEmployee) {
    btnIn.disabled = true;
    btnOut.disabled = true;
    return;
  }

  if (selectedEmployee.status === 'IN') {
    btnIn.disabled = true;
    btnOut.disabled = false;
  } else {
    btnIn.disabled = false;
    btnOut.disabled = true;
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
  await loadSelectedEmployeeLogs(employee.id);
}

// Helper status badges
function updateEmployeeStatusBadge(status) {
  const badge = document.getElementById('selected-employee-status');
  const activeShiftCard = document.getElementById('active-shift-card');
  
  if (status === 'IN') {
    badge.innerText = 'Clocked In';
    badge.className = 'status-indicator status-in';
    activeShiftCard.classList.remove('hidden');
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

    if (isActiveShift) {
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

    updateClockButtonsDisabledState(false);
  } catch (err) {
    timeline.innerHTML = '<div class="timeline-empty">Failed to load shifts.</div>';
    updateClockButtonsDisabledState(false);
  }
}

// Clock In trigger
async function handleClockIn() {
  if (!selectedEmployee) return;
  const originalBtn = document.getElementById('btn-clock-in');
  const btnText = originalBtn.querySelector('.btn-text-large');
  
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

function openClockOutModal() {
  document.getElementById('clockout-modal').classList.remove('hidden');
  document.getElementById('performance-notes').value = '';
  document.getElementById('money-spent').value = '';
  resetClockOutPhoto();
  document.getElementById('performance-notes').focus();
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
  const moneySpent = document.getElementById('money-spent').value;

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
      moneySpent,
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

    tr.innerHTML = `
      <td><strong>${log.employeeName}</strong></td>
      <td><span class="badge-role">${log.role || 'Staff'}</span></td>
      <td>${log.date}</td>
      <td style="color: var(--color-success)">${formatDateTime(log.clockInTime)}</td>
      <td style="color: ${log.clockOutTime ? 'var(--color-danger)' : 'var(--text-muted)'}">
        ${log.clockOutTime ? formatDateTime(log.clockOutTime) : 'Active'}
      </td>
      <td><strong>${durationText}</strong></td>
      <td>${renderLocationLink(log.clockInLocation)}</td>
      <td>${renderLocationLink(log.clockOutLocation)}</td>
      <td>${renderPhotoLink(log.image)}</td>
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

// Delete staff record
async function handleDeleteEmployee(id, name) {
  if (!confirm(`Are you sure you want to delete ${name} from the staff registry?\nTheir past attendance logs will be preserved, but they will no longer be able to log in.`)) {
    return;
  }

  try {
    const res = await API.deleteEmployee(id);
    if (res.success) {
      showToast(`${name} deleted successfully`, 'success');
      loadAdminRoster();
    } else {
      showToast(res.error || 'Failed to delete employee', 'error');
    }
  } catch (err) {
    showToast('Connection error during deletion', 'error');
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
  const headers = ['Employee Name', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration (Minutes)', 'Clock In Lat', 'Clock In Lng', 'Clock Out Lat', 'Clock Out Lng', 'Performance Notes', 'Money Spent ($)', 'Photo Attached'];
  
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

    const headers = ['Employee Name', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration (Minutes)', 'Clock In Lat', 'Clock In Lng', 'Clock Out Lat', 'Clock Out Lng', 'Performance Notes', 'Money Spent ($)', 'Photo Attached'];
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
  } else {
    grid.classList.remove('work-record-active');
  }
}

function renderWorkRecordRows(records, tbodySelector, allowDelete) {
  const tbody = document.querySelector(`${tbodySelector} tbody`);
  tbody.innerHTML = '';

  if (!records.length) {
    const cols = allowDelete ? 9 : 8;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="table-empty">No entries for this month yet.</td></tr>`;
    return;
  }

  records.forEach((rec, idx) => {
    const tr = document.createElement('tr');
    const payment = rec.paymentIssuance != null ? rec.paymentIssuance.toLocaleString() : '—';
    tr.innerHTML = `
      <td class="col-sn">${idx + 1}</td>
      <td>${formatWorkDateDisplay(rec.date)}</td>
      <td class="col-work">${rec.performedWork || '—'}</td>
      <td>${payment}</td>
      <td>${rec.balancePayment || '—'}</td>
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
    paymentIssuance: document.getElementById('work-entry-payment').value,
    balancePayment: document.getElementById('work-entry-balance').value,
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
      document.getElementById('work-entry-balance').value = '';
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
        '<tr><td colspan="8" class="table-empty">Select an employee and month to view records.</td></tr>';
      return;
    }

    const employee = employees.find(e => e.id === employeeId);
    const profile = await API.getWorkProfile(employeeId, month);
    currentAdminWorkRecords = await API.getWorkRecords(employeeId, month);
    if (!Array.isArray(currentAdminWorkRecords)) currentAdminWorkRecords = [];

    const totalPayment = currentAdminWorkRecords.reduce((sum, r) => sum + (r.paymentIssuance || 0), 0);

    document.getElementById('admin-work-summary').classList.remove('hidden');
    document.getElementById('admin-work-summary-name').textContent = employee ? employee.name : '—';
    document.getElementById('admin-work-summary-father').textContent = profile.fatherName || '—';
    document.getElementById('admin-work-summary-count').textContent = currentAdminWorkRecords.length;
    document.getElementById('admin-work-summary-payment').textContent = totalPayment.toLocaleString();

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
  const headers = ['S.No', 'Date', 'Performed Work', 'Payment Issuance', 'Balance Payment', 'Material Issuance', 'Material Balance', 'Other Remarks'];
  const rows = [headers.join(',')];
  currentAdminWorkRecords.forEach((rec, idx) => {
    rows.push([
      idx + 1,
      formatWorkDateDisplay(rec.date),
      `"${(rec.performedWork || '').replace(/"/g, '""')}"`,
      rec.paymentIssuance != null ? rec.paymentIssuance : '',
      `"${(rec.balancePayment || '').replace(/"/g, '""')}"`,
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

    const headers = ['S.No', 'Employee Name', 'Date', 'Performed Work', 'Payment Issuance', 'Balance Payment', 'Material Issuance', 'Material Balance', 'Other Remarks'];
    const rows = [headers.join(',')];

    records.forEach((rec, idx) => {
      rows.push([
        idx + 1,
        `"${(rec.employeeName || '').replace(/"/g, '""')}"`,
        formatWorkDateDisplay(rec.date),
        `"${(rec.performedWork || '').replace(/"/g, '""')}"`,
        rec.paymentIssuance != null ? rec.paymentIssuance : '',
        `"${(rec.balancePayment || '').replace(/"/g, '""')}"`,
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
    document.getElementById('progress-total-spent').textContent = `$${totalMoneySpent.toLocaleString()}`;
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
      const moneySpent = item.data.moneySpent ? `$${item.data.moneySpent.toLocaleString()}` : '$0';
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
      const payment = item.data.paymentIssuance ? `$${item.data.paymentIssuance.toLocaleString()}` : '$0';
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
      <td>$${totalMoneySpent.toLocaleString()}</td>
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
// PWA INSTALLATION LOGIC
// ==========================================================================
let deferredPrompt;
const installBtn = document.getElementById('btn-install-app');

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI to notify the user they can install the PWA
  if (installBtn) {
    installBtn.style.display = 'flex';
  }
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      // We've used the prompt, and can't use it again, throw it away
      deferredPrompt = null;
      // Hide the install button
      installBtn.style.display = 'none';
    }
  });
}

window.addEventListener('appinstalled', () => {
  // Hide the app-provided install promotion
  if (installBtn) installBtn.style.display = 'none';
  // Clear the deferredPrompt so it can be garbage collected
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

function handleEmployeeLogout() {
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

  // Admin work records
  document.getElementById('admin-work-employee').addEventListener('change', loadAdminWorkRecords);
  document.getElementById('admin-work-month').addEventListener('change', loadAdminWorkRecords);
  document.getElementById('btn-export-work-csv').addEventListener('click', exportWorkRecordsToCSV);
  document.getElementById('btn-export-all-work-csv').addEventListener('click', exportAllEmployeesWorkRecordsToCSV);
  document.getElementById('admin-work-month').value = getCurrentMonthString();

  // Work Progress dashboard
  document.getElementById('progress-date-filter').addEventListener('change', loadWorkProgress);
  document.getElementById('btn-refresh-progress').addEventListener('click', loadWorkProgress);

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
