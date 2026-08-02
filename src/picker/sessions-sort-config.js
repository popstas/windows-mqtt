const fs = require('fs');
const { normalizeSort, DEFAULT_SORT } = require('./session-groups');

const DEFAULT_SHOW_PATHS = true;

/**
 * Read the picker sort mode. Accepts either the module opts slice
 * (`modules.windows`) or the full loaded config.
 */
function readSessionsSortFromConfig(config) {
  const raw = config?.sessionsSort ?? config?.modules?.windows?.sessionsSort;
  return normalizeSort(raw);
}

/**
 * Sort mode for Home Assistant / openHASP slots.
 *
 * Optional override under `homeassistant.sessionsSort`; when absent or
 * commented out, inherits the picker `sessionsSort`.
 */
function readHaSessionsSort(config) {
  const ha = config?.homeassistant
    ?? config?.modules?.windows?.homeassistant;
  const override = ha?.sessionsSort;
  if (override !== undefined && override !== null && override !== '') {
    return normalizeSort(override);
  }
  return readSessionsSortFromConfig(config);
}

function normalizeShowPaths(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SHOW_PATHS;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on') return true;
  return DEFAULT_SHOW_PATHS;
}

/** Whether the picker shows the cwd line under each session. Default on. */
function readShowPathsFromConfig(config) {
  const raw = config?.showPaths ?? config?.modules?.windows?.showPaths;
  return normalizeShowPaths(raw);
}

/**
 * Insert or replace a scalar under the `windows:` block without dumping YAML.
 */
function setWindowsScalarInYaml(text, key, value) {
  const lines = String(text).split(/\r?\n/);
  const keyRe = new RegExp(`^(\\s*)${key}\\s*:\\s*.*$`);
  const rendered = `${key}: ${value}`;

  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) {
      const indent = lines[i].match(keyRe)[1];
      lines[i] = `${indent}${rendered}`;
      return lines.join('\n');
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)windows\s*:\s*(?:#.*)?$/);
    if (!m) continue;
    const indent = `${m[1]}  `;
    lines.splice(i + 1, 0, `${indent}${rendered}`);
    return lines.join('\n');
  }

  const suffix = lines[lines.length - 1] === '' ? '' : '\n';
  return `${text}${suffix}modules:\n  windows:\n    ${rendered}\n`;
}

/**
 * Surgical edit of config.yml text: set `sessionsSort` under `windows:`
 * without dumping the whole document (comments and ordering stay put).
 */
function setSessionsSortInYaml(text, sort) {
  return setWindowsScalarInYaml(text, 'sessionsSort', normalizeSort(sort));
}

function setShowPathsInYaml(text, showPaths) {
  return setWindowsScalarInYaml(text, 'showPaths', normalizeShowPaths(showPaths));
}

function writeSessionsSortFile(configPath, sort) {
  const mode = normalizeSort(sort);
  const current = fs.readFileSync(configPath, 'utf8');
  const next = setSessionsSortInYaml(current, mode);
  if (next !== current) fs.writeFileSync(configPath, next);
  return mode;
}

function writeShowPathsFile(configPath, showPaths) {
  const value = normalizeShowPaths(showPaths);
  const current = fs.readFileSync(configPath, 'utf8');
  const next = setShowPathsInYaml(current, value);
  if (next !== current) fs.writeFileSync(configPath, next);
  return value;
}

/**
 * Keep in-memory module opts (and optional full config) in sync, then write
 * the scalar into config.yml when a path is given.
 */
function persistSessionsSort({ moduleConfig, globalConfig, sort, configPath, writeFile = writeSessionsSortFile }) {
  const mode = normalizeSort(sort);
  if (moduleConfig && typeof moduleConfig === 'object') moduleConfig.sessionsSort = mode;
  if (globalConfig?.modules?.windows && typeof globalConfig.modules.windows === 'object') {
    globalConfig.modules.windows.sessionsSort = mode;
  }
  if (configPath) writeFile(configPath, mode);
  return mode;
}

function persistShowPaths({ moduleConfig, globalConfig, showPaths, configPath, writeFile = writeShowPathsFile }) {
  const value = normalizeShowPaths(showPaths);
  if (moduleConfig && typeof moduleConfig === 'object') moduleConfig.showPaths = value;
  if (globalConfig?.modules?.windows && typeof globalConfig.modules.windows === 'object') {
    globalConfig.modules.windows.showPaths = value;
  }
  if (configPath) writeFile(configPath, value);
  return value;
}

module.exports = {
  DEFAULT_SORT,
  DEFAULT_SHOW_PATHS,
  readSessionsSortFromConfig,
  readHaSessionsSort,
  readShowPathsFromConfig,
  normalizeShowPaths,
  setSessionsSortInYaml,
  setShowPathsInYaml,
  writeSessionsSortFile,
  writeShowPathsFile,
  persistSessionsSort,
  persistShowPaths,
};
