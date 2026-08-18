// Node diagnostic reports (process.report) for runtime-fatal events.
//
// SCOPE — verified empirically on Node 24 / Windows, do not widen the claim:
// this captures V8/runtime fatal errors (OOM, fatal internal errors) and early
// uncaught exceptions. It does NOT capture native-addon access violations: a
// raw SIGSEGV kills the process with no report written, because that is an SEH
// exception outside the runtime. `segfault-handler` used to cover that case but
// registered an UNFILTERED vectored exception handler, so every benign
// DBG_PRINTEXCEPTION_C (raised by OutputDebugStringA, e.g. from libusbK inside
// the `usb` addon) was reported as a fake SIGSEGV — 14 bogus 8 KB dumps per run.
//
// `reportOnUncaughtException` rarely fires in practice because server.js
// installs an uncaughtException listener that swallows the error, so the
// process does not terminate. It still covers the startup window before that
// listener exists.
function configureReport(report, dir) {
  if (!report) return false;
  report.directory = dir;
  report.reportOnFatalError = true;
  report.reportOnUncaughtException = true;
  // reportOnSignal stays off: report.signal is SIGUSR2, which Windows has no
  // way to deliver. Enabling it would only add a no-op listener.
  return true;
}

export { configureReport };
