const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULTS,
  toWindowsPath,
  isCursorProcessPath,
  availableActions,
  buildTerminalRemote,
  buildOpenCommands,
  buildDumpRefreshCommand,
} = require('../src/picker/session-open-helpers');

test('toWindowsPath maps home-relative cwd to V: drive', () => {
  assert.strictEqual(
    toWindowsPath('/home/popstas/projects/shell/ccfzf'),
    'V:\\projects\\shell\\ccfzf',
  );
});

test('toWindowsPath maps home itself to the drive root', () => {
  assert.strictEqual(toWindowsPath('/home/popstas'), 'V:\\');
  assert.strictEqual(toWindowsPath('/home/popstas/'), 'V:\\');
});

test('toWindowsPath strips a trailing slash on nested paths', () => {
  assert.strictEqual(
    toWindowsPath('/home/popstas/projects/x/'),
    'V:\\projects\\x',
  );
});

test('toWindowsPath returns null outside home', () => {
  assert.strictEqual(toWindowsPath('/opt/other'), null);
  assert.strictEqual(toWindowsPath('/home/other/x'), null);
  assert.strictEqual(toWindowsPath(''), null);
  assert.strictEqual(toWindowsPath(null), null);
});

test('toWindowsPath respects custom linuxHome and windowsRoot', () => {
  assert.strictEqual(
    toWindowsPath('/home/alice/code', {
      linuxHome: '/home/alice',
      windowsRoot: 'Z:\\',
    }),
    'Z:\\code',
  );
});

test('isCursorProcessPath matches Cursor.exe case-insensitively', () => {
  assert.strictEqual(
    isCursorProcessPath('C:\\Users\\x\\AppData\\Local\\Programs\\cursor\\Cursor.exe'),
    true,
  );
  assert.strictEqual(
    isCursorProcessPath('C:/Users/x/AppData/Local/Programs/cursor/cursor.exe'),
    true,
  );
  assert.strictEqual(
    isCursorProcessPath('C:\\Windows\\explorer.exe'),
    false,
  );
  assert.strictEqual(isCursorProcessPath(''), false);
  assert.strictEqual(isCursorProcessPath(null), false);
});

test('availableActions always includes explorer and terminal when cwd maps', () => {
  const actions = availableActions({ cwd: '/home/popstas/p', cursorRunning: false });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'terminal', 'info']);
});

test('availableActions puts explorer first, then cursor when Cursor is running', () => {
  const actions = availableActions({ cwd: '/home/popstas/p', cursorRunning: true });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'cursor', 'terminal', 'info']);
  assert.strictEqual(actions[0].label, 'Open in Explorer');
  assert.strictEqual(actions[1].label, 'Open in Cursor');
  assert.strictEqual(actions[2].label, 'Open in Terminal');
});

test('availableActions offers only session info when cwd cannot be mapped', () => {
  // Информация о сессии не открывает ничего на диске: путь ей не нужен, и
  // пустое меню у такой сессии было бы просто тупиком.
  assert.deepStrictEqual(
    availableActions({ cwd: '/opt/x', cursorRunning: true }).map(a => a.id),
    ['info'],
  );
  assert.deepStrictEqual(
    availableActions({ cwd: '', cursorRunning: true }).map(a => a.id),
    ['info'],
  );
});

test('availableActions offers mark-unread when the session has an agent record', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x', cursorRunning: false, canMarkUnread: true,
  });
  assert.deepStrictEqual(
    actions.map(a => a.id),
    ['explorer', 'terminal', 'unread', 'info'],
  );
  assert.strictEqual(actions.find(a => a.id === 'unread').label, 'Mark unread');
});

test('availableActions omits mark-unread without an agent record', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x', cursorRunning: false, canMarkUnread: false,
  });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'terminal', 'info']);
});

test('availableActions still offers mark-unread when cwd cannot be mapped', () => {
  const actions = availableActions({ cwd: '/opt/elsewhere', canMarkUnread: true });
  assert.deepStrictEqual(actions.map(a => a.id), ['unread', 'info']);
});

test('availableActions labels the session info entry', () => {
  assert.strictEqual(
    availableActions({ cwd: '/home/popstas/x' }).find(a => a.id === 'info').label,
    'Session info',
  );
});

test('buildTerminalRemote sets SSH_STARTDIR then exec zsh -l', () => {
  assert.strictEqual(
    buildTerminalRemote('/home/popstas/projects/x'),
    "SSH_STARTDIR='/home/popstas/projects/x' exec zsh -l",
  );
});

