const fs = require('fs');
const path = require('path');

const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const searchPaths = [
  path.join(appData, 'Code', 'User', 'History'),
  path.join(appData, 'Code - Insiders', 'User', 'History')
];

console.log('Searching for backups in VS Code History...');

function searchDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      continue;
    }
    if (stat.isDirectory()) {
      searchDir(filePath);
    } else if (stat.isFile()) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('Muhammad Danish') || content.includes('Muhammad Ibrahim')) {
          console.log(`Found matching file: ${filePath} (${stat.size} bytes) - Last Modified: ${stat.mtime}`);
        }
      } catch (e) {}
    }
  }
}

for (const p of searchPaths) {
  console.log(`Checking ${p}...`);
  searchDir(p);
}
console.log('Search complete.');
