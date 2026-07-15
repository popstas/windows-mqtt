// Native crash (SIGSEGV) capture. uncaughtException CANNOT catch native addon
// segfaults (e.g. the historical CryptoPro cpsuprt crash), so register this as
// early as possible. Writes the stack to crash.log in the user settings dir,
// which survives the process death. Optional — never block startup if missing.
try {
  const fs = require('fs');
  const { settingsDir } = require('./paths');
  const SegfaultHandler = require('segfault-handler');
  const crashLog = settingsDir('crash.log');
  // A fresh bundled install has no settings dir yet; without it segfault-handler
  // silently fails to write crash.log. Create it before registering.
  fs.mkdirSync(settingsDir(), { recursive: true });
  SegfaultHandler.registerHandler(crashLog);
} catch {}

// In Tauri bridge mode, stdout is the IPC channel — redirect all console output to stderr
if (process.env.TAURI_BRIDGE === '1') {
  // When the parent Tauri process dies, the stdio pipes break and every write
  // throws EPIPE; without these guards the uncaughtException handler tries to
  // log the error to the same dead pipe, creating a 100% CPU error loop.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  // Tag each line with its level so the Rust side can label server-log
  // events correctly (everything on stderr used to show up as [error]).
  // Multi-line stacks must tag EVERY line — Rust strips one prefix per line.
  const { tagLines } = require('./log-tag');
  const stderrWrite = (level) => (...args) => {
    try {
      process.stderr.write(tagLines(level, args.join(' ')) + '\n');
    } catch {}
  };
  console.log = stderrWrite('info');
  console.info = stderrWrite('info');
  console.warn = stderrWrite('warn');
  console.error = stderrWrite('error');
  console.debug = stderrWrite('debug');
}

const {start} = require('./server');

void start();
