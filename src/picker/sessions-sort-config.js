const fs = require('fs');
const { normalizeSort, DEFAULT_SORT } = require('./session-groups');

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

/**
 * Surgical edit of config.yml text: set `sessionsSort` under `windows:`
 * without dumping the whole document (comments and ordering stay put).
 */
function setSessionsSortInYaml(text, sort) {
  const mode = normalizeSort(sort);
  const lines = String(text).split(/\r?\n/);
  const sortLineRe = /^(\s*)sessionsSort\s*:\s*.*$/;

  for (let i = 0; i < lines.length; i++) {
    if (sortLineRe.test(lines[i])) {
      const indent = lines[i].match(sortLineRe)[1];
      lines[i] = `${indent}sessionsSort: ${mode}`;
      return lines.join('\n');
    }
  }

  // Key missing — insert right after the `windows:` line, indented one step
  // deeper than that line (YAML block mapping under modules.windows).
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)windows\s*:\s*(?:#.*)?$/);
    if (!m) continue;
    const indent = `${m[1]}  `;
    lines.splice(i + 1, 0, `${indent}sessionsSort: ${mode}`);
    return lines.join('\n');
  }

  // No windows block at all — append a minimal one. Rare: example configs
  // always have modules.windows; this is a last-resort safety net.
  const suffix = lines[lines.length - 1] === '' ? '' : '\n';
  return `${text}${suffix}modules:\n  windows:\n    sessionsSort: ${mode}\n`;
}

function writeSessionsSortFile(configPath, sort) {
  const mode = normalizeSort(sort);
  const current = fs.readFileSync(configPath, 'utf8');
  const next = setSessionsSortInYaml(current, mode);
  if (next !== current) fs.writeFileSync(configPath, next);
  return mode;
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

module.exports = {
  DEFAULT_SORT,
  readSessionsSortFromConfig,
  readHaSessionsSort,
  setSessionsSortInYaml,
  writeSessionsSortFile,
  persistSessionsSort,
};
