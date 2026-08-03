/** Pure helpers for opening a session cwd from the picker. No I/O. */

// Номер PR считает тот же модуль, что рисует метку в строке: правило одно, и
// разъехаться ему негде. Файл фронтенда грузится и как <script>, и как модуль —
// require здесь пользуется вторым.
const { prNumber } = require('../../frontend-src/session-glyph');

const DEFAULTS = Object.freeze({
  linuxHome: '/home/popstas',
  windowsRoot: 'V:\\',
  sshHost: 'popstas@pc-virt.popstas.pro',
  sshApp: 'wt.exe ssh -A',
});

function resolveOpts(opts = {}) {
  return {
    linuxHome: opts.linuxHome ?? DEFAULTS.linuxHome,
    windowsRoot: opts.windowsRoot ?? DEFAULTS.windowsRoot,
    sshHost: opts.sshHost ?? DEFAULTS.sshHost,
    sshApp: opts.sshApp ?? DEFAULTS.sshApp,
  };
}

/**
 * Map a Linux home path onto the Windows SMB drive that mounts the same tree.
 * Returns null when cwd is missing or outside linuxHome.
 */
function toWindowsPath(cwd, opts = {}) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const { linuxHome, windowsRoot } = resolveOpts(opts);
  const home = linuxHome.replace(/\/+$/, '');
  const normalized = cwd.replace(/\/+$/, '') || '/';
  if (normalized !== home && !normalized.startsWith(`${home}/`)) return null;

  const root = windowsRoot.replace(/[\\/]+$/, '') || windowsRoot;
  if (normalized === home) return `${root}\\`;

  const rest = normalized.slice(home.length + 1).replace(/\//g, '\\');
  return `${root}\\${rest}`;
}

function isCursorProcessPath(path) {
  if (typeof path !== 'string' || !path) return false;
  return /(?:^|[\\/])cursor\.exe$/i.test(path);
}

// Пункты, которым нужен путь на диске Windows. Всё остальное меню от него не
// зависит и живёт по своим условиям.
const PATH_ACTION_DEFS = [
  { id: 'explorer', label: 'Open in Explorer' },
  { id: 'cursor', label: 'Open in Cursor' },
  { id: 'terminal', label: 'Open in Terminal' },
];

/**
 * Действия, которые пикер может предложить для сессии.
 *
 * Cursor — только когда он запущен: пункт, открывающий несуществующее
 * приложение, хуже отсутствующего. Путь нужен лишь первым трём, поэтому сессия
 * вне V: остаётся с пометкой непрочитанным, а не с пустым меню.
 */
function availableActions({ cwd, cursorRunning, canMarkUnread = false, prUrl = '' }, opts = {}) {
  const actions = toWindowsPath(cwd, opts) === null
    ? []
    : PATH_ACTION_DEFS.filter(a => a.id !== 'cursor' || cursorRunning);
  if (canMarkUnread) actions.push({ id: 'unread', label: 'Mark unread' });
  const prNum = prNumber(prUrl);
  if (prNum) actions.push({ id: 'pr', label: `Open PR #${prNum}` });
  // Информация о сессии есть всегда: она рисуется из той же строки списка и
  // ничего не запрашивает.
  actions.push({ id: 'info', label: 'Session info' });
  return actions;
}

/** Shell fragment run on the remote host after ssh -t. */
function buildTerminalRemote(cwd) {
  const escaped = String(cwd).replace(/'/g, `'\\''`);
  return `SSH_STARTDIR='${escaped}' exec zsh -l`;
}

/**
 * Build a spawn/shell descriptor for one action. Caller does the I/O.
 * @param {object} args
 * @param {string} args.action
 * @param {string} args.cwd
 * @param {string|null} args.winPath
 * @param {string} [args.sshApp]
 * @param {string} [args.sshHost]
 * @param {string} [args.cursorExe]
 * @param {boolean} [args.useCursorCli=true]
 * @param {string} [args.prUrl]
 */
function buildOpenCommands({
  action,
  cwd,
  winPath,
  sshApp,
  sshHost,
  cursorExe,
  useCursorCli = true,
  prUrl,
}) {
  if (action === 'pr') {
    // Проверка формы здесь вторая: первая стоит в normalizeProgress. Эта
    // функция чистая и вызывается кем угодно, а результат уходит в аргумент
    // командной строки.
    if (!prNumber(prUrl)) return null;
    return { kind: 'spawn', file: 'cmd.exe', args: ['/c', 'start', '', prUrl] };
  }
  if (!winPath) return null;
  if (action === 'explorer') {
    // Confirmed working on this machine: spawn explorer.exe / exec explorer
    // both fail (backslashes get eaten or nothing opens). Only
    // `cmd /c start "" <fwd-path>` opens the folder.
    const fwd = String(winPath).replace(/\\/g, '/');
    return {
      kind: 'spawn',
      file: 'cmd.exe',
      args: ['/c', 'start', '', fwd],
    };
  }
  if (action === 'cursor') {
    const file = useCursorCli || !cursorExe ? 'cursor' : cursorExe;
    return { kind: 'spawn', file, args: [winPath] };
  }
  if (action === 'terminal') {
    const app = sshApp ?? DEFAULTS.sshApp;
    const host = sshHost ?? DEFAULTS.sshHost;
    const remote = buildTerminalRemote(cwd);
    return {
      kind: 'shell',
      command: `${app} ${host} -t "${remote}"`,
    };
  }
  return null;
}

/**
 * Non-interactive ssh argv that rewrites the ccfzf session dump on the Linux
 * host. Caller spawns it fire-and-forget when the picker opens.
 */
function buildDumpRefreshCommand(opts = {}) {
  const { sshHost } = resolveOpts(opts);
  return { file: 'ssh', args: [sshHost, 'ccfzf --dump'] };
}

module.exports = {
  DEFAULTS,
  toWindowsPath,
  isCursorProcessPath,
  availableActions,
  buildTerminalRemote,
  buildOpenCommands,
  buildDumpRefreshCommand,
};
