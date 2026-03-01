// In Tauri bridge mode, stdout is the IPC channel — redirect all console output to stderr
if (process.env.TAURI_BRIDGE === '1') {
  const stderrWrite = (...args) => process.stderr.write(args.join(' ') + '\n');
  console.log = stderrWrite;
  console.info = stderrWrite;
  console.warn = stderrWrite;
  console.error = stderrWrite;
  console.debug = stderrWrite;
}

const {start} = require('./server');

void start();
