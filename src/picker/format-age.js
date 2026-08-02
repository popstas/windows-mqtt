/** Age label for last activity: now, 5m, 2h, 3d. No I/O. */

/**
 * `timestamp` and `nowSec` are epoch seconds (claude-wt slots and hooks).
 * `nowSec` is injected so the helper stays pure and testable.
 */
function formatAge(timestamp, nowSec) {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  const delta = Math.max(0, Math.floor(nowSec - timestamp));
  if (delta < 60) return 'now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

module.exports = { formatAge };
