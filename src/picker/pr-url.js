/** Форма PR-ссылки и разбор номера из неё — чистая функция, без I/O. */

// Дублирует ровно то же в frontend-src/session-glyph.js, намеренно. Этот файл
// серверный: его require'ит session-open-helpers.js, и он обязан лежать под
// src/picker/, чтобы попасть в bundle.resources (`../src/picker/**/*` в
// tauri.conf.json) и доехать до установленного приложения на диске.
// session-glyph.js — фронтендовый: sessions.html грузит его как <script> без
// сборщика, и требовать из него серверный модуль браузер не может. Раньше
// session-open-helpers.js сам требовал '../../frontend-src/session-glyph' —
// frontend-src не входит в bundle.resources и не копируется деплоем (файлы
// пикера вшиты в бинарник через frontendDist), поэтому установленное
// приложение падало на MODULE_NOT_FOUND ещё в initModules().
//
// Расхождение между этой копией и той, что в session-glyph.js, ловит
// test/pr-url-parity.test.js: оба модуля прогоняются на одном наборе строк.

// Сегмент owner/repo — только то, что GitHub туда и пускает: буквы, цифры,
// точка, подчёркивание, дефис. Старая форма `[^/]+` («что угодно, кроме
// слэша») пропускала `&`, `|`, `"`, пробел и перевод строки внутри сегмента, а
// результат уходит в аргумент `cmd.exe /c start` без экранирования — сегмент
// вида `a&whoami` разбирал бы сам cmd.exe.
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/(\d+)$/;

/** Номер PR из ссылки, или пустая строка, если форма не та. */
function prNumber(url) {
  const m = PR_URL_RE.exec(url ?? '');
  return m ? m[1] : '';
}

module.exports = { PR_URL_RE, prNumber };
