/** Сущности Home Assistant для сессий claude-wt. Чистая сборка, без I/O. */

const { buildSlots } = require('../picker/session-slots');
const { formatAge } = require('../picker/format-age');

// switch, а не binary_sensor: через MQTT Discovery у переключателя есть
// command_topic, и нажатие в интерфейсе Home Assistant переводит фокус на эту
// сессию. Состояние при этом отвечает на вопрос «нужен ли я тебе», а на него
// нажатие уже ответило — поэтому переключатель гасится сразу, тем же
// обработчиком, что переводит фокус (см. claudeSlotCommand).
const SLOT_PREFIX = 'switch.claude_session_';

// Состояния, при которых сессия требует внимания. Плитка на панели горит
// ровно тогда, когда к сессии надо вернуться: агент спрашивает или закончил и
// результат ещё не смотрели. Работающая сессия не горит — она сама по себе.
const ATTENTION = new Set(['question', 'review']);

// Значок состояния прямо в тексте: openHASP рисует строку как есть, а
// раскрашивать её по атрибуту — это шаблон в каждой кнопке. Один символ в
// начале читается с двух метров и не требует ничего от панели.
//
// Только ASCII. Во встроенном шрифте openHASP нет ни ▶, ни ·, ни × — вместо
// них панель рисует пустые квадраты; иконки там задаются кодами MDI ( и
// подобными), а не юникодными символами.
// Значок есть у каждого занятого слота, включая работающую сессию: без него
// строки разъезжаются по левому краю — там, где у соседей стоит символ, у
// работающей начинался сразу заголовок.
const STATUS_GLYPH = {
  active: '>',
  question: '?',
  review: '!',
  idle: '-',
  closed: 'x',
  empty: '',
};

/**
 * Текст, который увидит панель.
 *
 * Пустой слот — `-`, не пустая строка: openHASP не стирает текст пустым
 * payload, а HA ещё обрезает пробел из шаблона — карточка залипала бы
 * предыдущей сессией. То же правило, что у `slotUsage` / `slotDescription`.
 */
function slotText(slot) {
  if (!slot || slot.status === 'empty') return '-';
  const glyph = STATUS_GLYPH[slot.status] ?? '';
  const title = typeof slot.title === 'string' ? slot.title.trim() : '';
  if (!title) return '-';
  return `${glyph} ${title}`.trim();
}

/**
 * Правый верхний угол строки: во что обошлась сессия и сколько от контекста
 * съедено — или, если цифр нет, сколько назад было последнее действие.
 *
 * Собирается здесь, а не шаблоном в конфиге панели: в Home Assistant это была
 * бы склейка из двух state_attr с двумя проверками на пустоту в каждой кнопке,
 * то есть пять копий одной логики в YAML.
 *
 * Ноль в cost/context — «данных нет»: перехват статуслайна стоит не у каждой
 * сессии. Пустую строку сюда класть нельзя: openHASP не стирает текст пустым
 * payload, а HA ещё обрезает пробел из шаблона — угол залипал бы значением
 * предыдущей сессии при смене порядка. Поэтому без цифр — возраст (`5m`), а
 * без возраста — `-`.
 */
function slotUsage(slot, nowSec = Math.floor(Date.now() / 1000)) {
  if (!slot || slot.status === 'empty') return '-';
  const parts = [];
  if (slot.costUsd > 0) parts.push(`$${slot.costUsd}`);
  if (slot.contextPct > 0) parts.push(`${slot.contextPct}%`);
  if (parts.length) return parts.join(' ');
  return formatAge(slot.lastActivity, nowSec) || '-';
}

/**
 * Нижняя строка карточки: что сессия говорит о себе.
 *
 * Это `description` из windows11-manager — сводка, а у работающей сессии
 * последняя известная. Раньше здесь стоял голый `summary`, и у всего, что
 * работает прямо сейчас, строка на плате была пустой: свежей сводки у такой
 * сессии нет по определению, а сказать ей есть что.
 *
 * Пусто / пустой слот → `-`, иначе залипает предыдущей сессией.
 */
