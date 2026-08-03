/** Счётчик повторного входа в файловый лог. Без I/O. */

// Одна строка не должна попасть в файл дважды. Путей в файл теперь два: log()
// пишет туда сам, и он же зовёт console, а console с этого момента тоже пишет в
// файл. Плюс rotateFile сообщает о своих сбоях через console.warn — то есть
// ошибка записи в файл способна вызвать запись в файл.
//
// Счётчик, а не флаг: вложенность здесь настоящая, и внутренний вызов не должен
// снимать защиту, поставленную внешним.
let depth = 0;

function enter() { depth += 1; }
function leave() { depth = Math.max(0, depth - 1); }
function isInside() { return depth > 0; }

/** Выполнить fn под защитой, опустив счётчик даже при исключении. */
function run(fn) {
  enter();
  try {
    return fn();
  } finally {
    leave();
  }
}

module.exports = { enter, leave, isInside, run };
