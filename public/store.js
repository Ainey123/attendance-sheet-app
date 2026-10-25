/**
 * Store utility for persisting data in localStorage.
 * Provides simple getters and setters for employees list and admin passcode.
 */
const Store = (function() {
  const EMPLOYEES_KEY = 'attendance_employees';
  const PASSCODE_KEY = 'attendance_admin_passcode';

  /**
   * Save the full employees array to localStorage.
   * @param {Array} employees
   */
  function saveEmployees(employees) {
    try {
      const json = JSON.stringify(employees);
      localStorage.setItem(EMPLOYEES_KEY, json);
    } catch (e) {
      console.error('Failed to save employees to localStorage', e);
    }
  }

  /**
   * Load employees array from localStorage.
   * Returns null if not present or parsing fails.
   * @returns {Array|null}
   */
  function loadEmployees() {
    try {
      const json = localStorage.getItem(EMPLOYEES_KEY);
      return json ? JSON.parse(json) : null;
    } catch (e) {
      console.error('Failed to load employees from localStorage', e);
      return null;
    }
  }

  /**
   * Save admin passcode to localStorage.
   * NOTE: Admin passcodes are not persisted in localStorage to ensure the Admin Panel
   * always requires manual authentication upon clicking and never logs in without a password.
   * @param {string} passcode
   */
  function savePasscode(passcode) {
    try {
      if (!passcode) {
        localStorage.removeItem(PASSCODE_KEY);
      }
    } catch (e) {}
  }

  /**
   * Load admin passcode.
   * Always returns empty string so Admin Panel strictly requires manual password entry.
   * @returns {string}
   */
  function loadPasscode() {
    try {
      localStorage.removeItem(PASSCODE_KEY);
    } catch (e) {}
    return '';
  }

  /**
   * Clear admin passcode from localStorage.
   */
  function clearPasscode() {
    try {
      localStorage.removeItem(PASSCODE_KEY);
    } catch (e) {}
  }

  // Expose public API
  return {
    saveEmployees,
    loadEmployees,
    savePasscode,
    loadPasscode,
    clearPasscode,
  };
})();
