const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

function loadConfig() {
  try {
    const configPath = process.env.CONFIG || path.join(__dirname, '..', 'config.yml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(fileContents, {});
    return data;
  } catch (e) {
    console.error('Error loading config.yml:', e);
    return null;
  }
}

module.exports = loadConfig();