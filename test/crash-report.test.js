import test from 'node:test';
import assert from 'node:assert';
import { configureReport } from '../src/crash-report.js';

test('configureReport points reports at the given dir and enables fatal capture', () => {
  const report = {
    directory: '',
    reportOnFatalError: false,
    reportOnUncaughtException: false,
    reportOnSignal: false,
  };
  assert.equal(configureReport(report, '/tmp/reports'), true);
  assert.equal(report.directory, '/tmp/reports');
  assert.equal(report.reportOnFatalError, true);
  assert.equal(report.reportOnUncaughtException, true);
});

test('configureReport leaves reportOnSignal off (SIGUSR2 is undeliverable on Windows)', () => {
  const report = { reportOnSignal: false };
  configureReport(report, '/tmp/reports');
  assert.equal(report.reportOnSignal, false);
});

test('configureReport is a no-op when process.report is unavailable', () => {
  assert.equal(configureReport(undefined, '/tmp/reports'), false);
  assert.equal(configureReport(null, '/tmp/reports'), false);
});
