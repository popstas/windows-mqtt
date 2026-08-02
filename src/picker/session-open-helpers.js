/** Pure helpers for opening a session cwd from the picker. No I/O. */

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

const ACTION_DEFS = [
  { id: 'explorer', label: 'Open in Explorer' },
  { id: 'cursor', label: 'Open in Cursor' },
  { id: 'terminal', label: 'Open in Terminal' },
];

/**
 * Actions the picker may offer for a session. Cursor is omitted unless a
 * Cursor.exe process is already running. Empty when cwd cannot be mapped.
 */
function availableActions({ cwd, cursorRunning }, opts = {}) {
  if (toWindowsPath(cwd, opts) === null) return [];
  return ACTION_DEFS.filter(a => a.id !== 'cursor' || cursorRunning);
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
 */
function buildOpenCommands({
  action,
  cwd,
  winPath,
  sshApp,
  sshHost,
  cursorExe,
  useCursorCli = true,
}) {
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
