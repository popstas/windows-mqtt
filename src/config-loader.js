const fs = require('fs');
const yaml = require('js-yaml');
const { resolveAppFile } = require('./paths');

// Minimal, never-null shape so downstream consumers (helpers.log(), module
// loading) can dereference `config.mqtt`/`config.modules` without crashing when
// no config file is available at all (e.g. a fresh bundled install).
const SAFE_DEFAULT = { mqtt: {}, modules: {} };

function tryLoad(configPath) {
  const fileContents = fs.readFileSync(configPath, 'utf8');
  const data = yaml.load(fileContents, {});
  // yaml.load returns undefined/null for an empty document.
  return data || { ...SAFE_DEFAULT };
}

// `resolve` is injectable for testing; defaults to the real resolveAppFile.
function loadConfig(resolve = resolveAppFile) {
  try {
    return tryLoad(resolve('config.yml', 'CONFIG'));
  } catch (e) {
    console.error('Error loading config.yml:', e.message || e);
  }

  // No usable config.yml — fall back to the bundled example so the app still
  // starts (with defaults) instead of dying with a null config / dead tray.
  try {
    const examplePath = resolve('config.example.yml');
    const data = tryLoad(examplePath);
    console.error(
      `[warn] config.yml not found; using bundled example config (${examplePath}). ` +
      'Create a real config.yml in the app settings dir to configure the app.'
    );
    return data;
  } catch (e) {
    console.error('Error loading config.example.yml:', e.message || e);
  }

  console.error('[warn] no config file available; using safe default config.');
  return { ...SAFE_DEFAULT };
}

module.exports = { loadConfig, SAFE_DEFAULT };
