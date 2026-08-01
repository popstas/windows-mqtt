/** Сущности Home Assistant для сессий claude-wt. Чистая сборка, без I/O. */

const { buildSlots } = require('../picker/session-slots');

// switch, а не binary_sensor: через MQTT Discovery у переключателя есть
// command_topic, и нажатие в интерфейсе Home Assistant переводит фокус на эту
// сессию. Состояние при этом отвечает на вопрос «нужен ли я тебе», поэтому
// переключатель тут же вернётся в положение из следующего экспорта.
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
// Работающая сессия — без значка: она и так самая обычная, а плитка её не
// подсвечивает. Значок остаётся у тех состояний, которые надо различать
// глазами: два вида «требует внимания», простой и закрытая.
const STATUS_GLYPH = {
  active: '',
  question: '?',
  review: '!',
  idle: '-',
  closed: 'x',
  empty: '',
};

/**
 * Текст, который увидит панель.
 *
 * Пустой слот — пробел, а не пустая строка и не «—». Прочерки в половине
 * строк выглядят как поломка, а от совсем пустого текста объект на панели
 * схлопывается по высоте, и список начинает прыгать. Пробел держит строку,
 * оставаясь невидимым.
 */
function slotText(slot) {
  if (!slot || slot.status === 'empty') return ' ';
  const glyph = STATUS_GLYPH[slot.status] ?? '';
  return `${glyph} ${slot.title}`.trim();
}

/**
 * Слоты сессий как сущности HA.
 *
 * Номер слота — часть entity_id, и это принципиально: кнопка на панели
 * прибита к строке, а не к сессии, поэтому и сущность должна быть привязана к
 * строке. Иначе при каждом изменении состава пришлось бы переписывать
 * конфигурацию панели.
 */
function buildSessionEntities(sessions, count) {
  const slots = buildSlots(sessions, count);
  return slots.map(slot => ({
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
    },
  }));
}

/** Сводная сущность: сколько сессий живо и сколько из них ждут внимания. */
function buildSummaryEntity(sessions) {
  const list = sessions ?? [];
  const open = list.filter(s => s.open);
  const waiting = open.filter(s => s.agentState === 'question'
    || (!s.agentSeen && (s.agentState === 'review'
      || (s.agentState === 'idle' && s.agentEvent === 'attention'))));
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

module.exports = { SLOT_PREFIX, STATUS_GLYPH, slotText, buildSessionEntities, buildSummaryEntity };
