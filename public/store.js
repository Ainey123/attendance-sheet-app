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
   * @param {string} passcode
   */
  function savePasscode(passcode) {
    try {
      localStorage.setItem(PASSCODE_KEY, passcode);
    } catch (e) {
      console.error('Failed to save admin passcode to localStorage', e);
    }
  }

  /**
   * Load admin passcode from localStorage.
   * Returns empty string if not set.
   * @returns {string}
   */
  function loadPasscode() {
    try {
      return localStorage.getItem(PASSCODE_KEY) || '';
    } catch (e) {
      console.error('Failed to load admin passcode from localStorage', e);
      return '';
    }
  }

  // Expose public API
  return {
    saveEmployees,
    loadEmployees,
    savePasscode,
    loadPasscode,
  };
})();
