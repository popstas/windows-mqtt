const fs = require('fs');
const { normalizeSort, DEFAULT_SORT } = require('./session-groups');

const DEFAULT_SHOW_PATHS = true;
const DEFAULT_SHOW_EVENT = true;

/**
 * Чекбоксы statusline пикера: ключ в `modules.windows` конфига → умолчание.
 *
 * Таблица, а не пятёрка одинаковых функций рядом: каждый чекбокс иначе тянул
 * бы за собой свои normalize/read/setInYaml/write/persist, свой обработчик в
 * windows.js и свою пару слушателей в пикере — восемь мест на переключатель,
 * и все восемь надо не забыть.
 *
 * Умолчания повторяют вид списка до появления чекбоксов: запрос, ответ, путь,
 * событие, деньги, контекст и хоткей проекта показывались всегда, короткий
 * id — только вместо события.
 *
 * Порядок здесь тот же, что и у чекбоксов в статуслайне: сначала то, что
 * рисуется слева, под именем сессии, потом правые колонки.
 */
const PICKER_TOGGLES = {
  // Левая половина строки: то, что стоит под именем сессии.
  showPrompt: true,
  showAnswer: true,
  showPaths: DEFAULT_SHOW_PATHS,
  // Правые колонки.
  showHotkey: true,
  showEvent: DEFAULT_SHOW_EVENT,
  showId: false,
  showCost: true,
  showContext: true,
};

/** Ключ из внешнего payload — сюда попадает то, что прислал пикер. */
function isPickerToggle(key) {
  return Object.prototype.hasOwnProperty.call(PICKER_TOGGLES, key);
}

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

function normalizeBool(raw, defaultValue) {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on') return true;
  return defaultValue;
}

function readWindowsBool(config, key, defaultValue) {
  const raw = config?.[key] ?? config?.modules?.windows?.[key];
  return normalizeBool(raw, defaultValue);
}

function normalizeToggle(key, raw) {
  return normalizeBool(raw, PICKER_TOGGLES[key]);
}

/** Значение одного чекбокса. Принимает и срез `modules.windows`, и весь конфиг. */
function readToggleFromConfig(config, key) {
  return readWindowsBool(config, key, PICKER_TOGGLES[key]);
}

/** Все чекбоксы разом — в таком виде они и уезжают в пикер вместе со списком. */
function readTogglesFromConfig(config) {
  const out = {};
  for (const key of Object.keys(PICKER_TOGGLES)) out[key] = readToggleFromConfig(config, key);
  return out;
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

function setToggleInYaml(text, key, value) {
  return setWindowsScalarInYaml(text, key, normalizeToggle(key, value));
}

function writeSessionsSortFile(configPath, sort) {
  const mode = normalizeSort(sort);
  const current = fs.readFileSync(configPath, 'utf8');
  const next = setSessionsSortInYaml(current, mode);
  if (next !== current) fs.writeFileSync(configPath, next);
  return mode;
}

function writeWindowsBoolFile(configPath, key, value, normalize) {
  const nextValue = normalize(value);
  const current = fs.readFileSync(configPath, 'utf8');
  const next = setWindowsScalarInYaml(current, key, nextValue);
  if (next !== current) fs.writeFileSync(configPath, next);
  return nextValue;
}

function writeToggleFile(configPath, key, value) {
  return writeWindowsBoolFile(configPath, key, value, raw => normalizeToggle(key, raw));
}

function persistWindowsBool({
  key, value, normalize, moduleConfig, globalConfig, configPath, writeFile,
}) {
  const next = normalize(value);
  if (moduleConfig && typeof moduleConfig === 'object') moduleConfig[key] = next;
  if (globalConfig?.modules?.windows && typeof globalConfig.modules.windows === 'object') {
    globalConfig.modules.windows[key] = next;
  }
  if (configPath) writeFile(configPath, next);
  return next;
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

function persistToggle({
  key, value, moduleConfig, globalConfig, configPath, writeFile = writeToggleFile,
}) {
  return persistWindowsBool({
    key,
    value,
    normalize: raw => normalizeToggle(key, raw),
    moduleConfig,
    globalConfig,
    configPath,
    writeFile: (path, next) => writeFile(path, key, next),
  });
}

module.exports = {
  DEFAULT_SORT,
  DEFAULT_SHOW_PATHS,
  DEFAULT_SHOW_EVENT,
  PICKER_TOGGLES,
  isPickerToggle,
  readSessionsSortFromConfig,
  readHaSessionsSort,
  readToggleFromConfig,
  readTogglesFromConfig,
  normalizeToggle,
  setSessionsSortInYaml,
  setToggleInYaml,
  writeSessionsSortFile,
  writeToggleFile,
  persistSessionsSort,
  persistToggle,
};
