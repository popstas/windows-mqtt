// Pure helpers for the MIDI module, kept free of native dependencies
// (@julusian/midi, usb, robotjs) so they can be unit-tested on any platform.

// Enumerate the input port names of a midi.Input-like object (anything with
// getPortCount()/getPortName(p)). Testable with a fake input.
function listPortNames(input) {
  const count = input.getPortCount();
  const names = [];
  for (let p = 0; p < count; p++) names.push(input.getPortName(p));
  return names;
}

// Build the human-readable help printed at info level when an unconfigured
// MIDI device is plugged in, so the user can copy a `portName:` value straight
// into config.yml without enabling debug logging.
function formatMidiPortHelp(portNames) {
  const lines = [];
  if (!portNames.length) {
    lines.push('midi ports: none detected yet, reconnect the device');
    return lines;
  }
  lines.push('midi ports:');
  portNames.forEach((name, i) => lines.push(`  ${i}: ${name}`));
  lines.push('add one of these to the midi device config:');
  portNames.forEach((name) => lines.push(`portName: '${name}',`));
  return lines;
}

// Dedupe repeated log lines across retry-timer ticks: returns true only the
// first time a key is seen, recording it in loggedSet. Clear the set (or
// delete the key) to re-enable a log.
function shouldLogOnce(loggedSet, key) {
  if (loggedSet.has(key)) return false;
  loggedSet.add(key);
  return true;
}

module.exports = { listPortNames, formatMidiPortHelp, shouldLogOnce };
