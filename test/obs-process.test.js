const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseTasklist, processRunning, OBS_PROCESS } = require('../src/modules/obs-helpers');

const ROOT = path.join(__dirname, '..');

test('строка tasklist со своим процессом читается как «работает»', () => {
  const out = '"obs64.exe","12345","Console","1","345 678 K"\r\n';
  assert.strictEqual(parseTasklist(out, 'obs64.exe'), true);
  // Регистр имени процесса Windows не различает, и tasklist печатает его так,
  // как записано на диске: сравнение с точностью до регистра врало бы через раз.
  assert.strictEqual(parseTasklist('"OBS64.EXE","1","Console","1","1 K"', 'obs64.exe'), true);
});

test('пустой ответ tasklist читается как «не работает»', () => {
  // Фильтр без совпадений печатает не пустоту, а фразу — в stdout и с кодом 0.
  // Проверка «в выводе есть хоть что-то» на ней сказала бы «работает».
  const out = 'INFO: No tasks are running which match the specified criteria.\r\n';
  assert.strictEqual(parseTasklist(out, 'obs64.exe'), false);
  assert.strictEqual(parseTasklist('', 'obs64.exe'), false);
});

test('совпадает имя целиком, а не кусок строки', () => {
  // Имя сверяется с первым полем CSV, а не ищется по всему выводу: заголовок
  // окна или путь, случайно содержащий имя, дал бы ложное «работает».
  assert.strictEqual(parseTasklist('"notobs64.exe","1","Console","1","1 K"', 'obs64.exe'), false);
  assert.strictEqual(parseTasklist('"other.exe","1","Console","1","obs64.exe"', 'obs64.exe'), false);
});

test('процесс спрашивается фильтром по имени, а не перечислением всего', () => {
  // Спрашивают раз в пять секунд, пока OBS закрыт, то есть почти всегда.
  // Перечисление всех процессов стоило бы на порядок дороже фильтра.
  let cmd = '';
  processRunning('obs64.exe', (c) => { cmd = c; return ''; });
  assert.match(cmd, /IMAGENAME eq obs64\.exe/i);
  assert.match(cmd, /\/NH/i, 'заголовок таблицы мешал бы разбору первого поля');
});

test('отказ tasklist читается как «не работает», а не роняет модуль', () => {
  // На не-Windows программы нет вовсе, и это норма: модуль просто не полезет
  // подключаться. Падение здесь стоило бы всего процесса — модуль грузится
  // в общем с остальными.
  const boom = () => { throw new Error('tasklist: command not found'); };
  assert.strictEqual(processRunning('obs64.exe', boom), false);
});

test('имя процесса OBS названо один раз', () => {
  assert.strictEqual(OBS_PROCESS, 'obs64.exe');
});

test('модуль obs не зависит от windows11-manager', () => {
  // Зависимость держалась на одном вызове `findWindow`, а стоила junction на
  // соседний репозиторий: его обходила сборка, его отдельно копировал
  // deploy-fast, и он же молча не читался через сетевой логон ssh.
  // Сторожится `require`, а не слово: почему зависимости здесь больше нет,
  // объяснено комментарием в самом файле, и запрет на упоминание стёр бы
  // объяснение вместе с запретом.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'obs.js'), 'utf8');
  assert.doesNotMatch(
    src,
    /require\(\s*['"]windows11-manager['"]/,
    'obs.js снова требует windows11-manager',
  );
});

test('windows11-manager не значится в зависимостях пакета', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    assert.ok(
      !(pkg[field] || {})['windows11-manager'],
      `windows11-manager вернулся в ${field}`,
    );
  }
});
