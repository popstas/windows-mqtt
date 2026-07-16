const fs = require('fs');

// Windows-safe single-backup log rotation. Shared by helpers.js (app log) and
// monitor.js (sysstats.jsonl) so both use the same correct implementation.
//
// Windows renameSync fails if the target exists, so the old `.1` backup is
// removed first. A missing source file is not an error (nothing to rotate yet);
// any other failure is reported via onWarn so rotation errors can't be silently
// swallowed (which previously let sysstats.jsonl grow unbounded).
function rotateFile(file, maxBytes, onWarn) {
  let size;
  try {
    ({ size } = fs.statSync(file));
  } catch (e) {
    // File doesn't exist yet — nothing to rotate. Any other stat error is real.
    if (e && e.code === 'ENOENT') return;
    if (typeof onWarn === 'function') onWarn(`log rotation stat failed: ${e.message}`);
    return;
  }
  if (size <= maxBytes) return;
  try {
    fs.rmSync(file + '.1', { force: true });
    fs.renameSync(file, file + '.1');
  } catch (e) {
    if (typeof onWarn === 'function') onWarn(`log rotation failed: ${e.message}`);
  }
}

module.exports = { rotateFile };
