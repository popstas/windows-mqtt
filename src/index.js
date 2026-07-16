// Diagnostic reports for runtime-fatal events (OOM, V8 fatal errors), written
// to the user settings dir so they survive the process death. Configure as
// early as possible. Optional — never block startup if it fails.
// See src/crash-report.js for what this does and does not capture.
try {
  const fs = require('fs');
  const { settingsDir } = require('./paths');
  const { configureReport } = require('./crash-report');
  const reportDir = settingsDir('reports');
  // Node falls back to cwd (read-only in a bundled install) if the report
  // directory does not exist, so create it before pointing process.report there.
  fs.mkdirSync(reportDir, { recursive: true });
  configureReport(process.report, reportDir);
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
