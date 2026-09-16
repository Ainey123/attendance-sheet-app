const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

const oldFetch = `    if (response.status === 401) throw new Error('Unauthorized');`;

const newFetch = `    if (response.status === 401) {
      if (typeof Store !== 'undefined' && Store.savePasscode) Store.savePasscode('');
      localStorage.removeItem('attendance_admin_passcode');
      adminPasscode = '';
      const adminSec = document.getElementById('admin-section');
      if (adminSec && adminSec.classList.contains('active')) {
        adminSec.classList.remove('active');
        document.getElementById('employee-section').classList.add('active');
        document.getElementById('btn-admin-text').innerText = 'Admin Portal';
        loadEmployeesList();
      }
      throw new Error('Unauthorized');
    }`;

code = code.replace(oldFetch, newFetch);
fs.writeFileSync('public/app.js', code);
console.log('Fixed app.js fetchJson 401 logout!');