test('buildTerminalRemote escapes single quotes in cwd', () => {
  assert.strictEqual(
    buildTerminalRemote("/home/popstas/it's"),
    "SSH_STARTDIR='/home/popstas/it'\\''s' exec zsh -l",
  );
});

test('buildOpenCommands opens explorer via cmd start with forward slashes', () => {
  const cmd = buildOpenCommands({
    action: 'explorer',
    cwd: '/home/popstas/p',
    winPath: 'V:\\projects\\shell\\ccfzf',
  });
  assert.deepStrictEqual(cmd, {
    kind: 'spawn',
    file: 'cmd.exe',
    args: ['/c', 'start', '', 'V:/projects/shell/ccfzf'],
  });
});

test('buildOpenCommands builds cursor argv preferring cursor on PATH', () => {
  const cmd = buildOpenCommands({
    action: 'cursor',
    cwd: '/home/popstas/p',
    winPath: 'V:\\p',
    cursorExe: 'C:\\Programs\\cursor\\Cursor.exe',
  });
  assert.deepStrictEqual(cmd, { kind: 'spawn', file: 'cursor', args: ['V:\\p'] });
});

test('buildOpenCommands falls back to Cursor.exe path when useCursorCli is false', () => {
  const cmd = buildOpenCommands({
    action: 'cursor',
    cwd: '/home/popstas/p',
    winPath: 'V:\\p',
    cursorExe: 'C:\\Programs\\cursor\\Cursor.exe',
    useCursorCli: false,
  });
  assert.deepStrictEqual(cmd, {
    kind: 'spawn',
    file: 'C:\\Programs\\cursor\\Cursor.exe',
    args: ['V:\\p'],
  });
});

test('buildOpenCommands builds terminal shell command', () => {
  const cmd = buildOpenCommands({
    action: 'terminal',
    cwd: '/home/popstas/p',
    winPath: 'V:\\p',
    sshApp: 'wt.exe -p popstas ssh -A',
    sshHost: DEFAULTS.sshHost,
  });
  assert.strictEqual(cmd.kind, 'shell');
  assert.strictEqual(
    cmd.command,
    "wt.exe -p popstas ssh -A popstas@pc-virt.popstas.pro -t \"SSH_STARTDIR='/home/popstas/p' exec zsh -l\"",
  );
});

test('buildOpenCommands returns null for unknown action or missing winPath', () => {
  assert.strictEqual(
    buildOpenCommands({ action: 'explorer', cwd: '/home/popstas/p', winPath: null }),
    null,
  );
  assert.strictEqual(
    buildOpenCommands({ action: 'nope', cwd: '/home/popstas/p', winPath: 'V:\\p' }),
    null,
  );
});

test('buildDumpRefreshCommand uses ssh and ccfzf --dump on the default host', () => {
  assert.deepStrictEqual(buildDumpRefreshCommand(), {
    file: 'ssh',
    args: [DEFAULTS.sshHost, 'ccfzf --dump'],
  });
});

test('buildDumpRefreshCommand respects a custom sshHost', () => {
  assert.deepStrictEqual(buildDumpRefreshCommand({ sshHost: 'me@box' }), {
    file: 'ssh',
    args: ['me@box', 'ccfzf --dump'],
  });
});

test('availableActions offers Open PR with the number in the label', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x',
    prUrl: 'https://github.com/popstas/ccfzf/pull/3',
  });
  assert.strictEqual(actions.find(a => a.id === 'pr').label, 'Open PR #3');
});

test('availableActions omits Open PR without a pull request url', () => {
  const actions = availableActions({ cwd: '/home/popstas/projects/x' });
  assert.ok(!actions.some(a => a.id === 'pr'));
});

test('buildOpenCommands opens a pull request url through cmd start', () => {
  assert.deepStrictEqual(
    buildOpenCommands({ action: 'pr', prUrl: 'https://github.com/popstas/ccfzf/pull/3' }),
    { kind: 'spawn', file: 'cmd.exe', args: ['/c', 'start', '', 'https://github.com/popstas/ccfzf/pull/3'] },
  );
});

test('buildOpenCommands refuses a pull request url of the wrong shape', () => {
  // Строка пришла из транскрипта агента и уходит в аргумент `start`: вторые
  // ворота после normalizeProgress, потому что вызвать эту функцию может кто
  // угодно.
  for (const bad of ['', undefined, 'https://evil.tld/a/b/pull/1', 'https://github.com/a/b/pull/1 && calc']) {
    assert.strictEqual(buildOpenCommands({ action: 'pr', prUrl: bad }), null);
  }
});
