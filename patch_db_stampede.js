const fs = require('fs');
let code = fs.readFileSync('db.js', 'utf8');

const oldCode = `let cachedSettings = null;
let lastSettingsFetch = 0;`;

const newCode = `let cachedSettings = null;
let lastSettingsFetch = 0;
let settingsFetchPromise = null;`;

code = code.replace(oldCode, newCode);

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
    
    // Cache stampede prevention
    if (settingsFetchPromise) {
      try {
        await settingsFetchPromise;
        if (cachedSettings) return cachedSettings;
      } catch(e) {}
    }
    
    settingsFetchPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('*')
          .single();
        if (error || !data) {
          throw new Error('Supabase fetch failed');
        }
        cachedSettings = {
          ...data,
          seniorAdminPasscode: data.seniorAdminPasscode || '9999'
        };
        lastSettingsFetch = Date.now();
      } finally {
        settingsFetchPromise = null;
      }
    })();
    
    try {
      await settingsFetchPromise;
    } catch (error) {
      if (cachedSettings) return cachedSettings;
      return { adminPasscode: '1290', seniorAdminPasscode: '9999', officeName: 'My Office' };
    }
    return cachedSettings || { adminPasscode: '1290', seniorAdminPasscode: '9999', officeName: 'My Office' };
  },`;

code = code.replace(oldGetSettings, newGetSettings);
fs.writeFileSync('db.js', code);
console.log('Cache stampede fix applied!');
