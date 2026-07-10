const fs = require('fs');
const yaml = require('js-yaml');
const { resolveAppFile } = require('./paths');

function loadConfig() {
  try {
    const configPath = resolveAppFile('config.yml', 'CONFIG');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(fileContents, {});
    return data;
  } catch (e) {
    console.error('Error loading config.yml:', e);
    return null;
  }
}

module.exports = loadConfig();
