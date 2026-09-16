const fs = require('fs');
let code = fs.readFileSync('db.js', 'utf8');

if (!code.includes('let cachedSettings = null;')) {
    code = code.replace('let useLocalFallback = false;', 'let useLocalFallback = false;\nlet cachedSettings = null;\nlet lastSettingsFetch = 0;');
}

const oldGetSettings = `  async getSettings() {
    if (useLocalFallback) {
      const data = loadLocalData();
      const s = data.settings || {};
      return {
        adminPasscode: s.adminPasscode || '1234',
        seniorAdminPasscode: s.seniorAdminPasscode || '9999',
        officeName: s.officeName || 'My Office',
        adminToken: s.adminToken || null
      };
    }
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .single();
      if (error || !data) {
        return { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' };
      }
      return {
        ...data,
        seniorAdminPasscode: data.seniorAdminPasscode || '9999'
      };
    } catch (error) {
      return { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' };
    }
  },`;

const newGetSettings = `  async getSettings() {
    if (useLocalFallback) {
      const data = loadLocalData();
      const s = data.settings || {};
      return {
        adminPasscode: s.adminPasscode || '1234',
        seniorAdminPasscode: s.seniorAdminPasscode || '9999',
        officeName: s.officeName || 'My Office',
        adminToken: s.adminToken || null
      };
    }
    if (cachedSettings && (Date.now() - lastSettingsFetch < 60000)) {
        return cachedSettings;
    }
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .single();
      if (error || !data) {
        if (cachedSettings) return cachedSettings;
        return { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' };
      }
      cachedSettings = {
        ...data,
        seniorAdminPasscode: data.seniorAdminPasscode || '9999'
      };
      lastSettingsFetch = Date.now();
      return cachedSettings;
    } catch (error) {
      if (cachedSettings) return cachedSettings;
      return { adminPasscode: '1234', seniorAdminPasscode: '9999', officeName: 'My Office' };
    }
  },`;

code = code.replace(oldGetSettings, newGetSettings);

// Also invalidate cache on update
const oldUpdate = `  async updateSettings(newSettings) {`;
const newUpdate = `  async updateSettings(newSettings) {
    cachedSettings = null;`;
code = code.replace(oldUpdate, newUpdate);

fs.writeFileSync('db.js', code);
console.log('db.js patched for caching settings successfully!');
