// In Tauri bridge mode, stdout is the IPC channel — redirect all console output to stderr
if (process.env.TAURI_BRIDGE === '1') {
  // When the parent Tauri process dies, the stdio pipes break and every write
  // throws EPIPE; without these guards the uncaughtException handler tries to
  // log the error to the same dead pipe, creating a 100% CPU error loop.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  const stderrWrite = (...args) => {
    try {
      process.stderr.write(args.join(' ') + '\n');
    } catch {}
  };
  console.log = stderrWrite;
  console.info = stderrWrite;
  console.warn = stderrWrite;
  console.error = stderrWrite;
  console.debug = stderrWrite;
}

const {start} = require('./server');

void start();