function slotDescription(slot) {
  if (!slot || slot.status === 'empty') return '-';
  const s = typeof slot.description === 'string' ? slot.description.trim() : '';
  return s || '-';
}

/**
 * Один слот как сущность HA.
 *
 * Отдельно от `buildSessionEntities`, потому что публиковать слот приходится и
 * поодиночке: нажатие на переключатель гасит его сразу, не дожидаясь
 * очередного экспорта. Состояние и атрибуты живут в одном топике, поэтому
 * опубликовать одно только `state` нельзя — с ним улетели бы и текст, и
 * сводка, и строка панели опустела бы до следующего тика.
 */
function sessionEntity(slot, nowSec = Math.floor(Date.now() / 1000)) {
  return {
    entityId: `${SLOT_PREFIX}${slot.slot}`,
    // Состояние — это «нужен ли я тебе», а не «жива ли сессия». Панель
    // подсвечивает включённые плитки, и подсвечивать работающую сессию значит
    // звать к ней без повода.
    state: ATTENTION.has(slot.status) ? 'on' : 'off',
    attributes: {
      friendly_name: `Claude session ${slot.slot}`,
      icon: 'mdi:console',
      slot: slot.slot,
      session_id: slot.id,
      // Готовая строка для панели: состояние сущности занято признаком
      // внимания, поэтому текст живёт в атрибуте.
      text: slotText(slot),
      title: slot.title,
      cwd: slot.cwd,
      status: slot.status,
      open: slot.open,
      desktop: slot.desktop,
      monitor: slot.monitor,
      last_activity: slot.lastActivity,
      message: slot.message,
      // Чем сессия закончила — или, пока она работает, на чём остановилась в
      // прошлый раз. Имя атрибута историческое: под ним строку читают шаблоны
      // панели в conf/openhasp.yaml, и переименование стоило бы правки на пять
      // кнопок ради ничего. Пустое → `-`: иначе openHASP не стирает прежнюю.
      summary: slotDescription(slot),
      // Сырые поля хука рядом — автоматизациям иногда нужно именно «что сейчас»
      // против «что было», а склейка этого различия не хранит.
      last_summary: slot.lastSummary,
      // Готовая строка для правого верхнего угла кнопки: «$12 47%» или «5m».
      usage: slotUsage(slot, nowSec),
      cost_usd: slot.costUsd,
      context_pct: slot.contextPct,
    },
  };
}

/**
 * Слоты сессий как сущности HA.
 *
 * Номер слота — часть entity_id, и это принципиально: кнопка на панели
 * прибита к строке, а не к сессии, поэтому и сущность должна быть привязана к
 * строке. Иначе при каждом изменении состава пришлось бы переписывать
 * конфигурацию панели.
 */
function buildSessionEntities(sessions, count, sort, nowSec = Math.floor(Date.now() / 1000)) {
  return buildSlots(sessions, count, sort).map(slot => sessionEntity(slot, nowSec));
}

/** Сводная сущность: сколько сессий живо и сколько из них ждут внимания. */
function buildSummaryEntity(sessions) {
  const list = sessions ?? [];
  const open = list.filter(s => s.open);
  // Просмотренное не считается ждущим — иначе сводка расходилась бы со
  // слотами, где фокус гасит и вопрос, и «посмотри результат».
  const waiting = open.filter(s => !s.agentSeen && (s.agentState === 'question'
    || s.agentState === 'review'
    || (s.agentState === 'idle' && s.agentEvent === 'attention')));
  return {
    entityId: 'sensor.claude_sessions',
    state: open.length,
    attributes: {
      friendly_name: 'Claude sessions',
      icon: 'mdi:console-network',
      unit_of_measurement: 'sessions',
      total: list.length,
      open: open.length,
      waiting: waiting.length,
      working: open.filter(s => s.agentState === 'active').length,
    },
  };
}

module.exports = {
  SLOT_PREFIX, STATUS_GLYPH, slotText, slotUsage, slotDescription,
  sessionEntity, buildSessionEntities, buildSummaryEntity,
};
