/** Сторож демона claude-wt. Без I/O: статус, диагноз, подъём и часы — снаружи. */

// Полминуты: при пороге молчания в минуту это две проверки на порог, то есть
// поломку замечают быстрее, чем она успевает надоесть, и не чаще, чем нужно.
const CHECK_INTERVAL_MS = 30000;
// Неустранимая поломка не должна превратить лог в поток перезапусков. Диагноз
// при этом пишется каждую проверку — по частоте строк видно, что беда не ушла.
const RESTART_COOLDOWN_MS = 300000;
// Запасные пороги на случай библиотеки постарше: без них silenceMs/graceMs
// приезжают undefined, сравнения с ними всегда ложны — и сторож либо считает
// демона больным с первой же секунды, либо здоровым всегда. Второе хуже: он
// молча слепнет, а слепой сторож — ровно та беда, от которой он поставлен.
const DEFAULT_SILENCE_MS = 60000;
const DEFAULT_GRACE_MS = 60000;

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
  silenceMs = DEFAULT_SILENCE_MS,
  graceMs = DEFAULT_GRACE_MS,
  cooldownMs = RESTART_COOLDOWN_MS,
}) {
  // -Infinity, а не 0: с нулём первый же подъём после старта процесса попал бы
  // в кулдаун только при подставных часах в тестах, и тест лгал бы.
  let lastRestartAt = -Infinity;

  return function check() {
    // Тело целиком под перехватом: status() ходит в getConfig() и, пока демон
    // не сделал ни одного тика, в readState() — обе умеют бросать. Исключение
    // отсюда попадало бы в глушащий обработчик таймера, и сторож замолкал бы
    // ровно так же незаметно, как демон, за которым он смотрит.
    try {
      return runCheck();
    } catch (e) {
      log(`claude-wt: сторож не смог проверить демона: ${e.message}`, 'error');
      return false;
    }
  };

  function runCheck() {
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

    // Возраст пишется, только когда он что-то значит: у незапущенного демона
    // последнего тика нет, и «последний тик 0s назад» сбивал бы с толку.
    const age = h.ageMs ? `последний тик ${Math.round(h.ageMs / 1000)}s назад, ` : '';
    log(`claude-wt: демон нездоров (${h.reason}), ${age}`
      + `падений подряд ${s.tickFailures}, последняя ошибка: ${s.lastTickError || '—'}`, 'warn');

    if (nowMs - lastRestartAt < cooldownMs) return false;
    lastRestartAt = nowMs;
    log('claude-wt: поднимаю демона заново', 'warn');
    restart();
    return true;
  }
}

module.exports = {
  createClaudeWtWatchdog,
  CHECK_INTERVAL_MS,
  RESTART_COOLDOWN_MS,
  DEFAULT_SILENCE_MS,
  DEFAULT_GRACE_MS,
};
