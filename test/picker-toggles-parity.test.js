/**
 * Чекбоксы statusline описаны в двух местах: таблица PICKER_TOGGLES в
 * src/picker/sessions-sort-config.js (умолчания, запись в config.yml, проверка
 * входящего ключа) и таблица TOGGLE_CHECKS в sessions.html (сами чекбоксы и
 * подписи). Ничто их не связывает: опечатка в ключе пикера уедет в
 * `windows/claude-sessions-toggle`, там не пройдёт isPickerToggle и сядет в лог
 * предупреждением — чекбокс на экране есть, а нажимать его бесполезно.
 *
 * Проверка текстовая по той же причине, что и в picker-action-consistency:
 * sessions.html — страница, а не модуль, и require'ить её нельзя.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PICKER_TOGGLES } = require('../src/picker/sessions-sort-config');

const html = fs.readFileSync(path.join(__dirname, '..', 'sessions.html'), 'utf8');

/** Ключи из `const TOGGLE_CHECKS = [{ key: 'showPaths', label: 'paths' }, …]`. */
function pickerToggleKeys(source) {
  const block = /const\s+TOGGLE_CHECKS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(source);
  assert.ok(block, 'не нашёл TOGGLE_CHECKS в sessions.html');
  return [...block[1].matchAll(/\bkey\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/** Подписи оттуда же — по ним чекбокс узнают глазами. */
function pickerToggleLabels(source) {
  const block = /const\s+TOGGLE_CHECKS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(source);
  return [...block[1].matchAll(/\blabel\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/** Начальное состояние страницы: `let toggles = { showPaths: true, … }`. */
function pickerDefaults(source) {
  const block = /let\s+toggles\s*=\s*\{([\s\S]*?)\}\s*;/.exec(source);
  assert.ok(block, 'не нашёл начальное состояние toggles в sessions.html');
  const out = {};
  for (const m of block[1].matchAll(/(\w+)\s*:\s*(true|false)/g)) out[m[1]] = m[2] === 'true';
  return out;
}

test('каждый чекбокс пикера есть в PICKER_TOGGLES, и наоборот', () => {
  assert.deepStrictEqual(pickerToggleKeys(html).slice().sort(), Object.keys(PICKER_TOGGLES).sort());
});

// Чекбоксы перечисляют то же, что и строка списка: сначала левая половина
// (под именем сессии), потом правые колонки. Тот же порядок держит и таблица
// умолчаний — иначе два списка одного и того же расходятся.
test('порядок чекбоксов совпадает с порядком PICKER_TOGGLES', () => {
  assert.deepStrictEqual(pickerToggleKeys(html), Object.keys(PICKER_TOGGLES));
});

test('умолчания страницы совпадают с умолчаниями конфига', () => {
  // Первый показ рисуется до прихода первого пакета (см. beginShow): если
  // страница считает id включённым, а конфиг — выключенным, колонка мигнёт.
  assert.deepStrictEqual(pickerDefaults(html), PICKER_TOGGLES);
});

test('подписи чекбоксов короткие и не повторяются', () => {
  const labels = pickerToggleLabels(html);
  assert.strictEqual(labels.length, Object.keys(PICKER_TOGGLES).length);
  assert.strictEqual(new Set(labels).size, labels.length, 'две одинаковые подписи не различить');
  for (const label of labels) {
    assert.ok(label.length <= 10, `подпись «${label}» вытеснит подсказку меню из статуслайна`);
  }
});
