const { loadConfig } = require('./config-loader');

// Живой объект конфига процесса. Его ИДЕНТИЧНОСТЬ обязана сохраняться:
// src/helpers.js захватывает ссылку при загрузке модуля, и подмена ссылки
// здесь до него бы не доехала.
const config = loadConfig();

/**
 * Перечитать config.yml и вернуть СВЕЖИЙ объект, не трогая общий config.
 *
 * Ровно та семантика, что была у `delete require.cache` в midi.js: вызывающий
 * получает свою копию, остальной процесс продолжает жить со своей.
 */
function reload() {
  return loadConfig();
}

/**
 * Заменить содержимое общего config на месте — точка инъекции для тестов.
 */
function setConfig(next) {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, next);
}

module.exports = { config, reload, setConfig };
