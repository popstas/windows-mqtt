/** Age label for last activity: 31s, 5m, 2h, 3d. No I/O. */

/**
 * `timestamp` and `nowSec` are epoch seconds (claude-wt slots and hooks).
 * `nowSec` is injected so the helper stays pure and testable.
 *
 * The first minute is spelled in seconds, matching the picker copy of this
 * helper in frontend-src/session-glyph.js: the two must read the same, and
 * "now" answered "recently" where the column asks "how long".
 */
function formatAge(timestamp, nowSec) {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  const delta = Math.max(0, Math.floor(nowSec - timestamp));
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

module.exports = { formatAge };
