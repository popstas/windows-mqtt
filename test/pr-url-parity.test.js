// PR-номер разбирается в двух местах намеренно (см. комментарии в
// src/picker/pr-url.js и frontend-src/session-glyph.js): один — серверный
// модуль, попадающий в bundle.resources, второй — фронтендовая копия,
// которую sessions.html грузит как <script> без сборщика. Дублирование само
// по себе не баг, но расхождение между копиями — баг, и ловить его руками
// после каждой правки регулярки ненадёжно. Этот тест прогоняет оба модуля на
// одном наборе строк и требует одинакового результата.
const { test } = require('node:test');
const assert = require('node:assert');
const serverPrUrl = require('../src/picker/pr-url');
const frontendGlyph = require('../frontend-src/session-glyph');

const CASES = [
  // Валидные ссылки — совпадать должны и результат, и сам номер.
  'https://github.com/popstas/ccfzf/pull/3',
  'https://github.com/popstas/ccfzf/pull/128',
  'https://github.com/a.b_c-d/e.f_g-h/pull/1',
  '',
  undefined,
  null,
  // Неправильная схема / хост / путь.
  'http://github.com/a/b/pull/1',
  'https://github.com.evil.tld/a/b/pull/1',
  'https://github.com/a/b/issues/1',
  // Хвост после номера — уже отвергается формой $-якоря, но проверяем и его.
  'https://github.com/a/b/pull/1 && calc.exe',
  // Полезная нагрузка ВНУТРИ сегмента owner/repo, а не после номера — то, что
  // пропускала старая `[^/]+`.
  'https://github.com/a&whoami/b/pull/1',
  'https://github.com/a/b|whoami/pull/1',
  'https://github.com/a"whoami/b/pull/1',
  'https://github.com/a b/whoami/pull/1',
  'https://github.com/a\nwhoami/b/pull/1',
  'https://github.com/a<script>/b/pull/1',
];

test('prNumber agrees between src/picker/pr-url.js and frontend-src/session-glyph.js on every case', () => {
  for (const input of CASES) {
    const fromServer = serverPrUrl.prNumber(input);
    const fromFrontend = frontendGlyph.prNumber(input);
    assert.strictEqual(
      fromServer,
      fromFrontend,
      `prNumber(${JSON.stringify(input)}) diverged: server=${JSON.stringify(fromServer)} frontend=${JSON.stringify(fromFrontend)}`,
    );
  }
});

test('both copies reject a hostile segment that would land unescaped in cmd.exe /c start', () => {
  const hostile = [
    'https://github.com/a&whoami/b/pull/1',
    'https://github.com/a/b|whoami/pull/1',
    'https://github.com/a"whoami/b/pull/1',
    'https://github.com/a b/whoami/pull/1',
    'https://github.com/a\nwhoami/b/pull/1',
  ];
  for (const url of hostile) {
    assert.strictEqual(serverPrUrl.prNumber(url), '', `server accepted hostile url: ${url}`);
    assert.strictEqual(frontendGlyph.prNumber(url), '', `frontend accepted hostile url: ${url}`);
  }
});

test('both copies still accept the plain, valid shape', () => {
  const url = 'https://github.com/popstas/ccfzf/pull/3';
  assert.strictEqual(serverPrUrl.prNumber(url), '3');
  assert.strictEqual(frontendGlyph.prNumber(url), '3');
});
