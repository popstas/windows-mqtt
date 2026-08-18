import fs from 'node:fs';
import { settingsDir } from './paths.js';
import { configureReport } from './crash-report.js';
// Tag each line with its level so the Rust side can label server-log
// events correctly (everything on stderr used to show up as [error]).
// Multi-line stacks must tag EVERY line — Rust strips one prefix per line.
import { tagLines } from './log-tag.js';

// Diagnostic reports for runtime-fatal events (OOM, V8 fatal errors), written
// to the user settings dir so they survive the process death. Configure as
// early as possible. Optional — never block startup if it fails.
// See src/crash-report.js for what this does and does not capture.
try {
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

  // helpers тянет за собой конфиг, поэтому грузится ПОСЛЕ подмены console, а
  // не статическим импортом наверху: статический импорт выполнился бы до
  // тела файла. До того как промис разрешится, строки уходят только в stderr —
  // ровно то же окно, что было у ленивого require раньше.
  let helpersMod;
  import('./helpers.js').then((m) => { helpersMod = m; }, () => {});

  // Одна пометка на весь процесс. Молчать тут нельзя — этот путь для того и
  // заведён, чтобы диагностика перестала теряться, — но и жаловаться на каждую
  // строку тоже: сбой файлового лога превратился бы в поток шума в stderr.
  let fileLogFailureNoted = false;
  const stderrWrite = (level) => (...args) => {
    const text = args.join(' ');
    try {
      process.stderr.write(tagLines(level, text) + '\n');
    } catch {}
    try {
      if (!helpersMod) throw new Error('helpers ещё не загружен');
      helpersMod.logConsoleLine(level, text);
    } catch (e) {
      // Штатный случай — helpers ещё грузится: строка мимо файла. Дальше всё
      // чинится само, но знать, что начало лога не доехало, надо.
      if (!fileLogFailureNoted) {
        fileLogFailureNoted = true;
        try {
          process.stderr.write(tagLines('warn',
            `[log] console line did not reach the file log: ${e && e.message}`) + '\n');
        } catch {}
      }
    }
  };
  console.log = stderrWrite('info');
  console.info = stderrWrite('info');
  console.warn = stderrWrite('warn');
  console.error = stderrWrite('error');
  console.debug = stderrWrite('debug');
}

// Динамический импорт, а не статический: тело этого файла обязано выполниться
// раньше server.js — статический import хойстится и порядок бы сломался.
const { start } = await import('./server.js');

void start();
