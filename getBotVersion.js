// Utility to get the bot version from package.json
const fs = require('fs');
const path = require('path');

function getBotVersion() {
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

module.exports = { getBotVersion };
