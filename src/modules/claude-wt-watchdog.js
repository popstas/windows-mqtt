/** Сторож демона claude-wt. Без I/O: статус, диагноз, подъём и часы — снаружи. */

// Полминуты: при пороге молчания в минуту это две проверки на порог, то есть
// поломку замечают быстрее, чем она успевает надоесть, и не чаще, чем нужно.
const CHECK_INTERVAL_MS = 30000;
// Неустранимая поломка не должна превратить лог в поток перезапусков. Диагноз
// при этом пишется каждую проверку — по частоте строк видно, что беда не ушла.
const RESTART_COOLDOWN_MS = 300000;

/**
 * Проверка живости демона.
 *
 * Решение о болезни принимает библиотека (`claudeWtHealth`), здесь только
 * реакция: сказать и поднять. Разделение не косметическое — пороги и смысл
 * «болен» живут там же, где счётчики, а приложение владеет логом и жизненным
 * циклом.
 */
function createClaudeWtWatchdog({
  status,
  health,
  restart,
  log,
  now = Date.now,
  silenceMs,
  graceMs,
  cooldownMs = RESTART_COOLDOWN_MS,
}) {
  // -Infinity, а не 0: с нулём первый же подъём после старта процесса попал бы
  // в кулдаун только при подставных часах в тестах, и тест лгал бы.
  let lastRestartAt = -Infinity;

  return function check() {
    const s = status();
    const nowMs = now();
    const h = health({
      running: s.running,
      lastTickAt: s.lastTickAt,
      startedAt: s.startedAt,
      nowMs,
      silenceMs,
      graceMs,
    });
    if (h.healthy) return false;

    const ageSec = Math.round((h.ageMs ?? 0) / 1000);
    log(`claude-wt: демон нездоров (${h.reason}), последний тик ${ageSec}s назад, `
      + `падений подряд ${s.tickFailures}, последняя ошибка: ${s.lastTickError || '—'}`, 'warn');

    if (nowMs - lastRestartAt < cooldownMs) return false;
    lastRestartAt = nowMs;
    log('claude-wt: поднимаю демона заново', 'warn');
    restart();
    return true;
  };
}

module.exports = { createClaudeWtWatchdog, CHECK_INTERVAL_MS, RESTART_COOLDOWN_MS };
