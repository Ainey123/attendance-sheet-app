/**
 * scripts/fix_stale_attendance.js
 * 
 * Safely finds and closes any historical unclosed attendance records (date < today)
 * by setting autoClockOut = true, clockOutTime = date + 'T23:59:59', and updating employee status.
 * DOES NOT delete any data.
 */

const db = require('../db');

async function runCleanup() {
  console.log('=== Running Stale Attendance Cleanup ===');
  try {
    await db.autoCompleteOldAttendance();
    console.log('=== Cleanup Finished Successfully ===');
    process.exit(0);
  } catch (err) {
    console.error('=== Error During Cleanup ===', err.message);
    process.exit(1);
  }
}

runCleanup();
